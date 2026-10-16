/**
 * Чтение сделок: строки `purchases` → то, что видит чатерс.
 *
 * Чистое ядро без DOM и сети (как соседи — реестр живых подписок, снапшот,
 * намерение покупки): единственная точка, где строки сделок превращаются в
 * записи истории перепродаж и в события оффлайн-догона Колокольчика.
 *
 * Продавца хранит БД (`purchases.seller_uid`/`seller_login`, см. миграцию
 * `*_purchase_seller.sql`), поэтому цепочка `from[i] = to[i-1]` на клиенте
 * больше не реконструируется: `from` каждой записи приходит из сделки. Пустой
 * продавец — у лота владельца не было (ничей лот админа), это «Биржа», а не
 * «неизвестно».
 *
 * Тесты — src/lib/trade-history.test.ts.
 */

import type { LiveOutbid } from './live-store';

/** Подпись продавца, у которого владельца не было (ничей лот) — «Биржа». */
export const PURCHASE_SELLER_FALLBACK = 'Биржа';

/** Подпись покупателя без ника (в снимке не нашлось) — как в прежнем догоне. */
const BUYER_FALLBACK = 'Чатерс';

/** Одна запись истории перепродаж: `from → to · price`; `buyer_uid` — пометка «ТВОЙ». */
export interface HistoryEntry {
  from: string;
  to: string;
  price: number;
  buyer_uid: string;
  created_at: string;
}

/**
 * Строка `purchases` в том виде, как её отдаёт PostgREST: поля сделки плюс
 * соединённый лот (`lots(slug,title,video_url,owner_uid)`). Всё `unknown` —
 * вход приходит из сети, ядро само проверяет форму и отбрасывает битое.
 */
export interface TradeRow {
  seller_uid?: unknown;
  seller_login?: unknown;
  buyer_uid?: unknown;
  buyer_login?: unknown;
  price_paid?: unknown;
  created_at?: unknown;
  lots?: unknown;
}

/** Непустая строка или null: пустое значение — это отсутствие, а не текст. */
function asText(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Положительное конечное число цены или null (в БД `price_paid > 0`). */
function asPrice(value: unknown): number | null {
  const price = Number(value);
  return Number.isFinite(price) && price > 0 ? price : null;
}

/** Объект-лот из соединённой проекции или null. */
function asLot(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Записи «Истории перепродаж»: `from` = продавец сделки («Биржа», если владельца
 * не было), `to` = покупатель, цена — числом. Порядок входа сохраняется (страница
 * читает историю в хронологии), битые строки отбрасываются.
 */
export function historyEntries(rows: readonly TradeRow[]): HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  for (const row of rows) {
    const to = asText(row.buyer_login);
    const price = asPrice(row.price_paid);
    if (to === null || price === null) continue;
    entries.push({
      from: asText(row.seller_login) ?? PURCHASE_SELLER_FALLBACK,
      to,
      price,
      buyer_uid: asText(row.buyer_uid) ?? '',
      created_at: asText(row.created_at) ?? '',
    });
  }
  return entries;
}

/**
 * События оффлайн-догона Колокольчика: сделки, где продавец — я, а лотом я
 * сейчас не владею (лот, выкупленный обратно, не висит в колоколе). Свежие
 * первыми, не больше `limit` событий. Битые строки отбрасываются.
 */
export function outbidCatchup(rows: readonly TradeRow[], uid: string, limit: number): LiveOutbid[] {
  const events: LiveOutbid[] = [];
  for (const row of rows) {
    if (asText(row.seller_uid) !== uid) continue;
    const lot = asLot(row.lots);
    if (lot === null) continue;
    const slug = asText(lot['slug']);
    if (slug === null) continue;
    // Лот уже выкуплен обратно — не тащим в историю.
    if (asText(lot['owner_uid']) === uid) continue;
    const price = asPrice(row.price_paid);
    const created = asText(row.created_at);
    const at = created === null ? NaN : Date.parse(created);
    if (price === null || !Number.isFinite(at)) continue;
    const title = asText(lot['title']);
    events.push({
      slug,
      title: title ?? slug,
      by: asText(row.buyer_login) ?? BUYER_FALLBACK,
      price,
      at,
      video: asText(lot['video_url']),
    });
  }
  events.sort((a, b) => b.at - a.at);
  return events.slice(0, Math.max(0, Math.floor(limit)));
}
