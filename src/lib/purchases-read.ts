/**
 * Разовые чтения `purchases`: история Лота, лог сделок и оффлайн-догон
 * Колокольчика.
 *
 * Владеет только запросами и разбором границы страницы; строки в записи
 * превращает чистое ядро `trade-history`, живой снапшот и события — `live.ts`
 * (docs/adr/0003). Запись покупки — в `purchase-write`, клиент и ретрай — в
 * `session`. Без настроенных PUBLIC_SUPABASE_* — честная деградация: пусто
 * или `ok: false`, без исключений.
 */
import { getSupabase, withAuthRetry } from './session';
import {
  DEAL_PAGE_SIZE,
  dealEntries,
  HISTORY_PAGE_SIZE,
  historyCursorFilter,
  historyEntries,
  outbidCatchup,
  type DealEntry,
  type HistoryCursor,
  type HistoryEntry,
  type TradeRow,
} from './trade-history';
import type { LiveOutbid } from './live-store';

/**
 * История перепродаж Лота из purchases: одна страница сделок, новые первыми.
 * `from` каждой записи — продавец из сделки (`purchases.seller_*`, см. миграцию
 * `*_purchase_seller.sql`), а не реконструкция цепочки на клиенте. Без курсора
 * отдаётся первая страница; с курсором (`historyCursor`) — следующая: keyset по
 * паре `(created_at, id)`, поэтому живые вставки не сдвигают границу страниц
 * (offset бы сдвинул). Существующий индекс `purchases_lot_time_idx` покрывает
 * предикат `lot_id` — новых индексов не заводим. Лот не переехал в хранилище /
 * ошибка → пустая история.
 */
export async function fetchSharedHistory(
  slug: string,
  limit: number = HISTORY_PAGE_SIZE,
  cursor: HistoryCursor | null = null
): Promise<HistoryEntry[]> {
  const sb = getSupabase();
  if (!sb) return [];
  try {
    const { data: lot, error: lotError } = await withAuthRetry(() =>
      sb.from('lots').select('id').eq('slug', slug).single()
    );
    if (lotError || !lot) return [];
    const lotId = (lot as unknown as { id: number }).id;
    let query = sb
      .from('purchases')
      .select('id,seller_login,buyer_login,buyer_uid,price_paid,created_at')
      .eq('lot_id', lotId);
    const filter = historyCursorFilter(cursor);
    if (filter) query = query.or(filter);
    const { data, error } = await withAuthRetry(() =>
      query
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(Math.max(1, Math.floor(limit)))
    );
    if (error || !Array.isArray(data)) return [];
    return historyEntries(data as unknown as TradeRow[]);
  } catch {
    return [];
  }
}

/** Страница «Лога сделок»: `ok` отличает честное «пусто» от ошибки чтения. */
export interface DealLogPage {
  ok: boolean;
  entries: DealEntry[];
  /** За последней строкой есть ещё (читатель берёт на одну строку больше). */
  hasMore: boolean;
}

/**
 * Лог сделок всей биржи: публичный `SELECT` из `purchases` с соединённым лотом
 * (`lots(slug,title,video_url)`), новые первыми. `buyerUid` — фильтр «Мои
 * покупки»; без него — вся биржа. Без курсора — первая страница; с курсором
 * (`historyCursor`) — следующая: keyset по паре `(created_at, id)`, поэтому
 * живые вставки не сдвигают границу (offset бы сдвинул). Строк берём на одну
 * больше: по сырому ответу честно знаем «есть ещё», даже если последняя строка
 * не разобралась и отброшена (`dealEntries`). Индексы уже есть:
 * `purchases_time_idx (created_at desc, id desc)` для всей биржи и
 * `purchases_buyer_time_idx (buyer_uid, created_at desc)` для фильтра — новых
 * не заводим. `ok: false` — БД недоступна или ответ битый; пустой успешный
 * ответ — честное «сделок нет».
 */
export async function fetchDealLog(
  limit: number = DEAL_PAGE_SIZE,
  cursor: HistoryCursor | null = null,
  buyerUid?: string | null
): Promise<DealLogPage> {
  const sb = getSupabase();
  if (!sb) return { ok: false, entries: [], hasMore: false };
  const cap = Math.max(1, Math.floor(limit));
  try {
    let query = sb
      .from('purchases')
      .select(
        'id,seller_login,buyer_login,buyer_uid,price_paid,created_at,lots(slug,title,video_url)'
      );
    if (buyerUid) query = query.eq('buyer_uid', buyerUid);
    const filter = historyCursorFilter(cursor);
    if (filter) query = query.or(filter);
    const { data, error } = await withAuthRetry(() =>
      query
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(cap + 1)
    );
    if (error || !Array.isArray(data)) return { ok: false, entries: [], hasMore: false };
    const rows = data as unknown as TradeRow[];
    return {
      ok: true,
      entries: dealEntries(rows).slice(0, cap),
      hasMore: rows.length > cap,
    };
  } catch {
    return { ok: false, entries: [], hasMore: false };
  }
}

/**
 * Запас строк на догоне: выкупленные обратно лоты отсеивает ядро уже после
 * запроса, поэтому без запаса свежие строки, сплошь выкупленные, отдали бы
 * меньше `limit` событий. Берём с запасом, а не вторым запросом: догон
 * остаётся одним обращением к БД.
 */
const CATCHUP_OVERFETCH = 4;

/**
 * Форма события догона — та же, что у живого перекупа (`LiveOutbid`): чистое
 * ядро уже возвращает `LiveOutbid[]`, второй копии полей не держим.
 */
export type OutbidCatchupEntry = LiveOutbid;

/**
 * Оффлайн-догон колокольчика (без новой таблицы): один запрос по продавцу —
 * сделки, где я был продавцом, свежие сверху. Лот, выкупленный обратно,
 * исключает ядро (`lots.owner_uid == uid`), поэтому строк берётся с запасом
 * (`CATCHUP_OVERFETCH`), чтобы `limit` событий не худел на них. `since`
 * (epoch ms) — метка просмотра: отдаём только сделки новее неё, поэтому уже
 * виденное не всплывает при каждой загрузке страницы.
 */
export async function fetchOutbidCatchup(
  uid: string,
  limit = 10,
  since?: number
): Promise<OutbidCatchupEntry[]> {
  const sb = getSupabase();
  if (!sb || !uid) return [];
  try {
    let query = sb
      .from('purchases')
      .select('seller_uid,buyer_login,price_paid,created_at,lots(slug,title,video_url,owner_uid)')
      .eq('seller_uid', uid)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(Math.max(1, limit) * CATCHUP_OVERFETCH);
    if (typeof since === 'number' && Number.isFinite(since) && since > 0) {
      query = query.gt('created_at', new Date(since).toISOString());
    }
    const { data, error } = await withAuthRetry(() => query);
    if (error || !Array.isArray(data)) return [];
    return outbidCatchup(data as unknown as TradeRow[], uid, limit);
  } catch {
    return [];
  }
}
