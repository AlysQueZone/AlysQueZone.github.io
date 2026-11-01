/**
 * Снапшот живых данных: чистое ядро без DOM, сети и Supabase.
 *
 * Решение — docs/adr/0003: живой транспорт и читатели —
 * в src/lib/live.ts; здесь состояние и события:
 *
 * - синхронные чтения снапшота: uid, баланс, каталог, окно, «мои приветы»,
 *   один лот;
 * - каталог читается срезом страницы, а не целиком: витрина листается
 *   страницами (`useCatalogPages`), главная просит случайную выборку
 *   (`useRandomLots`), страница лота — один лот (`useLot`). Снапшот хранит
 *   загруженное окно (страницы или выборку), живой тик обновляет только его,
 *   а лот снаружи окна ждёт своей страницы (механика —
 *   src/lib/catalog-page.ts); «Мои приветы» — отдельный полный список
 *   владельца (`trackMyLots`), не фильтр окна: колоколу нужны все свои лоты,
 *   даже вне среза;
 * - одна подписка на изменения (uid / баланс / каталог / мои приветы / покупка /
 *   перекуп / сделки / синк) — поверхности читают снапшот и слушают;
 * - коалесцинг триггеров: одновременные перечитывания схлопываются в одно,
 *   триггер во время чтения не теряется — копится один догоняющий проход;
 * - неудача перечитывания не затирает последнее хорошее: данные остаются,
 *   свежесть — флаг `fresh` в событии (у каталога ещё и `catalogOk()`);
 * - церемония может придержать баланс (`deferBalance`/release): значения
 *   копятся, снапшот и события раскрываются в конце — последним значением;
 * - доменные события считаются из снапшота: «лот ушёл к другому» — дифф
 *   владельца каталога при неизменном uid, «покупка» — от buyLot.
 *
 * Читатели инъектируются: тесты — src/lib/live-store.test.ts с fake-readers.
 */

import {
  CATALOG_PAGE_SIZE,
  appendCatalogPage,
  catalogCursor,
  insertCatalogEntry,
  type CatalogCursor,
} from './catalog-page';
import type { LivePayload } from './live-core';

export interface LotState {
  slug: string;
  title: string;
  video_url: string | null;
  price: number;
  nextPrice: number | null;
  owner_login: string | null;
  owner_uid: string | null;
  /** Ник автора принятой заявки — только подробности лота, в списках не показываем. */
  suggested_by_login: string | null;
  mine: boolean;
}

/** Ответ чтения каталога: ok — «ответ от БД получен», пустой каталог ≠ ошибка. */
export interface CatalogRead {
  ok: boolean;
  states: Map<string, LotState>;
}

/** Ответ чтения страницы витрины: строки в порядке показа (цена, slug). */
export interface CatalogPageRead {
  ok: boolean;
  states: LotState[];
  /** За последней строкой есть ещё (читатель берёт на одну строку больше). */
  hasMore: boolean;
}

/** Ответ случайной выборки: строки в том порядке, в каком их отдала БД. */
export interface CatalogListRead {
  ok: boolean;
  states: LotState[];
}

/**
 * Срез каталога: что именно читает поверхность. Полного каталога нет — каждая
 * страница объявляет свой срез до первого чтения.
 */
type CatalogScope =
  | { kind: 'none' }
  | { kind: 'pages'; size: number }
  | { kind: 'random'; limit: number }
  | { kind: 'lot'; slug: string };

/** Итог подгрузки страницы витрины: ок — дописана, end — больше нет, error — БД/сеть. */
export type CatalogMoreResult = 'ok' | 'end' | 'error';

/** Ответ чтения одного Лота: нет строки ≠ БД недоступна. */
export interface LotStateRead {
  ok: boolean;
  state: LotState | null;
}

