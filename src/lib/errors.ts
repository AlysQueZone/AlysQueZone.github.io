/**
 * Ошибки транспорта: один классификатор (кандидат F ревью).
 *
 * Текст ошибки и два частых вида — офлайн и «нет входа» — были скопированы
 * в lots.ts / gamba.ts / submissions.ts (и ещё раз инлайном в DailyLogin):
 * правка офлайн-гейта требовала четырёх заходов. Доменные виды (пауза,
 * лимит, не хватает Пивкойнов, сроки заявки) остаются у своих мапперов —
 * здесь только общее.
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

/** Сеть не дошла: маркеры транспорта или TypeError от fetch. */
export function isOfflineError(err: unknown): boolean {
  const low = errorText(err).toLowerCase();
  return OFFLINE_MARKERS.some((marker) => low.includes(marker)) || err instanceof TypeError;
}

const NO_AUTH_MARKERS = ['not authenticated', 'row-level security', 'jwt', 'no twitch identity'];

/** Нет входа/сессия не прошла: JWT, RLS, «not authenticated», нет twitch-личности. */
export function isNoAuthError(err: unknown): boolean {
  const low = errorText(err).toLowerCase();
  return NO_AUTH_MARKERS.some((marker) => low.includes(marker));
}
