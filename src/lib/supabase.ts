/**
 * Единственный шов к Supabase Auth.
 *
 * - Клиент создаётся один раз на страницу (singleton), сессия долгая:
 *   persistSession + autoRefreshToken + detectSessionInUrl.
 * - Публичные значения — только через Astro public env
 *   (`PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_PUBLISHABLE_KEY`).
 *   Никаких `service_role`/DSN/паролей здесь нет и не будет.
 * - Провайдер Twitch и redirect-адреса настроены человеком в дашборде,
 *   код только вызывает signInWithOAuth/signOut и слушает сессию.
 * - Живые данные (снапшот каталога/лота/баланса/uid, каналы Realtime) — в
 *   lib/live.ts; здесь транспорт Supabase, запись покупки и хвосты перепродаж.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { historyEntries, outbidCatchup, type HistoryEntry, type TradeRow } from './trade-history';

const SUPABASE_URL = import.meta.env.PUBLIC_SUPABASE_URL as string | undefined;
const PUBLISHABLE_KEY = import.meta.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY as string | undefined;

/** Ключ отложенной покупки: какой Лот переоткрыть после возврата из логина. */
export const PENDING_BUY_KEY = 'alysque:pending-buy';

let client: SupabaseClient | null = null;

/** true, если человек вбил публичные ключи (внутреннее для гейта/клиента). */
function isSupabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && PUBLISHABLE_KEY);
}

/**
 * Билд-гейт: без публичных ключей сайт заведомо нерабочий (витрина и лоты —
 * проекция БД), поэтому на сборке падаем явно. Вызывается из BaseLayout —
 * отрисовка любой страницы. В рантайме деградация мягкая (getSupabase вернёт null).
 */
export function assertSupabaseConfigured(): void {
  if (!isSupabaseConfigured()) {
    throw new Error(
      'Сборка требует PUBLIC_SUPABASE_URL и PUBLIC_SUPABASE_PUBLISHABLE_KEY: ' +
        'витрина и лоты — проекция БД, запечённой статики нет.'
    );
  }
}

export function getSupabase(): SupabaseClient | null {
  if (client) return client;
  if (!isSupabaseConfigured()) return null;
  client = createClient(SUPABASE_URL as string, PUBLISHABLE_KEY as string, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  return client;
}

/**
 * Признак ошибки авторизации PostgREST (просроченный/невалидный JWT).
 * PGRST301 — JWT verification error; текстовый фолбэк — на случай другого
 * кода у supabase-js.
 */
export function isAuthError(error: unknown): boolean {
  const e = error as { code?: unknown; message?: unknown } | null;
  const code = typeof e?.code === 'string' ? e.code : '';
  const msg = typeof e?.message === 'string' ? e.message.toLowerCase() : '';
  return code === 'PGRST301' || msg.includes('jwt');
}

/**
 * Один best-effort ретрай чтения при 401: гонка обновления токена в SDK
 * (запрос ушёл со старым токеном во время refresh) гасит первый ответ.
 * Освежаем сессию и повторяем запрос; не вышло — возвращаем как есть.
 * Тип ответа сохраняется, потому что функция дженерик по нему.
 */
export async function withAuthRetry<R extends { error: unknown }>(
  run: () => PromiseLike<R>
): Promise<R> {
  const first = await run();
  if (!first.error || !isAuthError(first.error)) return first;
  const sb = getSupabase();
  if (!sb) return first;
  try {
    const { error: refreshError } = await sb.auth.refreshSession();
    if (refreshError) return first;
  } catch {
    return first;
  }
  return run();
}

/** Ник Чатерса из метаданных Twitch (login — только снапшот, см. спеку). */
export function displayLogin(
  user: { user_metadata?: Record<string, unknown> } | null | undefined
): string {
  const md = user?.user_metadata ?? {};
  const cand = md['user_name'] ?? md['preferred_username'] ?? md['name'];
  return typeof cand === 'string' && cand.length > 0 ? cand : 'чатерс';
}

/** Уводит в логин через Twitch с возвратом на `returnTo` (по умолчанию — сюда же). */
export async function signInWithTwitch(returnTo?: string): Promise<void> {
  const sb = getSupabase();
  if (!sb || typeof window === 'undefined') return;
  const redirectTo = returnTo ?? window.location.href.split('#')[0];
  await sb.auth.signInWithOAuth({
    provider: 'twitch',
    options: { redirectTo },
  });
}

export async function signOut(): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  await sb.auth.signOut();
}

/** Запомнить Лот, к которому вернуться после логина. */
export function stashPendingBuy(lotId: string): void {
  try {
    sessionStorage.setItem(PENDING_BUY_KEY, lotId);
  } catch {
    // приватный режим — возврат сработает через ?buy= в URL
  }
}

/** Прочитать запомненный Лот, не стирая его: возврат ждёт появления кнопки
 *  (витрина/страница рисуют карточку из БД уже после загрузки). */