/** Читатели, которыми владеет live.ts (Supabase); ядро только зовёт их. */
export interface LiveReaders {
  /** uid текущей сессии; null — гость / хранилище не настроено. */
  readUid(): Promise<string | null>;
  /** Свой баланс; null — не прочитался / строки нет / гость. */
  readBalance(uid: string): Promise<number | null>;
  /** Случайная выборка для главной: строки в порядке, в каком их отдала БД. */
  readRandomLots(uid: string | null, limit: number): Promise<CatalogListRead>;
  /**
   * Одна страница витрины после курсора (null — первая), порядок — цена, slug.
   * `hasMore` считает читатель: строк запрашивается на одну больше.
   */
  readCatalogPage(
    uid: string | null,
    cursor: CatalogCursor | null,
    limit: number
  ): Promise<CatalogPageRead>;
  /** Строки каталога по slug — обновить загруженное окно; отсутствие = удалён. */
  readCatalogBySlugs(uid: string | null, slugs: readonly string[]): Promise<CatalogRead>;
  /** Полный список моих лотов (владелец — uid); не окно витрины. */
  readMyLots(uid: string): Promise<CatalogRead>;
  readLot(slug: string, uid: string | null): Promise<LotStateRead>;
}

/** Доменное событие «мой лот перекупили»: факт, разрешённый из снапшота. */
export interface LiveOutbid {
  slug: string;
  title: string;
  by: string;
  price: number;
  at: number;
  video: string | null;
}

/** Своя покупка: какой Лот и за сколько ушёл серверу. */
export interface LivePurchase {
  slug: string;
  price: number;
}

/** Изменение живых данных; поверхности читают снапшот, вид события — что обновлять. */
export type LiveChange =
  | { kind: 'uid'; uid: string | null }
  | { kind: 'balance'; balance: number | null; fresh: boolean }
  | { kind: 'catalog'; changed: ReadonlySet<string>; fresh: boolean }
  | { kind: 'myLots'; changed: ReadonlySet<string> }
  | { kind: 'purchase'; purchase: LivePurchase }
  | { kind: 'outbid'; event: LiveOutbid }
  | { kind: 'deals' }
  | { kind: 'sync' };

/**
 * Следующая цена N из значения строки/состояния: конечное > 0, иначе null.
 * Единственное место правила «N неизвестна» — показ честно рисует «…».
 */
