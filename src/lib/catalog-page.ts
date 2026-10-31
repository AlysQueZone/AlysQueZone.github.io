/**
 * Листание витрины страницами: чистая механика без DOM и сети.
 *
 * Витрина идёт от дешёвых к дорогим. Страница читается keyset-курсором по
 * паре `(price, slug)` — цена меняется от перекупов, поэтому slug добивает
 * ничью, а не offset: живые вставки не сдвигают границу страниц.
 *
 * Окно — загруженные страницы в порядке показа. Лот, пришедший по Realtime,
 * вставляется, только если по цене попадает в это окно (иначе ждёт своей
 * страницы). Уже показанные карточки не переезжают: место меняет лишь
 * вставка нового лота.
 *
 * Тесты — src/lib/catalog-page.test.ts.
 */

/** Размер страницы витрины: один на транспорт, снапшот и скелетоны страницы. */
export const CATALOG_PAGE_SIZE = 12;

/** Место лота в порядке витрины: цена, затем slug (ничья по цене). */
export interface CatalogKey {
  price: number;
  slug: string;
}

/** Курсор следующей страницы — место последней показанной записи. */
export type CatalogCursor = CatalogKey;

/** Порядок витрины: дешевле — раньше; при равной цене — по slug. */
export function compareCatalog(a: CatalogKey, b: CatalogKey): number {
  if (a.price !== b.price) return a.price < b.price ? -1 : 1;
  if (a.slug === b.slug) return 0;
  return a.slug < b.slug ? -1 : 1;
}

/** Курсор по последней записи страницы; пустая страница — курсора нет. */
export function catalogCursor(entries: readonly CatalogKey[]): CatalogCursor | null {
  const last = entries.at(-1);
  return last ? { price: last.price, slug: last.slug } : null;
}

/**
 * Помещается ли живой лот в загруженное окно: до последней загруженной
 * записи по порядку витрины. Окно пустое или загружено всё — помещается.
 */
export function fitsCatalogWindow(
  entry: CatalogKey,
  last: CatalogKey | null,
  hasMore: boolean
): boolean {
  if (!hasMore || last === null) return true;
  return compareCatalog(entry, last) <= 0;
}

/** Дописать страницу снизу: дубли по slug отсекаются, порядок страницы — как есть. */
export function appendCatalogPage<T extends CatalogKey>(
  window: readonly T[],
  page: readonly T[]
): T[] {
  const seen = new Set(window.map((entry) => entry.slug));
  const next = [...window];
  for (const entry of page) {
    if (seen.has(entry.slug)) continue;
    seen.add(entry.slug);
    next.push(entry);
  }
  return next;
}

/**
 * Вставить живой лот в окно на место по цене; null — лот уже показан или
 * он дороже границы загруженного (придёт своей страницей). Граница — самый
 * дорогой показанный лот: цены растут, и последняя по загрузке карточка
 * может уже не быть верхней.
 */
export function insertCatalogEntry<T extends CatalogKey>(
  window: readonly T[],
  entry: T,
  hasMore: boolean
): T[] | null {
  if (window.some((item) => item.slug === entry.slug)) return null;
  let boundary: CatalogKey | null = null;
  for (const item of window) {
    if (boundary === null || compareCatalog(item, boundary) > 0) boundary = item;
  }
  if (!fitsCatalogWindow(entry, boundary, hasMore)) return null;
  const next = [...window];
  const at = next.findIndex((item) => compareCatalog(item, entry) > 0);
  next.splice(at < 0 ? next.length : at, 0, entry);
  return next;
}
