/**
 * Намерение покупки: тип и один слот на кнопке (`data-buy-intent`).
 *
 * Кандидат C архитектурного ревью: раньше намерение «купить этот Лот» ехало
 * шестью data-атрибутами (`data-buy-lot`, `data-lot-title`, …): писали двое
 * (fillBuyButton, makeRebuyButton), читал третий (BuyModal), а правило
 * «не хватает Пивкойнов» было продублировано на обеих сторонах шва.
 *
 * - Носитель — один JSON-атрибут `data-buy-intent` (пустой — слот до
 *   заполнения): поля обновляются атомарно, разбор и проверка формы — здесь.
 * - `price: null` — следующая цена N неизвестна (вью нет / прайс не приехал):
 *   показ даёт «…», гейт не применяется — цену всё равно считает сервер.
 * - `buyAvailability` — единственное правило доступности: цена известна и
 *   баланс меньше — «short». Гейт серверный, это зеркало для честной кнопки.
 * - Тексты кнопок — у поверхностей (витрина и модалка говорят по-разному);
 *   общим остаётся состояние, не копирайт.
 *
 * Тесты чистой части — src/lib/buy-intent.test.ts.
 */

/** Намерение «купить этот Лот»: всё, что кнопка передаёт модалке. */
export interface BuyIntent {
  slug: string;
  title: string;
  /** Следующая цена (N) из каталога; null — неизвестна, показ «…». */
  price: number | null;
  owner: string;
  video: string | null;
}

/** Состояние доступности кнопки; «свой лот» — не намерение, решает поверхность. */
export type BuyAvailability = 'available' | 'short' | 'unknown';

/** Единственный формат слота: JSON с известным набором полей. */
export function serializeBuyIntent(intent: BuyIntent): string {
  return JSON.stringify({
    slug: intent.slug,
    title: intent.title,
    price: intent.price,
    owner: intent.owner,
    video: intent.video,
  });
}

/** Разобрать и проверить форму слота; чужая/битая форма — null целиком. */
export function parseBuyIntent(raw: unknown): BuyIntent | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const slug = row['slug'];
  const title = row['title'];
  const price = row['price'];
  const owner = row['owner'];
  const video = row['video'];
  if (typeof slug !== 'string' || slug.length === 0) return null;
  if (typeof title !== 'string' || title.length === 0) return null;
  if (typeof owner !== 'string') return null;
  if (price !== null && !(typeof price === 'number' && Number.isFinite(price) && price > 0)) {
    return null;
  }
  if (video !== null && (typeof video !== 'string' || video.length === 0)) return null;
  return { slug, title, price, owner, video };
}

/** Единственное правило доступности: не хватает — цена известна и баланс меньше. */
export function buyAvailability(intent: BuyIntent, balance: number | null): BuyAvailability {
  if (intent.price === null) return 'unknown';
  if (balance !== null && balance < intent.price) return 'short';
  return 'available';
}

/** Показ цены: неизвестная N — честное «…», не догадка. */
export function formatStaged(price: number | null): string {
  return price === null ? '…' : String(price);
}

/** Записать намерение на кнопку — единственный писатель-контракт. */
export function writeBuyIntent(el: Element | null, intent: BuyIntent): void {
  if (!(el instanceof HTMLElement)) return;
  el.dataset.buyIntent = serializeBuyIntent(intent);
}

/** Прочитать намерение с кнопки; пустой/битый слот — null. */
export function readBuyIntent(el: Element | null): BuyIntent | null {
  if (!(el instanceof HTMLElement)) return null;
  return parseBuyIntent(el.dataset.buyIntent);
}

/** Обновить только цену (живой прайс кнопок возврата); без намерения — noop. */
export function updateBuyIntentPrice(el: Element | null, price: number | null): void {
  const intent = readBuyIntent(el);
  if (!intent) return;
  writeBuyIntent(el, { ...intent, price });
}

/** Найти кнопку покупки Лота в DOM (возврат из логина) — по слоту намерения. */
export function findBuyButton(slug: string): HTMLElement | null {
  if (typeof document === 'undefined' || slug.length === 0) return null;
  for (const node of document.querySelectorAll('[data-buy-intent]')) {
    const intent = readBuyIntent(node);
    if (intent && intent.slug === slug && node instanceof HTMLElement) return node;
  }
  return null;
}
