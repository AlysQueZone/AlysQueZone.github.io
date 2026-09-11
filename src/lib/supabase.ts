/**
 * Единственный шов к Supabase Auth (тикет 09, shared-state).
 *
 * - Клиент создаётся один раз на страницу (singleton), сессия долгая:
 *   persistSession + autoRefreshToken + detectSessionInUrl.
 * - Публичные значения — только через Astro public env
 *   (`PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_PUBLISHABLE_KEY`).
 *   Никаких `service_role`/DSN/паролей здесь нет и не будет.
 * - Провайдер Twitch и redirect-адреса настроены человеком в дашборде,
 *   код только вызывает signInWithOAuth/signOut и слушает сессию.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.PUBLIC_SUPABASE_URL as string | undefined;
const PUBLISHABLE_KEY = import.meta.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY as string | undefined;

/** Ключ отложенной покупки: какой Лот переоткрыть после возврата из логина. */
export const PENDING_BUY_KEY = 'alysque:pending-buy';

let client: SupabaseClient | null = null;

/** true, если человек вбил публичные ключи (иначе кнопки деградируют честно). */
export function isSupabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && PUBLISHABLE_KEY);
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

/** Забрать и стереть запомненный Лот (одноразово). */
export function takePendingBuy(): string | null {
  let fromStorage: string | null = null;
  try {
    fromStorage = sessionStorage.getItem(PENDING_BUY_KEY);
    sessionStorage.removeItem(PENDING_BUY_KEY);
  } catch {
    // приватный режим — возврат сработает через ?buy= в URL
  }
  if (typeof window === 'undefined') return fromStorage;
  const fromUrl = new URL(window.location.href).searchParams.get('buy');
  const id = fromStorage ?? fromUrl;
  if (fromUrl) {
    const url = new URL(window.location.href);
    url.searchParams.delete('buy');
    window.history.replaceState(null, '', url.toString());
  }
  return id;
}

/** URL возврата после логина: текущий адрес + ?buy=<lotId>. */
export function returnUrlForLot(lotId: string): string {
  const url = new URL(window.location.href);
  url.searchParams.set('buy', lotId);
  return url.toString().split('#')[0];
}

// ---------------------------------------------------------------------------
// Живая витрина (тикет 09, shared-state).
//
// Каталог (названия, video_url) живёт в БД (public.lots), живой слой поверх —
// в lib/lots.ts (fetchLotCatalog: вью lots_with_next_price одним запросом).
// Здесь остались сырой адаптер подписки, хвост перепродаж и покупка.
// Без настроенных PUBLIC_SUPABASE_* — честная деградация: функции возвращают
// пусто, подписка — noop, страница показывает запечённый на билде каталог.
// ---------------------------------------------------------------------------

/** Одна запись общего хвоста перепродаж: from — предыдущий Владелец. */
export interface SharedHistoryEntry {
  from: string;
  to: string;
  price: number;
  buyer_uid: string;
  created_at: string;
}

