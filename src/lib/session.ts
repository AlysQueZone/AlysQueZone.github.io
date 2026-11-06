/**
 * Сессия Supabase: клиент, вход/выход и ретрай на просроченном токене.
 *
 * Владеет singleton-клиентом, публичным env и билд-гейтом, а также признаком
 * `displayLogin`. Не владеет снапшотом (uid, баланс, каталог — `live.ts`,
 * docs/adr/0003) и разовыми чтениями/записью (`purchases-read` /
 * `purchase-write`): это транспорт, а не состояние страницы.
 *
 * - Клиент создаётся один раз на страницу (singleton), сессия долгая:
 *   persistSession + autoRefreshToken + detectSessionInUrl.
 * - Публичные значения — только через Astro public env
 *   (`PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_PUBLISHABLE_KEY`).
 *   Никаких `service_role`/DSN/паролей здесь нет и не будет.
 * - Провайдер Twitch и redirect-адреса настроены человеком в дашборде,
 *   код только вызывает signInWithOAuth/signOut.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.PUBLIC_SUPABASE_URL as string | undefined;
const PUBLISHABLE_KEY = import.meta.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY as string | undefined;

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
 * кода у supabase-js. Внутреннее: снаружи только `withAuthRetry`.
 */
function isAuthError(error: unknown): boolean {
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

/** Ник Чатерса из метаданных Twitch (login — только снапшот). */
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
