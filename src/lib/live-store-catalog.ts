/**
 * Срез каталога: режим поверхности, окно, курсор, вставки и дифф.
 *
 * Контракт: поверхность объявляет срез до первого чтения (страницы витрины,
 * случайная выборка, один Лот), а владелец держит загруженное окно, читает
 * его по slug и решает, какие изменения объявить. Карта известных Лотов шире
 * окна: точечное дочитывание и «Мои приветы» кладут строки туда, но не в
 * порядок показа. Коалесцинг — у фасада; здесь только одна дорожка страницы.
 * Решение — docs/adr/0012, снапшот — docs/adr/0003.
 */

import {
  CATALOG_PAGE_SIZE,
  appendCatalogPage,
  catalogCursor,
  insertCatalogEntry,
  type CatalogCursor,
} from './catalog-page';
import {
  mergeLotState,
  outbidFrom,
  sameLot,
  type CatalogListRead,
  type CatalogMoreResult,
  type CatalogPageRead,
  type CatalogRead,
  type LiveChange,
  type LiveOutbid,
  type LotState,
  type LotStateRead,
} from './live-store-model';

/**
 * Срез каталога: что именно читает поверхность. Полного каталога нет — каждая
 * страница объявляет свой срез до первого чтения.
 */
type CatalogScope =
  | { kind: 'none' }
  | { kind: 'pages'; size: number }
  | { kind: 'random'; limit: number }
  | { kind: 'lot'; slug: string };

export interface CatalogOwnerDeps {
  readRandomLots(limit: number): Promise<CatalogListRead>;
  readCatalogPage(cursor: CatalogCursor | null, limit: number): Promise<CatalogPageRead>;
  readCatalogBySlugs(slugs: readonly string[]): Promise<CatalogRead>;
  readLot(slug: string): Promise<LotStateRead>;
  /** uid текущей сессии — правило перекупа: был мой, стал не мой. */
  uid(): string | null;
  /** Старт уже был: срез после него не меняется. */
  started(): boolean;
  emit(change: LiveChange): void;
}

export interface CatalogOwner {
  /** Карта известных Лотов: окно + точечно дочитанные строки. */
  map(): ReadonlyMap<string, LotState>;
  /** Окно в порядке показа: загруженные страницы витрины или случайная выборка. */
  window(): readonly LotState[];
  /** Есть ли ещё страница витрины (только в режиме страниц). */
  hasMore(): boolean;
  lot(slug: string): LotState | null;
  known(): boolean;
  ok(): boolean;
  usePages(pageSize?: number): void;
  useRandom(count: number): void;
  useLot(slug: string): void;
  loadPage(): Promise<CatalogMoreResult>;
  ensureLot(slug: string): Promise<LotState | null>;
  /** Запомнить новорождённые slug'и до ближайшего обновления окна. */
  noteInserted(slugs: readonly string[]): void;
  /** Один проход перечитывания среза (коалесцинг — у фасада). */
  readNow(): Promise<void>;
  /** Один Лот: модалка и денежные гейты. Здоровье каталога им не подменяем. */
  refreshLot(slug: string): Promise<LotState | null>;
  /** Свежие строки по slug'ам вне окна — кнопкам возврата колокола нужна N. */
  refreshLots(slugs: readonly string[]): Promise<void>;
  /** Положить строки в карту без окна и событий (для «Моих приветов»). */
  remember(states: readonly LotState[]): void;
}