export function peekPendingBuy(): string | null {
  let fromStorage: string | null = null;
  try {
    fromStorage = sessionStorage.getItem(PENDING_BUY_KEY);
  } catch {
    // приватный режим — вернёмся через ?buy= в URL
  }
  if (typeof window === 'undefined') return fromStorage;
  const fromUrl = new URL(window.location.href).searchParams.get('buy');
  return fromStorage ?? fromUrl;
}

/** Стереть запомненный Лот (после успешного возврата к нему) и убрать ?buy= из адреса. */
export function clearPendingBuy(): void {
  try {
    sessionStorage.removeItem(PENDING_BUY_KEY);
  } catch {
    // приватный режим — чистить нечего
  }
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (url.searchParams.has('buy')) {
    url.searchParams.delete('buy');
    window.history.replaceState(null, '', url.toString());
  }
}

/** URL возврата после логина: текущий адрес + ?buy=<lotId>. */
export function returnUrlForLot(lotId: string): string {
  const url = new URL(window.location.href);
  url.searchParams.set('buy', lotId);
  return url.toString().split('#')[0];
}

// ---------------------------------------------------------------------------
// Живая витрина.
//
// Каталог и лоты — снапшот живых данных (lib/live.ts, docs/adr/0003).
// Здесь остались хвост перепродаж и запись покупки. Без настроенных
// PUBLIC_SUPABASE_* — честная деградация: функции возвращают пусто; на сборке
// такие ключи обязательны (assertSupabaseConfigured).
// ---------------------------------------------------------------------------

/**
 * История перепродаж Лота из purchases: хвост сделок целиком (триммера до 50
 * строк в БД больше нет). `from` каждой записи — продавец из сделки
 * (`purchases.seller_*`, см. миграцию `*_purchase_seller.sql`), а не
 * реконструкция цепочки на клиенте. Лот не переехал в хранилище / ошибка →
 * пустая история.
 */
export async function fetchSharedHistory(slug: string): Promise<HistoryEntry[]> {
  const sb = getSupabase();
  if (!sb) return [];
  try {
    const { data: lot, error: lotError } = await withAuthRetry(() =>
      sb.from('lots').select('id').eq('slug', slug).single()
    );
    if (lotError || !lot) return [];
    const lotId = (lot as unknown as { id: number }).id;
    const { data, error } = await withAuthRetry(() =>
      sb
        .from('purchases')
        .select('seller_login,buyer_login,buyer_uid,price_paid,created_at')
        .eq('lot_id', lotId)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
    );
    if (error || !Array.isArray(data)) return [];
    return historyEntries(data as unknown as TradeRow[]);
  } catch {
    return [];
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
 * Оффлайн-догон колокольчика (без новой таблицы): один запрос по продавцу —
 * сделки, где я был продавцом, свежие сверху. Лот, выкупленный обратно,
 * исключает ядро (`lots.owner_uid == uid`), поэтому строк берётся с запасом
 * (`CATCHUP_OVERFETCH`), чтобы `limit` событий не худел на них. `since`
 * (epoch ms) — метка просмотра: отдаём только сделки новее неё, поэтому уже
 * виденное не всплывает при каждой загрузке страницы.
 */
export interface OutbidCatchupEntry {
  slug: string;
  title: string;
  by: string;
  price: number;
  at: number;
  video: string | null;
}

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

// ---------------------------------------------------------------------------
// Shared-покупка.
//
// Контракт с БД (см. supabase/migrations/*_shared_lots.sql): клиент делает один
// INSERT в purchases только с lot_id + buyer_uid. Цену (ceil +10%), identity
// (twitch_id/login из JWT), паузу 30с per-(user,lot), кап 10 покупок/10мин
// и гейт денег (`insufficient funds`) считает BEFORE-триггер —
// клиентские значения цены/identity игнорируются.
// Успех — только после confirm сервера (ответ без error).
// ---------------------------------------------------------------------------

/** Лоты в БД живут по slug: он же ключ страницы лота (`/lot/?id=<slug>`). */
export interface SharedPurchase {
  price_paid: number;
  buyer_login: string;
}

/**
 * Сырой примитив shared-покупки: resolve slug → bigint id, затем INSERT
 * { lot_id, buyer_uid } и ожидание confirm. Бросает исходную ошибку —
 * доменный итог собирает buyLot из lib/lots.ts (свежая N + маппинг ошибок).
 */
export async function buyLotShared(slug: string): Promise<SharedPurchase> {
  const sb = getSupabase();
  if (!sb) throw new Error('supabase not configured');
  const { data: sessionData } = await sb.auth.getSession();
  const uid = sessionData.session?.user.id;
  if (!uid) throw new Error('not authenticated');
  const { data: lot, error: lotError } = await sb
    .from('lots')
    .select('id')
    .eq('slug', slug)
    .single();
  if (lotError || !lot) throw new Error(`lot ${slug} not found`);
  const lotId = (lot as unknown as { id: number }).id;
  const { data, error } = await sb
    .from('purchases')
    .insert({ lot_id: lotId, buyer_uid: uid })
    .select('price_paid,buyer_login')
    .single();
  if (error) throw error;
  const row = data as unknown as { price_paid: number; buyer_login: string };
  return { price_paid: Number(row.price_paid), buyer_login: String(row.buyer_login) };
}