export function normalizeNextPrice(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export interface LiveStore {
  // Снапшот — синхронные чтения (что есть на текущий момент).
  uid(): string | null;
  balance(): number | null;
  /** Был ли ответ по балансу для текущего uid (для честного прочерка без мигания). */
  balanceKnown(): boolean;
  catalog(): ReadonlyMap<string, LotState>;
  /** Окно в порядке показа: загруженные страницы витрины или случайная выборка. */
  catalogWindow(): readonly LotState[];
  /** Есть ли ещё страница витрины (только в режиме страниц). */
  catalogHasMore(): boolean;
  /** Включить страницы витрины; размер — до первого чтения, иначе no-op. */
  useCatalogPages(pageSize?: number): void;
  /** Главная: случайная выборка N лотов; режим — до первого чтения, иначе no-op. */
  useRandomLots(count: number): void;
  /** Страница лота: один лот по slug; режим — до первого чтения, иначе no-op. */
  useLot(slug: string): void;
  /** Догрузить следующую страницу витрины (общая дорожка на всех вызывающих). */
  loadCatalogPage(): Promise<CatalogMoreResult>;
  /** Дочитать страницы, пока лот не окажется в окне (возврат к покупке). */
  ensureCatalogLot(slug: string): Promise<LotState | null>;
  /** Полный список «Моих приветов» владельца — включается поверхностью. */
  trackMyLots(): void;
  myLots(): readonly LotState[];
  /** Был ли ответ по «Моим приветам» (для честного скелетона). */
  myLotsKnown(): boolean;
  /** Лот из окна/карты или «Моих приветов» — для колокола и модалки. */
  lot(slug: string): LotState | null;
  /** Был ли ответ по каталогу (пустой каталог — тоже ответ). */
  catalogKnown(): boolean;
  catalogOk(): boolean;
  // Подписка: сразу отдаёт то, что уже прочитано (uid / баланс / каталог).
  subscribe(cb: (change: LiveChange) => void): () => void;
  // Триггеры модуля (триггерами владеет live.ts); промис — вся дорожка
  // перечитывания, включая догоняющий проход (удобно тестам и ожиданиям).
  start(): Promise<void>;
  sync(): Promise<void>;
  refreshCatalog(): Promise<void>;
  /** Тик `lots` с payload: в режиме страниц запоминает slug новорождённого лота. */
  reportLotsTick(payload: LivePayload): Promise<void>;
  applyUid(uid: string | null): void;
  // Явная свежесть для денежных гейтов (гамба, покупка).
  refreshBalance(): Promise<number | null>;
  refreshLot(slug: string): Promise<LotState | null>;
  /** Свежие строки по slug'ам вне окна — кнопкам возврата колокола нужна N. */
  refreshLots(slugs: readonly string[]): Promise<void>;
  /**
   * Придержать баланс под церемонию (гамба): значения копятся, снапшот
   * и события — до release. Возвращает идемпотентный release: раскрыть
   * последнее удержанное значение (или ничего, если так и не пришло).
   */
  deferBalance(): () => void;
  // Значения и события от производителей (гамба/дейли, buyLot).
  reportBalance(value: number): void;
  /** Своя покупка: событие сразу, перечитка — следом (промис — вся дорожка). */
  reportPurchase(purchase: LivePurchase): Promise<void>;
  /** Сделка случилась (тик purchases) — сигнал своим проекциям (маркиза). */
  reportDeal(payload?: LivePayload): Promise<void>;
}

export function createLiveStore(readers: LiveReaders): LiveStore {
  const listeners: ((change: LiveChange) => void)[] = [];

  let uidValue: string | null = null;
  /** uid прочитан хотя бы раз (значение могло быть null — гость): подписка
   *  сразу отдаёт состояние, пришедшее до неё (авторизация между скриптами). */
  let uidKnown = false;
  let balanceValue: number | null = null;
  /** Ответ по балансу уже был (для честного прочерка без мигания). */
  let balanceTried = false;
  /** Последнее чтение баланса удалось; false — на экране последнее хорошее. */
  let balanceFresh = false;
  /** Церемония придержала баланс: копим последнее раскрываемое значение. */
  let balanceHeld = false;
  let heldBalance: number | null = null;
  let catalogValue = new Map<string, LotState>();
  let catalogFresh = false;
  let catalogKnown = false;
  let started = false;

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

  /** «Мои приветы» полным списком владельца — включается поверхностью. */
  let myLotsTracked = false;
  let myLotsValue = new Map<string, LotState>();
  let myLotsTried = false;
  /** Чей список сейчас в снапшоте: смена uid не подхватывает чужой ответ. */
  let myLotsUid: string | null = null;
  let myLotsInFlight: Promise<void> | null = null;
  let myLotsInFlightUid: string | null = null;

  /** Одна дорожка перечитывания: 'all' (uid+баланс+каталог) или 'catalog' (тик). */
  let inFlight: Promise<void> | null = null;
  let pending: 'all' | 'catalog' | null = null;
  /** Догоняющий проход просит свежий «Мои приветы» (sync/покупка). */
  let pendingMine = false;
  /** Дедуп чтения баланса: явная свежесть и тики — одна дорожка на запрос.
   *  Дорожка привязана к uid: после смены сессии чужой ответ не подхватываем. */
  let balanceInFlight: Promise<number | null> | null = null;
  let balanceInFlightUid: string | null = null;

  function emit(change: LiveChange): void {
    for (const listener of [...listeners]) {
      try {
        listener(change);
      } catch {
        // один сломанный подписчик других не глушит
      }
    }
  }

  // -------------------------------------------------------------------------
  // Снапшот: слияние и сравнение
  // -------------------------------------------------------------------------

  function sameLot(a: LotState, b: LotState): boolean {
    return (
      a.slug === b.slug &&
      a.title === b.title &&
      a.video_url === b.video_url &&
      a.price === b.price &&
      a.nextPrice === b.nextPrice &&
      a.owner_login === b.owner_login &&
      a.owner_uid === b.owner_uid &&
      a.suggested_by_login === b.suggested_by_login &&
      a.mine === b.mine
    );
  }

  /** Пересобрать «мой» флаг под uid без сети; неизменившиеся объекты переиспользуем. */
  function withMine(
    states: ReadonlyMap<string, LotState>,
    uid: string | null
  ): Map<string, LotState> {
    const next = new Map<string, LotState>();
    for (const [slug, st] of states) {
      const mine = uid !== null && st.owner_uid === uid;
      next.set(slug, mine === st.mine ? st : { ...st, mine });
    }
    return next;
  }

  /** Слить прочитанное с прежним каталогом: стабильные ссылки + набор изменённых slug. */
  function mergeCatalog(next: ReadonlyMap<string, LotState>): {
    merged: Map<string, LotState>;
    changed: Set<string>;
  } {
    const merged = new Map<string, LotState>();
    for (const [slug, st] of next) {
      const old = catalogValue.get(slug);
      merged.set(slug, old && sameLot(old, st) ? old : st);
    }
    return { merged, changed: changedByRef(catalogValue, merged) };
  }

  /** Набор slug, чей объект состояния сменился (или появился/исчез). */
  function changedByRef(
    prev: ReadonlyMap<string, LotState>,
    next: ReadonlyMap<string, LotState>
  ): Set<string> {
    const changed = new Set<string>();
    for (const [slug, st] of next) {
      if (prev.get(slug) !== st) changed.add(slug);
    }
    for (const slug of prev.keys()) {
      if (!next.has(slug)) changed.add(slug);
    }
    return changed;
  }

  /** Нормализовать «мой» флаг под текущую сессию (ответ мог прийти после смены uid). */
  function normalizeMine(st: LotState): LotState {
    const mine = uidValue !== null && st.owner_uid === uidValue;
    return mine === st.mine ? st : { ...st, mine };
  }

  /** Влить строку с переиспользованием неизменившейся ссылки; вернуть объект снапшота. */
  function mergeState(
    target: Map<string, LotState>,
    raw: LotState,
    changed: Set<string>
  ): LotState {
    const st = normalizeMine(raw);
    const old = target.get(st.slug);
    const stable = old && sameLot(old, st) ? old : st;
    target.set(st.slug, stable);
    if (old !== stable) changed.add(st.slug);
    return stable;
  }

  function windowStatesOf(states: ReadonlyMap<string, LotState>): LotState[] {
    const window: LotState[] = [];
    for (const slug of catalogWindowSlugs) {
      const st = states.get(slug);
      if (st) window.push(st);
    }
    return window;
  }

  /** Событие перекупа из свежей строки: один строитель на все диффы. */
  function outbidFrom(st: LotState): LiveOutbid {
    return {
      slug: st.slug,
      title: st.title,
      by: st.owner_login ?? 'Чатерс',
      price: st.price,
      at: Date.now(),
      video: st.video_url,
    };
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

  /**
   * Влить одиночное чтение (refreshLot): «мой» флаг — под текущий uid (ответ
   * мог прийти уже после смены сессии), дифф владельца даёт событие перекупа
   * (только при неизменном uid — смена сессии не сделка). Здоровье каталога
   * одиночным чтением не подменяем — его держит чтение среза.
   */
  function applyLotRead(next: ReadonlyMap<string, LotState>): void {
    const prev = catalogValue;
    const { merged, changed } = mergeCatalog(withMine(next, uidValue));
    const outbids = collectOutbids(prev, merged, changed);

    catalogValue = merged;
    // Порядок окна не трогаем: значения берутся из карты.
    if (catalogKnown && changed.size > 0) {
      emit({ kind: 'catalog', changed, fresh: catalogFresh });
    }
    // Перекуп — после каталога: кнопкам возврата уже видна свежая N.
    for (const event of outbids) emit({ kind: 'outbid', event });
  }

  /** БД не ответила: последнее хорошее остаётся, свежесть — false. */
  function markCatalogUnavailable(): void {
    const notify = !catalogKnown || catalogFresh;
    catalogKnown = true;
    catalogFresh = false;
    if (notify) emit({ kind: 'catalog', changed: new Set(), fresh: false });
  }

  /** Баланс пришёл (или не пришёл): null не затирает последнее хорошее. */
  function applyBalance(value: number | null): void {
    // Церемония придержала баланс (гамба): копим последнее раскрываемое
    // значение, снапшот и события — до release (см. deferBalance).
    if (balanceHeld) {
      if (value !== null) heldBalance = value;
      return;
    }
    const first = !balanceTried;
    balanceTried = true;
    balanceFresh = value !== null;
    if (value === null) {
      // Первый ответ «пусто/отказ» — честный прочерк; дальше последнее
      // хорошее просто остаётся на экране.
      if (first) emit({ kind: 'balance', balance: null, fresh: false });
      return;
    }
    const changed = value !== balanceValue;
    balanceValue = value;
    if (first || changed) emit({ kind: 'balance', balance: value, fresh: true });
  }

  /**
   * Конец церемонии: раскрыть последнее удержанное значение обычным путём.
   * Идемпотентно — повторный release (закрытие окна после конца крутки) no-op.
   */
  function releaseBalance(): void {
    if (!balanceHeld) return;
    balanceHeld = false;
    const value = heldBalance;
    heldBalance = null;
    if (value !== null) applyBalance(value);
  }

  /** Смена uid: пересобрать «мой» флаг, сбросить чужой баланс, объявить. */
  function setUid(next: string | null): void {
    if (next === uidValue) return;
    uidValue = next;
    const recalculated = withMine(catalogValue, next);
    const changed = changedByRef(catalogValue, recalculated);
    catalogValue = recalculated;
    emit({ kind: 'uid', uid: next });
    if (changed.size > 0) emit({ kind: 'catalog', changed, fresh: catalogFresh });
    if (balanceValue !== null) {
      balanceValue = null;
      emit({ kind: 'balance', balance: null, fresh: false });
    }
    balanceTried = false;
    balanceFresh = false;
    // Значение прежнего uid не раскроется под церемонией нового.
    heldBalance = null;
    // «Мои приветы» прежнего uid чужому не показываем; список перечитается.
    if (myLotsTracked) {
      if (myLotsValue.size > 0) emit({ kind: 'myLots', changed: new Set(myLotsValue.keys()) });
      myLotsValue = new Map();
      myLotsTried = false;
      myLotsUid = null;
    }
  }

  // -------------------------------------------------------------------------
  // Чтения
  // -------------------------------------------------------------------------

  async function readUidSafe(): Promise<string | null> {
    try {
      return await readers.readUid();
    } catch {
      return uidValue;
    }
  }

  /** Чтение баланса с дедупом: явная свежесть и тики делят один запрос. */
  function readBalanceNow(uid: string): Promise<number | null> {
    if (balanceInFlight && balanceInFlightUid === uid) return balanceInFlight;
    const run = (async (): Promise<number | null> => {
      let value: number | null;
      try {
        value = await readers.readBalance(uid);
      } catch {
        value = null;
      }
      if (uid !== uidValue) return null; // uid сменился — значение чужое
      applyBalance(value);
      return value;
    })();
    balanceInFlight = run;
    balanceInFlightUid = uid;
    void run.finally(() => {
      if (balanceInFlight === run) {
        balanceInFlight = null;
        balanceInFlightUid = null;
      }
    });
    return run;
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
      emit({ kind: 'catalog', changed, fresh: true });
    }
    for (const event of outbids) emit({ kind: 'outbid', event });
  }

  /** Одна страница витрины: общая дорожка для старта, скролла и ensureLot. */
  function loadCatalogPageNow(): Promise<CatalogMoreResult> {
    const scope = catalogScope;
    if (scope.kind !== 'pages') return Promise.resolve('end');
    if (catalogPageInFlight) return catalogPageInFlight;
    const start = catalogWindowSlugs.length === 0;
    if (!start && !catalogHasMore) return Promise.resolve('end');
    const run = (async (): Promise<CatalogMoreResult> => {
      let read: CatalogPageRead;
      try {
        read = await readers.readCatalogPage(
          uidValue,
          start ? null : catalogNextCursor,
          scope.size
        );
      } catch {
        read = { ok: false, states: [], hasMore: false };
      }
      if (!read.ok) {
        markCatalogUnavailable();
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
   * «пусто», отказ БД — markCatalogUnavailable (страницы различают эти случаи).
   */
  async function loadSelectionNow(): Promise<void> {
    const scope = catalogScope;
    if (scope.kind === 'random') {
      let read: CatalogListRead;
      try {
        read = await readers.readRandomLots(uidValue, scope.limit);
      } catch {
        read = { ok: false, states: [] };
      }
      if (!read.ok) {
        markCatalogUnavailable();
        return;
      }
      applySlice(read.states, true, false);
      catalogSelectionLoaded = true;
      return;
    }
    if (scope.kind !== 'lot') return;

    let read: CatalogRead;
    try {
      read = await readers.readCatalogBySlugs(uidValue, [scope.slug]);
    } catch {
      read = { ok: false, states: new Map() };
    }
    if (!read.ok) {
      markCatalogUnavailable();
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
      read = await readers.readCatalogBySlugs(uidValue, wanted);
    } catch {
      read = { ok: false, states: new Map() };
    }
    if (!read.ok) {
      markCatalogUnavailable();
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
      const st = normalizeMine(raw);
      const inserted = insertCatalogEntry(windowStatesOf(next), st, catalogHasMore);
      if (inserted === null) continue; // дороже границы — придёт своей страницей
      next.set(st.slug, st);
      catalogWindowSlugs = inserted.map((entry) => entry.slug);
      changed.add(st.slug);
    }
    for (const slug of inserts) catalogInsertSlugs.delete(slug);

    catalogValue = next;
    const freshChanged = !catalogFresh;
    catalogFresh = true;
    const outbids = collectOutbids(prev, next, changed);
    if (changed.size > 0 || freshChanged) emit({ kind: 'catalog', changed, fresh: true });
    for (const event of outbids) emit({ kind: 'outbid', event });
  }

  /**
   * «Мои приветы» полным списком: окно витрины может не содержать часть моих
   * лотов, поэтому это отдельный запрос владельца. Ушедшие лоты дочитываются
   * по одному — событию перекупа нужен новый владелец и цена.
   */
  function readMyLotsNow(uid: string, force = false): Promise<void> {
    if (!myLotsTracked) return Promise.resolve();
    if (!force && myLotsUid === uid) return myLotsInFlight ?? Promise.resolve();
    if (myLotsInFlight && myLotsInFlightUid === uid) return myLotsInFlight;

    const run = (async (): Promise<void> => {
      let read: CatalogRead;
      try {
        read = await readers.readMyLots(uid);
      } catch {
        read = { ok: false, states: new Map() };
      }
      if (uid !== uidValue || !myLotsTracked) return;
      // Отказ не выдаём за «пусто»: скелетон честнее; синк/фокус повторят.
      if (!read.ok) return;

      const prev = myLotsValue;
      const next = new Map<string, LotState>();
      const changed = new Set<string>();
      for (const raw of read.states.values()) mergeState(next, raw, changed);

      const gone = [...prev.keys()].filter((slug) => !next.has(slug));
      const sold: LotState[] = [];
      for (const slug of gone) {
        changed.add(slug);
        try {
          const one = await readers.readLot(slug, uid);
          if (one.ok && one.state && one.state.owner_uid !== uid) sold.push(one.state);
        } catch {
          // best effort: колокол догонит сделку на фокусе/синке
        }
      }
      if (uid !== uidValue || !myLotsTracked) return;

      myLotsValue = next;
      myLotsTried = true;
      myLotsUid = uid;
      emit({ kind: 'myLots', changed });

      if (sold.length > 0) {
        // Свежие строки — в карту, но не в окно: кнопке возврата нужна их N.
        const merged = new Map(catalogValue);
        const touched = new Set<string>();
        for (const st of sold) mergeState(merged, st, touched);
        catalogValue = merged;
        for (const st of sold) {
          emit({ kind: 'outbid', event: outbidFrom(st) });
        }
      }
    })();
    myLotsInFlight = run;
    myLotsInFlightUid = uid;
    void run.finally(() => {
      if (myLotsInFlight === run) {
        myLotsInFlight = null;
        myLotsInFlightUid = null;
      }
    });
    return run;
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
      const first = await loadCatalogPageNow();
      if (find()) return find();
      if (first === 'error') return null;
    }
    let guard = 0;
    while (catalogHasMore && guard < 100) {
      guard += 1;
      const result = await loadCatalogPageNow();
      if (find()) return find();
      if (result === 'error') break;
    }
    return find();
  }

  async function readCatalogNow(): Promise<void> {
    const scope = catalogScope;
    if (scope.kind === 'none') return;

    if (scope.kind === 'pages') {
      // Пустое окно витрины — первая страница (или повтор после отказа БД).
      if (catalogWindowSlugs.length === 0) {
        await loadCatalogPageNow();
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
      read = await readers.readLot(slug, uidValue);
    } catch {
      return null;
    }
    if (!read.ok) return null;
    const next = new Map(catalogValue);
    if (read.state) next.set(slug, read.state);
    else {
      next.delete(slug);
      catalogWindowSlugs = catalogWindowSlugs.filter((s) => s !== slug);
    }
    // Одиночное чтение не выдаёт срез за свежий (флаг здоровья — у среза).
    applyLotRead(next);
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
      read = await readers.readCatalogBySlugs(uidValue, wanted);
    } catch {
      return;
    }
    // Отказ не выдаём за «удалён»: без строк история остаётся как была.
    if (!read.ok || read.states.size === 0) return;

    const next = new Map(catalogValue);
    for (const raw of read.states.values()) next.set(raw.slug, raw);
    const { merged, changed } = mergeCatalog(withMine(next, uidValue));
    if (changed.size === 0) return;
    catalogValue = merged;
    emit({ kind: 'catalog', changed, fresh: catalogFresh });
  }

  async function readAllNow(refreshMine: boolean): Promise<void> {
    const u = await readUidSafe();
    applyUid(u);
    // Баланс раньше каталога: поверхности рисуют каталог уже с балансом
    // (без мигания «не хватает»).
    if (u !== null) await readBalanceNow(u);
    await readCatalogNow();
    if (myLotsTracked && u !== null) await readMyLotsNow(u, refreshMine);
  }

  /**
   * Единственная дорожка перечитывания. Триггер во время чтения не теряется:
   * копится один догоняющий проход сильнейшего охвата ('all' > 'catalog').
   */
  function schedule(scope: 'all' | 'catalog', refreshMine = false): Promise<void> {
    if (inFlight) {
      pending = pending === 'all' || scope === 'all' ? 'all' : 'catalog';
      pendingMine = pendingMine || refreshMine;
      return inFlight;
    }
    const run = (async () => {
      let current: 'all' | 'catalog' | null = scope;
      let mine = refreshMine;
      while (current !== null) {
        pending = null;
        pendingMine = false;
        await (current === 'all' ? readAllNow(mine) : readCatalogNow());
        current = pending;
        mine = pendingMine;
      }
    })();
    inFlight = run;
    void run.finally(() => {
      if (inFlight === run) inFlight = null;
    });
    return run;
  }

  // -------------------------------------------------------------------------
  // Публичный интерфейс
  // -------------------------------------------------------------------------

  function applyUid(next: string | null): void {
    uidKnown = true;
    const before = uidValue;
    setUid(next);
    if (next !== before && next !== null) {
      void readBalanceNow(next);
      if (myLotsTracked) void readMyLotsNow(next);
    }
  }

  /** Окно в порядке показа: загруженные страницы витрины или случайная выборка. */
  function catalogWindow(): readonly LotState[] {
    return windowStatesOf(catalogValue);
  }

  /** Срез фиксируется до первого чтения: позже смена — no-op. */
  function setScope(scope: CatalogScope): void {
    if (started || catalogKnown) return;
    catalogScope = scope;
    catalogSelectionLoaded = false;
  }

  return {
    uid: () => uidValue,
    balance: () => balanceValue,
    balanceKnown: () => balanceTried,
    catalog: () => catalogValue,
    catalogWindow,
    catalogHasMore: () => catalogScope.kind === 'pages' && catalogHasMore,
    lot: (slug) => catalogValue.get(slug) ?? myLotsValue.get(slug) ?? null,
    catalogKnown: () => catalogKnown,
    catalogOk: () => catalogFresh,

    useCatalogPages(pageSize = CATALOG_PAGE_SIZE) {
      setScope({ kind: 'pages', size: Math.max(1, Math.floor(pageSize)) });
    },

    useRandomLots(count) {
      setScope({ kind: 'random', limit: Math.max(1, Math.floor(count)) });
    },

    useLot(slug) {
      const clean = slug.trim();
      if (clean.length === 0) return;
      setScope({ kind: 'lot', slug: clean });
    },

    loadCatalogPage() {
      if (catalogScope.kind !== 'pages') return Promise.resolve('end');
      return loadCatalogPageNow();
    },

    ensureCatalogLot(slug) {
      return ensureLotNow(slug);
    },

    trackMyLots() {
      if (myLotsTracked) return;
      myLotsTracked = true;
      if (uidKnown && uidValue !== null) void readMyLotsNow(uidValue);
    },

    myLots: () => [...myLotsValue.values()],
    myLotsKnown: () => myLotsTried,

    subscribe(cb) {
      listeners.push(cb);
      // Новый подписчик не ждёт следующего события: уже прочитанное состояние —
      // сразу (uid/баланс/каталог могли прийти до подписки).
      const prime = (change: LiveChange): void => {
        try {
          cb(change);
        } catch {
          // подписчик сломался на текущем состоянии — дальше по общим правилам
        }
      };
      if (uidKnown) prime({ kind: 'uid', uid: uidValue });
      if (balanceTried) {
        prime({ kind: 'balance', balance: balanceValue, fresh: balanceFresh });
      }
      if (catalogKnown) {
        prime({ kind: 'catalog', changed: new Set(catalogValue.keys()), fresh: catalogFresh });
      }
      if (myLotsTried) {
        prime({ kind: 'myLots', changed: new Set(myLotsValue.keys()) });
      }
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        const at = listeners.indexOf(cb);
        if (at >= 0) listeners.splice(at, 1);
      };
    },

    start() {
      if (started) return inFlight ?? Promise.resolve();
      started = true;
      return schedule('all');
    },

    sync() {
      emit({ kind: 'sync' });
      return schedule('all', true);
    },

    refreshCatalog() {
      return schedule('catalog');
    },

    reportLotsTick(payload) {
      // Вставка в окно витрины: запоминаем slug, границу окна решим при
      // обновлении. Выборка главной новых лотов не добирает (ADR 0012).
      if (catalogScope.kind === 'pages' && payload.eventType === 'INSERT') {
        const slug = (payload.new ?? {})['slug'];
        if (typeof slug === 'string' && slug.length > 0) catalogInsertSlugs.add(slug);
      }
      return schedule('catalog');
    },

    applyUid,

    async refreshBalance() {
      const u = await readUidSafe();
      applyUid(u);
      if (u === null) return null;
      return readBalanceNow(u);
    },

    refreshLot: refreshLotNow,

    refreshLots: refreshLotsNow,

    deferBalance() {
      // Повторный defer подряд (не должен случаться) не теряет уже накопленное.
      if (!balanceHeld) {
        balanceHeld = true;
        heldBalance = null;
      }
      return releaseBalance;
    },

    reportBalance(value) {
      if (!Number.isFinite(value) || value < 0) return;
      applyBalance(value);
    },

    reportPurchase(purchase) {
      emit({ kind: 'purchase', purchase });
      return schedule('all', true);
    },

    reportDeal(payload) {
      emit({ kind: 'deals' });
      if (!myLotsTracked || uidValue === null) return Promise.resolve();
      // Чужая сделка не трогает мои лоты: payload несёт продавца, лишний
      // запрос на каждую покупку в чате не нужен. Без payload — перечитываем.
      const seller = (payload?.new ?? {})['seller_uid'];
      if (typeof seller === 'string' && seller !== uidValue) return Promise.resolve();
      return readMyLotsNow(uidValue, true);
    },
  };
}
