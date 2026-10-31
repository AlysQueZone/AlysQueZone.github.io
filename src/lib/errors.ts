/**
 * Ошибки транспорта: один классификатор (решение —
 * docs/adr/0006).
 *
 * Доменные виды (пауза, лимит, не хватает Пивкойнов, сроки заявки)
 * остаются у своих мапперов — здесь только общее.
 *
 * Чистые функции без DOM и сети: тесты — src/lib/errors.test.ts.
 */

/** Текст ошибки из Error / PostgrestError / чего угодно — одна форма. */
export function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null && 'message' in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}

const OFFLINE_MARKERS = [
  'failed to fetch',
  'networkerror',
  'network error',
  'load failed',
  'offline',
];

export function isOfflineError(err: unknown): boolean {
  const low = errorText(err).toLowerCase();
  return OFFLINE_MARKERS.some((marker) => low.includes(marker)) || err instanceof TypeError;
}

// 'no twitch identity' шлют покупочные RPC
// (в JWT нет twitch-личности) — это тот же «нет входа», а не отдельная болезнь.
const NO_AUTH_MARKERS = ['not authenticated', 'row-level security', 'jwt', 'no twitch identity'];

export function isNoAuthError(err: unknown): boolean {
  const low = errorText(err).toLowerCase();
  return NO_AUTH_MARKERS.some((marker) => low.includes(marker));
}
