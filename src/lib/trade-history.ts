/**
 * Чтение сделок: строки `purchases` → то, что видит чатерс.
 *
 * Чистое ядро без DOM и сети (как соседи — реестр живых подписок, снапшот,
 * намерение покупки): единственная точка, где строки сделок превращаются в
 * записи истории перепродаж и в события оффлайн-догона Колокольчика. Здесь же
 * вся механика показа истории: курсор следующей страницы, слияние свежей
 * страницы с показанной и относительное время. Поверхность страницы лота
 * только рисует то, что вернуло ядро.
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

/** Размер страницы «Истории перепродаж»: один на транспорт и поверхность. */
export const HISTORY_PAGE_SIZE = 10;

/** Одна запись истории перепродаж: `from → to · price`; `buyer_uid` — пометка «ТВОЙ». */
export interface HistoryEntry {
  /** Номер строки `purchases` — ключ дедупа при слиянии и вторая часть курсора. */
  id: number;
  from: string;
  to: string;
  price: number;
  buyer_uid: string;
  created_at: string;
}

/**
 * Курсор следующей страницы (keyset по паре `(created_at, id)`): транспорт
 * добавляет условие «строго старее последней показанной записи». Пара, а не
 * одно время, — у соседних сделок бывает одинаковый `created_at`, и по одному
 * времени страница потеряла бы или задвоила строку.
 */
export interface HistoryCursor {
  created_at: string;
  id: number;
}

/**
 * Строка `purchases` в том виде, как её отдаёт PostgREST: поля сделки плюс
 * соединённый лот (`lots(slug,title,video_url,owner_uid)`). Всё `unknown` —
 * вход приходит из сети, ядро само проверяет форму и отбрасывает битое.
 */
export interface TradeRow {
  id?: unknown;
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

/** Конечный положительный id строки или null (без него курсор и дедуп не стоят). */
function asId(value: unknown): number | null {
  const id = Number(value);
  return Number.isFinite(id) && id > 0 ? id : null;
}

/** Разбираемая метка времени или null: строка без времени — не сделка. */
function asTime(value: unknown): string | null {
  const text = asText(value);
  return text !== null && Number.isFinite(Date.parse(text)) ? text : null;
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
 * не было), `to` = покупатель, цена — числом. Порядок входа сохраняется
 * (страница запрашивает новые первыми), битые строки отбрасываются: без id или
 * времени запись не годится ни для курсора, ни для показа.
 */
export function historyEntries(rows: readonly TradeRow[]): HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  for (const row of rows) {
    const id = asId(row.id);
    const to = asText(row.buyer_login);
    const price = asPrice(row.price_paid);
    const created_at = asTime(row.created_at);
    if (id === null || to === null || price === null || created_at === null) continue;
    entries.push({
      id,
      from: asText(row.seller_login) ?? PURCHASE_SELLER_FALLBACK,
      to,
      price,
      buyer_uid: asText(row.buyer_uid) ?? '',
      created_at,
    });
  }
  return entries;
}

/**
 * Курсор следующей страницы по показанным записям: последняя из них — самая
 * старая. Пустая история или запись без времени — курсора нет (дальше читать
 * нечего).
 */
export function historyCursor(entries: readonly HistoryEntry[]): HistoryCursor | null {
  const oldest = entries[entries.length - 1];
  if (!oldest || oldest.created_at.length === 0) return null;
  return { created_at: oldest.created_at, id: oldest.id };
}

/** Записи страницы, которых нет среди показанных, — по `id` (порядок сохраняется). */
function unseenBy(shown: readonly HistoryEntry[], page: readonly HistoryEntry[]): HistoryEntry[] {
  if (page.length === 0) return [];
  const known = new Set(shown.map((entry) => entry.id));
  return page.filter((entry) => !known.has(entry.id));
}

/**
 * Слить свежую первую страницу с уже показанными записями: новые — сверху,
 * дубли отсекаются по `id`, пролистанное остаётся на месте. Пустая свежая
 * страница ничего не меняет (живой перекуп без новых сделок). Свежая страница —
 * это всегда самые новые сделки лота, поэтому каждая её новая строка старее
 * только что добавленных и новее всех показанных.
 */
export function mergeHistory(
  shown: readonly HistoryEntry[],
  fresh: readonly HistoryEntry[]
): HistoryEntry[] {
  const added = unseenBy(shown, fresh);
  return added.length === 0 ? [...shown] : [...added, ...shown];
}

/**
 * Дописать следующую (более старую) страницу снизу: дубли по `id` отсекаются —
 * пока страница грузилась, живой перекуп мог приклеить сверху те же сделки.
 * Показанное не сдвигается: список не прыгает под прокруткой.
 */
export function appendHistory(
  shown: readonly HistoryEntry[],
  page: readonly HistoryEntry[]
): HistoryEntry[] {
  const older = unseenBy(shown, page);
  return older.length === 0 ? [...shown] : [...shown, ...older];
}

/** Короткие месяцы для даты сделки старше недели («16 окт»). */
const MONTHS_SHORT = [
  'янв',
  'фев',
  'мар',
  'апр',
  'мая',
  'июн',
  'июл',
  'авг',
  'сен',
  'окт',
  'ноя',
  'дек',
];

/**
 * Относительное время сделки в локальной зоне браузера: «только что», минуты,
 * часы, «вчера», дни, дальше — короткая дата. В БД время остаётся UTC
 * (`timestamptz`), на локальную зону его переводит `Date`. `now` — инъекция
 * для тестов; битая дата — пусто.
 */
export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return '';
  const minutes = Math.floor(Math.max(0, now - at) / 60_000);
  if (minutes < 1) return 'только что';
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'вчера';
  if (days < 7) return `${days} дн назад`;
  const date = new Date(at);
  return `${date.getDate()} ${MONTHS_SHORT[date.getMonth()]}`;
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