/** uid текущей сессии (для бейджа «ТВОЙ»); null — Чатерс не вошёл. */
export async function getSessionUid(): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return null;
  try {
    const { data } = await sb.auth.getSession();
    return data.session?.user.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Общий хвост перепродаж Лота из purchases (до 50, как режет AFTER-триггер).
 * from первой записи — staticOwner (Владелец из каталога), дальше цепочка:
 * from[i] = to[i-1]. Лот не переехал в хранилище / ошибка → пустой хвост.
 */
export async function fetchSharedHistory(
  slug: string,
  staticOwner: string | null
): Promise<SharedHistoryEntry[]> {
  const sb = getSupabase();
  if (!sb) return [];
  try {
    const { data: lot, error: lotError } = await sb
      .from('lots')
      .select('id')
      .eq('slug', slug)
      .single();
    if (lotError || !lot) return [];
    const lotId = (lot as unknown as { id: number }).id;
    const { data, error } = await sb
      .from('purchases')
      .select('buyer_login,buyer_uid,price_paid,created_at')
      .eq('lot_id', lotId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(50);
    if (error || !Array.isArray(data)) return [];
    const rows = data as unknown as Record<string, unknown>[];
    let prev = staticOwner && staticOwner.length > 0 ? staticOwner : '—';
    return rows.flatMap((row) => {
      const to = row['buyer_login'];
      const price = Number(row['price_paid']);
      if (typeof to !== 'string' || !Number.isFinite(price)) return [];
      const entry: SharedHistoryEntry = {
        from: prev,
        to,
        price,
        buyer_uid: typeof row['buyer_uid'] === 'string' ? (row['buyer_uid'] as string) : '',
        created_at: typeof row['created_at'] === 'string' ? (row['created_at'] as string) : '',
      };
      prev = to;
      return [entry];
    });
  } catch {
    return [];
  }
}

/**
 * Живая подписка на смену Лотов (postgres_changes по таблице lots).
 * Без настроенного хранилища — noop-отписка. Возвращает функцию отписки.
 */
export function subscribeSharedLots(onChange: () => void, slug?: string): () => void {
  const sb = getSupabase();
  if (!sb) return () => {};
  try {
    const channel = sb.channel(slug ? `alysque:lot:${slug}` : 'alysque:lots', {
      config: { broadcast: { self: false } },
    });
    const filter = slug
      ? { event: '*' as const, schema: 'public', table: 'lots', filter: `slug=eq.${slug}` }
      : { event: '*' as const, schema: 'public', table: 'lots' };
    channel.on('postgres_changes', filter, () => onChange()).subscribe();
    return () => {
      try {
        void sb.removeChannel(channel);
      } catch {
        // отписка — best effort
      }
    };
  } catch {
    return () => {};
  }
}

// ---------------------------------------------------------------------------
// Shared-покупка (тикет 10, shared-state).
//
// Контракт с БД (см. supabase/migrations/*_shared_lots.sql): клиент делает один
// INSERT в purchases только с lot_id + buyer_uid. Цену (ceil +10%), identity
// (twitch_id/login из JWT), паузу 30с per-(user,lot), кап 10 покупок/10мин
// и гейт денег (`insufficient funds` — тикет 08) считает BEFORE-триггер —
// клиентские значения цены/identity игнорируются.
// Успех — только после confirm сервера (ответ без error).
// ---------------------------------------------------------------------------

/** Лоты в БД живут по slug = статичному id из каталога (сидирование — тикет 12). */
export interface SharedPurchase {
  price_paid: number;
  buyer_login: string;
}

export type BuyErrorKind =
  | 'cooldown'
  | 'rate-limit'
  | 'own-lot'
  | 'insufficient-funds'
  | 'unauthenticated'
  | 'missing-lot'
  | 'price-cap'
  | 'offline'
  | 'write-error';

export interface BuyErrorInfo {
  kind: BuyErrorKind;
  /** Для паузы — сколько секунд ждать (парсится из текста триггера). */
  retryAfterSec?: number;
  raw: string;
}

/** Запасная пауза, если текст триггера не распарсился (в миграции — 30с). */
export const BUY_COOLDOWN_FALLBACK_SEC = 30;

function buyErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null && 'message' in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}

function parseCooldownSec(msg: string): number {
  const hms = msg.match(/(\d+):(\d{2}):(\d{2})/);
  if (hms) {
    const sec = Number(hms[1]) * 3600 + Number(hms[2]) * 60 + Number(hms[3]);
    if (Number.isFinite(sec) && sec > 0 && sec <= 3600) return sec;
  }
  const sec = msg.match(/(\d+)\s*(?:s|sec|сек)/i);
  if (sec) {
    const n = Number(sec[1]);
    if (Number.isFinite(n) && n > 0 && n <= 3600) return n;
  }
  return BUY_COOLDOWN_FALLBACK_SEC;
}

/**
 * Маппинг ошибок Postgres/триггера на честные виды.
 * Матчится по коду/сообщению триггера: cooldown / rate limit /
 * not authenticated (см. enforce_purchase_rules в миграциях).
 */
export function mapBuyError(err: unknown): BuyErrorInfo {
  const raw = buyErrorMessage(err);
  const low = raw.toLowerCase();
  if (low.includes('cooldown')) {
    return { kind: 'cooldown', retryAfterSec: parseCooldownSec(raw), raw };
  }
  if (low.includes('rate limit') || low.includes('max ') || low.includes('too many')) {
    return { kind: 'rate-limit', raw };
  }
  if (low.includes('already yours')) {
    return { kind: 'own-lot', raw };
  }
  if (
    low.includes('not authenticated') ||
    low.includes('row-level security') ||
    low.includes('jwt') ||
    low.includes('no twitch identity')
  ) {
    return { kind: 'unauthenticated', raw };
  }
  if (low.includes('not found')) {
    return { kind: 'missing-lot', raw };
  }
  if (low.includes('price cap')) {
    return { kind: 'price-cap', raw };
  }
  // Деньги покупки — серверный гейт (тикет 08, BEFORE-триггер):
  // счёта нет или баланса не хватило на серверную цену.
  if (low.includes('insufficient funds') || low.includes('insufficient_funds')) {
    return { kind: 'insufficient-funds', raw };
  }
  if (
    low.includes('failed to fetch') ||
    low.includes('networkerror') ||
    low.includes('network error') ||
    low.includes('load failed') ||
    low.includes('offline') ||
    err instanceof TypeError
  ) {
    return { kind: 'offline', raw };
  }
  return { kind: 'write-error', raw };
}

/**
 * Shared-покупка одним вызовом: resolve slug → bigint id, затем INSERT
 * { lot_id, buyer_uid } и ожидание confirm. Бросает исходную ошибку —
 * маппить через mapBuyError на стороне UI.
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
