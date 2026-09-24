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

/**
 * Билд-гейт: без публичных ключей сайт заведомо нерабочий (витрина и лоты —
 * проекция БД), поэтому на сборке падаем явно. Вызывается из BaseLayout —
 * отрисовка любой страницы. В рантайме деградация мягкая (isSupabaseConfigured).
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
// пусто, подписка — noop; на сборке такие ключи обязательны (assertSupabaseConfigured).
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
    const { data: lot, error: lotError } = await withAuthRetry(() =>
      sb.from('lots').select('id').eq('slug', slug).single()
    );
    if (lotError || !lot) return [];
    const lotId = (lot as unknown as { id: number }).id;
    const { data, error } = await withAuthRetry(() =>
      sb
        .from('purchases')
        .select('buyer_login,buyer_uid,price_paid,created_at')
        .eq('lot_id', lotId)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(50)
    );
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
 * Оффлайн-догон колокольчика (без новой таблицы).
 * Находит сделки, где я был продавцом: цепочка покупок лота, в которой
 * предыдущий покупатель — я, а следующий — уже не я. Текущие мои лоты
 * (lots.owner_uid == uid) исключаются — их уже выкупил обратно.
 * Первая продажа от сидового владельца без prior-покупки не покрывается:
 * продавец там вне цепочки purchases. Возвращает до `limit` свежих событий.
 */
export interface OutbidCatchupEntry {
  slug: string;
  title: string;
  by: string;
  price: number;
  at: number;
  video: string | null;
}

export async function fetchOutbidCatchup(uid: string, limit = 10): Promise<OutbidCatchupEntry[]> {
  const sb = getSupabase();
  if (!sb || !uid) return [];
  try {
    const { data: mine, error: mineError } = await withAuthRetry(() =>
      sb
        .from('purchases')
        .select('lot_id')
        .eq('buyer_uid', uid)
        .order('id', { ascending: false })
        .limit(200)
    );
    if (mineError || !Array.isArray(mine) || mine.length === 0) return [];
    const lotIds = [
      ...new Set(
        (mine as unknown as Record<string, unknown>[])
          .map((row) => Number(row['lot_id']))
          .filter((id) => Number.isFinite(id) && id > 0)
      ),
    ];
    if (lotIds.length === 0) return [];
    const { data, error } = await withAuthRetry(() =>
      sb
        .from('purchases')
        .select(
          'lot_id,buyer_uid,buyer_login,price_paid,created_at,lots(slug,title,video_url,owner_uid)'
        )
        .in('lot_id', lotIds)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(500)
    );
    if (error || !Array.isArray(data)) return [];
    const byLot = new Map<number, Record<string, unknown>[]>();
    for (const row of data as unknown as Record<string, unknown>[]) {
      const lotId = Number(row['lot_id']);
      if (!Number.isFinite(lotId)) continue;
      const list = byLot.get(lotId) ?? [];
      list.push(row);
      byLot.set(lotId, list);
    }
    const events: OutbidCatchupEntry[] = [];
    for (const rows of byLot.values()) {
      let prevBuyer: string | null = null;
      for (const row of rows) {
        const curBuyer = typeof row['buyer_uid'] === 'string' ? (row['buyer_uid'] as string) : '';
        const lot = row['lots'] as unknown as Record<string, unknown> | null;
        const slug = lot && typeof lot['slug'] === 'string' ? (lot['slug'] as string) : null;
        if (prevBuyer === uid && curBuyer !== uid && slug) {
          const price = Number(row['price_paid']);
          const created =
            typeof row['created_at'] === 'string' ? Date.parse(row['created_at']) : NaN;
          const ownerUid =
            lot && typeof lot['owner_uid'] === 'string' ? (lot['owner_uid'] as string) : null;
          // Лот уже выкуплен обратно — не тащим в историю.
          if (ownerUid !== uid && Number.isFinite(price) && price > 0) {
            events.push({
              slug,
              title:
                lot && typeof lot['title'] === 'string' && (lot['title'] as string).length > 0
                  ? (lot['title'] as string)
                  : slug,
              by:
                typeof row['buyer_login'] === 'string' && (row['buyer_login'] as string).length > 0
                  ? (row['buyer_login'] as string)
                  : 'Чатерс',
              price,
              at: Number.isFinite(created) ? created : Date.now(),
              video:
                lot &&
                typeof lot['video_url'] === 'string' &&
                (lot['video_url'] as string).length > 0
                  ? (lot['video_url'] as string)
                  : null,
            });
          }
        }
        prevBuyer = curBuyer || prevBuyer;
      }
    }
    return events.sort((a, b) => b.at - a.at).slice(0, Math.max(1, limit));
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