export function createCatalogOwner(deps: CatalogOwnerDeps): CatalogOwner {
  let catalogValue = new Map<string, LotState>();
  let catalogFresh = false;
  let catalogKnown = false;

  /** Срез каталога выбирает поверхность до первого чтения; по умолчанию — никакой. */
  let catalogScope: CatalogScope = { kind: 'none' };
  /** Случайная выборка/лот прочитаны: пустое окно — удаление, не первый старт. */
  let catalogSelectionLoaded = false;
  /** Окно — slug загруженных страниц/выборки в порядке показа (значения — в catalogValue). */
  let catalogWindowSlugs: string[] = [];
  let catalogNextCursor: CatalogCursor | null = null;
  let catalogHasMore = false;
  /** Общая дорожка подгрузки страницы: веерный вызов не задваивает запрос. */
  let catalogPageInFlight: Promise<CatalogMoreResult> | null = null;
  /** Новые лоты из Realtime: решаем по границе окна, когда обновим его. */
  const catalogInsertSlugs = new Set<string>();

  function mergeState(
    target: Map<string, LotState>,
    raw: LotState,
    changed: Set<string>
  ): LotState {
    const merged = mergeLotState(target, raw);
    if (merged.changed) changed.add(raw.slug);
    return merged.state;
  }

  /** Слить прочитанное с прежним каталогом: стабильные ссылки + набор изменённых slug. */
  function mergeCatalog(next: ReadonlyMap<string, LotState>): {
    merged: Map<string, LotState>;
    changed: Set<string>;
  } {
    const merged = new Map<string, LotState>();
    const changed = new Set<string>();
    for (const [slug, st] of next) {
      const old = catalogValue.get(slug);
      if (old && sameLot(old, st)) {
        merged.set(slug, old);
      } else {
        merged.set(slug, st);
        changed.add(slug);
      }
    }
    for (const slug of catalogValue.keys()) {
      if (!merged.has(slug)) changed.add(slug);
    }
    return { merged, changed };
  }

  function windowStatesOf(states: ReadonlyMap<string, LotState>): LotState[] {
    const window: LotState[] = [];
    for (const slug of catalogWindowSlugs) {
      const st = states.get(slug);
      if (st) window.push(st);
    }
    return window;
  }

  /**
   * Перекупы из диффа снапшота: у лота, который был моим, сменился владелец на
   * не-меня. Смена сессии сюда не попадает (uid сравнивается внутри), удаление
   * лота — тоже (ему некому продавать).
   */
  function collectOutbids(
    prev: ReadonlyMap<string, LotState>,
    next: ReadonlyMap<string, LotState>,
    changed: ReadonlySet<string>
  ): LiveOutbid[] {
    const uidValue = deps.uid();
    if (uidValue === null) return [];
    const outbids: LiveOutbid[] = [];
    for (const slug of changed) {
      const old = prev.get(slug);
      const st = next.get(slug);
      if (!old || !st) continue;
      if (old.owner_uid !== uidValue) continue;
      if (st.owner_uid === uidValue || st.owner_uid === null) continue;
      if (!Number.isFinite(st.price)) continue;
      outbids.push(outbidFrom(st));
    }
    return outbids;
  }

  /** БД не ответила: последнее хорошее остаётся, свежесть — false. */
  function markUnavailable(): void {
    const notify = !catalogKnown || catalogFresh;
    catalogKnown = true;
    catalogFresh = false;
    if (notify) deps.emit({ kind: 'catalog', changed: new Set(), fresh: false });
  }

  /**
   * Применить срез каталога: `start` — первый (окно с нуля), иначе дописать
   * страницу. Дубли по slug не задваиваются; «есть ещё» считает читатель
   * (строка сверху).
   */
  function applySlice(states: readonly LotState[], start: boolean, hasMore: boolean): void {
    const wasKnown = catalogKnown;
    const freshChanged = !catalogFresh;
    const prev = catalogValue;
    const next = new Map(prev);
    const changed = new Set<string>();

    const pageStates = states.map((raw) => mergeState(next, raw, changed));
    const base = start ? [] : windowStatesOf(prev);
    catalogWindowSlugs = appendCatalogPage(base, pageStates).map((st) => st.slug);
    // Вставки, уже попавшие в страницу, больше не ждут границы окна.
    for (const slug of catalogWindowSlugs) catalogInsertSlugs.delete(slug);

    catalogValue = next;
    catalogKnown = true;
    catalogFresh = true;
    const nextCursor = catalogCursor(states);
    if (nextCursor !== null) catalogNextCursor = nextCursor;
    else if (start) catalogNextCursor = null;
    catalogHasMore = hasMore;

    const outbids = collectOutbids(prev, next, changed);
    if (changed.size > 0 || freshChanged || !wasKnown) {
      deps.emit({ kind: 'catalog', changed, fresh: true });
    }
    for (const event of outbids) deps.emit({ kind: 'outbid', event });
  }

  /** Одна страница витрины: общая дорожка для старта, скролла и ensureLot. */
  function loadPageNow(): Promise<CatalogMoreResult> {
    const scope = catalogScope;
    if (scope.kind !== 'pages') return Promise.resolve('end');
    if (catalogPageInFlight) return catalogPageInFlight;
    const start = catalogWindowSlugs.length === 0;
    if (!start && !catalogHasMore) return Promise.resolve('end');
    const run = (async (): Promise<CatalogMoreResult> => {
      let read: CatalogPageRead;
      try {
        read = await deps.readCatalogPage(start ? null : catalogNextCursor, scope.size);
      } catch {
        read = { ok: false, states: [], hasMore: false };
      }
      if (!read.ok) {
        markUnavailable();
        return 'error';
      }
      applySlice(read.states, start, read.hasMore);
      return read.states.length === 0 ? 'end' : 'ok';
    })();
    catalogPageInFlight = run;
    void run.finally(() => {
      if (catalogPageInFlight === run) catalogPageInFlight = null;
    });
    return run;
  }

  /**
   * Первый срез главной или страницы лота: случайная выборка N (порядок — как
   * отдала БД) или один лот по slug. Пустая выборка/нет строки — честный
   * «пусто», отказ БД — markUnavailable (страницы различают эти случаи).
   */
  async function loadSelectionNow(): Promise<void> {
    const scope = catalogScope;
    if (scope.kind === 'random') {
      let read: CatalogListRead;
      try {
        read = await deps.readRandomLots(scope.limit);
      } catch {
        read = { ok: false, states: [] };
      }
      if (!read.ok) {
        markUnavailable();
        return;
      }
      applySlice(read.states, true, false);
      catalogSelectionLoaded = true;
      return;
    }
    if (scope.kind !== 'lot') return;

    let read: CatalogRead;
    try {
      read = await deps.readCatalogBySlugs([scope.slug]);
    } catch {
      read = { ok: false, states: new Map() };
    }
    if (!read.ok) {
      markUnavailable();
      return;
    }
    const st = read.states.get(scope.slug);
    applySlice(st ? [st] : [], true, false);
    catalogSelectionLoaded = true;
  }

  /**
   * Освежить загруженное окно одним запросом по slug: цена/владелец, удалённые
   * уходят. В режиме страниц новый лот из Realtime вставляется, только если по
   * цене попадает в окно; выборка главной новых лотов не добирает.
   */
  async function refreshWindowNow(): Promise<void> {
    const windowSlugs = [...catalogWindowSlugs];
    const inserts = [...catalogInsertSlugs];
    const wanted = [...new Set([...windowSlugs, ...inserts])];
    if (wanted.length === 0) return;

    let read: CatalogRead;
    try {
      read = await deps.readCatalogBySlugs(wanted);
    } catch {
      read = { ok: false, states: new Map() };
    }
    if (!read.ok) {
      markUnavailable();
      return;
    }

    const prev = catalogValue;
    const next = new Map(prev);
    const changed = new Set<string>();
    const kept: string[] = [];
    for (const slug of windowSlugs) {
      const raw = read.states.get(slug);
      if (!raw) {
        // Строки нет — лот удалён: окно и карта его больше не держат.
        next.delete(slug);
        changed.add(slug);
        continue;
      }
      mergeState(next, raw, changed);
      kept.push(slug);
    }
    catalogWindowSlugs = kept;

    for (const slug of inserts) {
      const raw = read.states.get(slug);
      if (!raw) continue;
      if (catalogWindowSlugs.includes(slug)) {
        mergeState(next, raw, changed);
        continue;
      }
      const inserted = insertCatalogEntry(windowStatesOf(next), raw, catalogHasMore);
      if (inserted === null) continue; // дороже границы — придёт своей страницей
      next.set(raw.slug, raw);
      catalogWindowSlugs = inserted.map((entry) => entry.slug);
      changed.add(raw.slug);
    }
    for (const slug of inserts) catalogInsertSlugs.delete(slug);

    catalogValue = next;
    const freshChanged = !catalogFresh;
    catalogFresh = true;
    const outbids = collectOutbids(prev, next, changed);
    if (changed.size > 0 || freshChanged) {
      deps.emit({ kind: 'catalog', changed, fresh: true });
    }
    for (const event of outbids) deps.emit({ kind: 'outbid', event });
  }

  /** Дочитать страницы, пока лот не окажется в окне (возврат к покупке). */
  async function ensureLotNow(slug: string): Promise<LotState | null> {
    const find = (): LotState | null =>
      catalogWindowSlugs.includes(slug) ? (catalogValue.get(slug) ?? null) : null;
    if (find()) return find();
    if (catalogScope.kind !== 'pages') return refreshLotNow(slug);
    // Лота может уже не быть (старый ?buy=): одно чтение дешевле, чем
    // пролистать весь каталог впустую.
    if (!(await refreshLotNow(slug))) return null;
    if (catalogWindowSlugs.length === 0) {
      const first = await loadPageNow();
      if (find()) return find();
      if (first === 'error') return null;
    }
    let guard = 0;
    while (catalogHasMore && guard < 100) {
      guard += 1;
      const result = await loadPageNow();
      if (find()) return find();
      if (result === 'error') break;
    }
    return find();
  }

  async function readNow(): Promise<void> {
    const scope = catalogScope;
    if (scope.kind === 'none') return;

    if (scope.kind === 'pages') {
      // Пустое окно витрины — первая страница (или повтор после отказа БД).
      if (catalogWindowSlugs.length === 0) {
        await loadPageNow();
        return;
      }
      if (catalogPageInFlight) {
        await catalogPageInFlight;
        await refreshWindowNow();
        return;
      }
      await refreshWindowNow();
      return;
    }

    // Выборка/лот: пустое окно после первого чтения — это удалённые лоты, а не
    // повод перевыбрать (ADR 0012: выбор один раз за загрузку).
    if (!catalogSelectionLoaded) {
      await loadSelectionNow();
      return;
    }
    await refreshWindowNow();
  }

  /** Один лот: модалка и денежные гейты. Здоровье каталога им не подменяем. */
  async function refreshLotNow(slug: string): Promise<LotState | null> {
    let read: LotStateRead;
    try {
      read = await deps.readLot(slug);
    } catch {
      return null;
    }
    if (!read.ok) return null;
    const prev = catalogValue;
    const next = new Map(prev);
    if (read.state) next.set(slug, read.state);
    else {
      next.delete(slug);
      catalogWindowSlugs = catalogWindowSlugs.filter((s) => s !== slug);
    }
    // Одиночное чтение не выдаёт срез за свежий (флаг здоровья — у среза).
    const { merged, changed } = mergeCatalog(next);
    const outbids = collectOutbids(prev, merged, changed);
    catalogValue = merged;
    // Порядок окна не трогаем: значения берутся из карты.
    if (catalogKnown && changed.size > 0) {
      deps.emit({ kind: 'catalog', changed, fresh: catalogFresh });
    }
    // Перекуп — после каталога: кнопкам возврата уже видна свежая N.
    for (const event of outbids) deps.emit({ kind: 'outbid', event });
    return read.state;
  }

  /**
   * Цены истории колокола: оффлайн-догон приходит из `purchases`, где N нет,
   * а лота в окне витрины может не быть (ADR 0012) — строки ложатся в карту
   * снапшота, но не в окно. Перекупы не пересчитываем: их уже объявил дифф
   * среза или догон, второй звук и вторая запись тут не нужны.
   */
  async function refreshLotsNow(slugs: readonly string[]): Promise<void> {
    const wanted = [...new Set(slugs)].filter((slug) => slug.length > 0);
    if (wanted.length === 0) return;
    let read: CatalogRead;
    try {
      read = await deps.readCatalogBySlugs(wanted);
    } catch {
      return;
    }
    // Отказ не выдаём за «удалён»: без строк история остаётся как была.
    if (!read.ok || read.states.size === 0) return;

    const next = new Map(catalogValue);
    for (const raw of read.states.values()) next.set(raw.slug, raw);
    const { merged, changed } = mergeCatalog(next);
    if (changed.size === 0) return;
    catalogValue = merged;
    deps.emit({ kind: 'catalog', changed, fresh: catalogFresh });
  }

  /** Срез фиксируется до первого чтения: позже смена — no-op. */
  function setScope(scope: CatalogScope): void {
    if (deps.started() || catalogKnown) return;
    catalogScope = scope;
    catalogSelectionLoaded = false;
  }

  return {
    map: () => catalogValue,
    window: () => windowStatesOf(catalogValue),
    hasMore: () => catalogScope.kind === 'pages' && catalogHasMore,
    lot: (slug) => catalogValue.get(slug) ?? null,
    known: () => catalogKnown,
    ok: () => catalogFresh,

    usePages(pageSize = CATALOG_PAGE_SIZE) {
      setScope({ kind: 'pages', size: Math.max(1, Math.floor(pageSize)) });
    },

    useRandom(count) {
      setScope({ kind: 'random', limit: Math.max(1, Math.floor(count)) });
    },

    useLot(slug) {
      const clean = slug.trim();
      if (clean.length === 0) return;
      setScope({ kind: 'lot', slug: clean });
    },

    loadPage() {
      if (catalogScope.kind !== 'pages') return Promise.resolve('end');
      return loadPageNow();
    },

    ensureLot: ensureLotNow,
    noteInserted(slugs) {
      if (catalogScope.kind !== 'pages') return;
      for (const slug of slugs) {
        if (slug.length > 0) catalogInsertSlugs.add(slug);
      }
    },

    readNow,
    refreshLot: refreshLotNow,
    refreshLots: refreshLotsNow,

    remember(states) {
      if (states.length === 0) return;
      const next = new Map(catalogValue);
      const changed = new Set<string>();
      for (const st of states) mergeState(next, st, changed);
      catalogValue = next;
    },
  };
}
