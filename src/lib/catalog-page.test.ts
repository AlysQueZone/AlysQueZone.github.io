/**
 * Тесты механики листания витрины: порядок, курсор, граница окна, склейка
 * страниц и живая вставка. Без DOM и сети — как соседние ядра.
 */
import { describe, expect, it } from 'vitest';
import {
  appendCatalogPage,
  catalogCursor,
  compareCatalog,
  fitsCatalogWindow,
  insertCatalogEntry,
  type CatalogKey,
} from './catalog-page';

function entry(slug: string, price: number): CatalogKey {
  return { slug, price };
}

describe('catalog-page', () => {
  it('порядок витрины: дешевле раньше, при равной цене — по slug', () => {
    const rows = [entry('b', 200), entry('a', 200), entry('c', 100)];
    expect([...rows].sort(compareCatalog).map((row) => row.slug)).toEqual(['c', 'a', 'b']);
  });

  it('курсор — последняя запись страницы; пустая страница курсора не даёт', () => {
    expect(catalogCursor([entry('a', 100), entry('b', 200)])).toEqual({ price: 200, slug: 'b' });
    expect(catalogCursor([])).toBeNull();
  });

  it('граница окна: до последней загруженной записи; загружено всё — любая', () => {
    expect(fitsCatalogWindow(entry('a', 100), entry('b', 200), true)).toBe(true);
    // Тот же slug — та же запись; после неё по порядку — уже следующая страница.
    expect(fitsCatalogWindow(entry('b', 200), entry('b', 200), true)).toBe(true);
    expect(fitsCatalogWindow(entry('c', 200), entry('b', 200), true)).toBe(false);
    expect(fitsCatalogWindow(entry('c', 201), entry('b', 200), true)).toBe(false);
    // Дороже по цене, но slug решает ничью.
    expect(fitsCatalogWindow(entry('a', 200), entry('b', 200), true)).toBe(true);
    expect(fitsCatalogWindow(entry('z', 9999), entry('b', 200), false)).toBe(true);
    expect(fitsCatalogWindow(entry('a', 100), null, true)).toBe(true);
  });

  it('страница дописывается снизу, дубли по slug не задваиваются', () => {
    const window = [entry('a', 100), entry('b', 200)];
    const page = [entry('b', 250), entry('c', 300)];
    expect(appendCatalogPage(window, page).map((row) => row.slug)).toEqual(['a', 'b', 'c']);
    // Исходное окно не мутируется.
    expect(window.map((row) => row.slug)).toEqual(['a', 'b']);
  });

  it('живой лот вставляется на место по цене, уже показанный не двигается', () => {
    const window = [entry('a', 100), entry('c', 300)];
    const inserted = insertCatalogEntry(window, entry('b', 200), true);
    expect(inserted?.map((row) => row.slug)).toEqual(['a', 'b', 'c']);
    expect(insertCatalogEntry(window, entry('c', 150), true)).toBeNull();
  });

  it('живой лот дороже границы загруженного ждёт своей страницы', () => {
    const window = [entry('a', 100), entry('b', 200)];
    expect(insertCatalogEntry(window, entry('z', 900), true)).toBeNull();
    // Всё загружено — окно уже полное, лот вставляется.
    expect(insertCatalogEntry(window, entry('z', 900), false)?.map((row) => row.slug)).toEqual([
      'a',
      'b',
      'z',
    ]);
  });

  it('граница живой вставки — самый дорогой показанный лот, а не последний по загрузке', () => {
    // Цена b выросла перекупом: b теперь дороже последней загруженной c.
    const window = [entry('a', 100), entry('b', 600), entry('c', 200)];
    expect(insertCatalogEntry(window, entry('d', 400), true)).not.toBeNull();
    expect(insertCatalogEntry(window, entry('d', 700), true)).toBeNull();
  });
});
