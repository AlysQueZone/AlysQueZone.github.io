/**
 * Профиль чатерса: чистое ядро паспорта — без DOM и сети.
 *
 * Владеет адресом профиля (`profileHref`), разбором `?uid=` и маппингом строки
 * `public_profile` в статы паспорта, а также форматами `ru-RU` для даты и чисел.
 * Не владеет запросом (транспорт — `profile-read`) и разметкой (страница):
 * поверхности 02–07 берут ссылку и статы отсюда, второй формулы не заводят.
 *
 * UID — вечная идентичность, логин — подпись: битый/пустой uid отсекается здесь,
 * чтобы Postgres не получил cast (22P02); логина может не быть — паспорт живёт
 * по uid («@чатерс», инициалы «?»).
 *
 * Даты считаются по UTC: дата регистрации — календарный день, а не деньги, зато
 * одинаковая у всех и в тестах. Числа — `ru-RU` (неразрывный разделитель).
 *
 * Тесты — src/lib/profile.test.ts.
 */

/** Строка `public_profile` в том виде, как её отдаёт PostgREST; поля — `unknown`. */
export interface ProfileRow {
  user_id?: unknown;
  login?: unknown;
  balance?: unknown;
  created_at?: unknown;
  capital?: unknown;
  lots_count?: unknown;
}

/** Статы паспорта: всё, что нужно странице профиля, уже разобрано. */
export interface ProfileStats {
  /** Канонический uuid профиля (нижний регистр). */
  uid: string;
  /** Логин из БД или null: подпись может отсутствовать. */
  login: string | null;
  /** Подпись на экране: `@login` или `@чатерс`. */
  caption: string;
  /** Инициалы для квадрата без аватара: «SQ», «BR»; нет логина — «?». */
  initials: string;
  /** `created_at` как ISO — для `formatProfileDate`. */
  joinedAt: string;
  balance: number;
  /** «Баланс + приветы» (капитал): word «Капитал» на экран не выводится. */
  capital: number;
  lotsCount: number;
}

/** Канонический uuid: 8-4-4-4-12 hex. Всё остальное — не uid. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Разобрать uid из значения query: trim, форма uuid, нижний регистр.
 * null — битый/пустой uid; RPC тогда не зовём (Postgres упал бы на cast).
 */
export function parseProfileUid(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim().toLowerCase();
  return UUID_RE.test(text) ? text : null;
}

/** UID из query-строки (`?uid=…`); нет параметра или он битый — null. */
export function profileUidFromQuery(search: string): string | null {
  return parseProfileUid(new URLSearchParams(search).get('uid'));
}

/**
 * Адрес профиля по uid — один на все поверхности. `null`/пусто — ссылки нет:
 * «Биржа», свободный лот и ник без uid остаются текстом.
 */
export function profileHref(uid: string | null | undefined): string | null {
  const text = typeof uid === 'string' ? uid.trim() : '';
  if (text.length === 0) return null;
  return `${import.meta.env.BASE_URL}profile/?uid=${encodeURIComponent(text)}`;
}

/** Подпись в паспорте: `@login`; логина нет — `@чатерс` (не выдумываем ник). */
export function profileCaption(login: unknown): string {
  const text = typeof login === 'string' ? login.trim().replace(/^@+/, '') : '';
  return `@${text || 'чатерс'}`;
}

/**
 * Инициалы для квадрата вместо аватара: первые буквы слов логина, camelCase и
 * разделители (`_`, `-`, точка) режут слова. Одно слово — две первые буквы;
 * логина нет — «?».
 */
export function profileInitials(login: unknown): string {
  const text = typeof login === 'string' ? login.trim().replace(/^@+/, '') : '';
  if (text.length === 0) return '?';
  const words = text
    .replace(/([a-zа-яё0-9])([A-ZА-ЯЁ])/g, '$1 $2')
    .split(/[^0-9A-Za-zА-Яа-яЁё]+/)
    .filter((word) => word.length > 0);
  const first = words[0]?.[0] ?? '';
  const second = words[1]?.[0] ?? words[0]?.[1] ?? '';
  return (first + second).toUpperCase();
}

/** Конечное неотрицательное число из сети или null (`null` — не ноль). */
function asAmount(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && value.trim().length === 0) return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

/** Целое неотрицательное число приветов или null. */
function asCount(value: unknown): number | null {
  const count = asAmount(value);
  return count !== null && Number.isInteger(count) ? count : null;
}

/**
 * Строка `public_profile` → статы паспорта. Битые id/числа/время — null:
 * показываем «не загрузилось», а не нули. Ноль приветов и нулевой капитал —
 * валидные статы (пустой профиль существует).
 */
export function profileStats(row: ProfileRow | null | undefined): ProfileStats | null {
  if (!row || typeof row !== 'object') return null;
  const uid = parseProfileUid(typeof row.user_id === 'string' ? row.user_id : null);
  const joinedAt =
    typeof row.created_at === 'string' && Number.isFinite(Date.parse(row.created_at))
      ? row.created_at
      : null;
  const balance = asAmount(row.balance);
  const capital = asAmount(row.capital);
  const lotsCount = asCount(row.lots_count);
  if (uid === null || joinedAt === null || balance === null || capital === null) return null;
  if (lotsCount === null) return null;
  const login =
    typeof row.login === 'string' && row.login.trim().length > 0 ? row.login.trim() : null;
  return {
    uid,
    login,
    caption: profileCaption(login),
    initials: profileInitials(login),
    joinedAt,
    balance,
    capital,
    lotsCount,
  };
}

/**
 * Дата регистрации «12 сентября 2026»: русские месяцы, без «г.». UTC — дата
 * одинаковая у всех; битая дата — пусто.
 */
export function formatProfileDate(iso: string): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return '';
  const parts = new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).formatToParts(new Date(at));
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((item) => item.type === type)?.value ?? '';
  return `${part('day')} ${part('month')} ${part('year')}`.trim();
}

/** Число по-русски: «4 320»; не число — прочерк (не «NaN» на экране). */
export function formatProfileNumber(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value);
}
