/**
 * Живые данные: фасад снапшота и коалесцинг перечитываний.
 *
 * Решение — docs/adr/0003: транспорт и читатели — в src/lib/live.ts; здесь
 * состояние и события. За фасадом три внутренних владельца с узкими
 * интерфейсами: сессия/«Мои приветы», баланс/Церемония, срез каталога.
 * Фасад сохраняет прежний `LiveStore` и порядок событий, владеет одной
 * дорожкой перечитывания (триггер во время чтения не теряется — копится один
 * догоняющий проход) и порядком сброса при смене uid: uid → баланс → список.
 *
 * Снапшот — синхронные чтения; неудача перечитывания не затирает последнее
 * хорошее (свежесть — флаг `fresh` в событии, у каталога ещё `catalogOk()`);
 * церемония придерживает баланс (`deferBalance`/release); доменные события
 * считаются из диффа снапшота, форма Realtime сюда не проникает —
 * `reportLotsTick` и `reportDeal` несут только доменные факты.
 *
 * Читатели инъектируются; тесты владельцев — src/lib/live-store.*.test.ts.
 */

import { createBalanceOwner } from './live-store-balance';
import { createCatalogOwner, type CatalogOwner } from './live-store-catalog';
import { createSessionOwner } from './live-store-session';
import type {
  CatalogMoreResult,
  DealEvent,
  LiveChange,
  LivePurchase,
  LiveReaders,
  LotsTick,
  LotState,
} from './live-store-model';

export type {
  CatalogListRead,
  CatalogMoreResult,
  CatalogPageRead,
  CatalogRead,
  DealEvent,
  LiveChange,
  LiveOutbid,
  LivePurchase,
  LiveReaders,
  LotsTick,
  LotState,
  LotStateRead,
  SessionState,
} from './live-store-model';

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
  /**
   * Когда uid прочитан впервые (гостем — null): ждать без поллинга и таймаута.
   * Все ожидающие получают одно значение; прочитанный uid — резолв сразу.
   */
  whenUidKnown(): Promise<string | null>;
  balance(): number | null;
  /** Был ли ответ по балансу для текущего uid (для честного прочерка без мигания). */
  balanceKnown(): boolean;
  /** Карта известных Лотов: окно + точечно дочитанные строки. */
  catalogMap(): ReadonlyMap<string, LotState>;
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
  /** Тик `lots` с доменным фактом: в режиме страниц запоминает новорождённые лоты. */
  reportLotsTick(tick: LotsTick): Promise<void>;
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
  reportDeal(deal?: DealEvent): Promise<void>;
}

export function createLiveStore(readers: LiveReaders): LiveStore {
  const listeners: ((change: LiveChange) => void)[] = [];
  let started = false;

  /** Одна дорожка перечитывания: 'all' (uid+баланс+каталог) или 'catalog' (тик). */
  let inFlight: Promise<void> | null = null;
  let pending: 'all' | 'catalog' | null = null;
  /** Догоняющий проход просит свежий «Мои приветы» (sync/покупка). */
  let pendingMine = false;

  function emit(change: LiveChange): void {
    for (const listener of [...listeners]) {
      try {
        listener(change);
      } catch {
        // один сломанный подписчик других не глушит
      }
    }
  }

  const catalogRef: { current: CatalogOwner | null } = { current: null };

  const session = createSessionOwner({
    readUid: readers.readUid,
    readMyLots: readers.readMyLots,
    readLot: readers.readLot,
    emit,
    rememberCatalog: (states) => catalogRef.current?.remember(states),
  });
  const catalog = createCatalogOwner({
    readRandomLots: readers.readRandomLots,
    readCatalogPage: readers.readCatalogPage,
    readCatalogBySlugs: readers.readCatalogBySlugs,
    readLot: readers.readLot,
    uid: session.uid,
    started: () => started,
    emit,
  });
  catalogRef.current = catalog;
  const balance = createBalanceOwner({ readBalance: readers.readBalance, emit });

  async function readAllNow(refreshMine: boolean): Promise<void> {
    const u = await session.readUidSafe();
    applyUid(u);
    // Баланс раньше каталога: поверхности рисуют каталог уже с балансом
    // (без мигания «не хватает»).
    if (u !== null) await balance.refresh(u);
    await catalog.readNow();
    if (session.myLotsTracked() && u !== null) await session.readMyLots(u, refreshMine);
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
        await (current === 'all' ? readAllNow(mine) : catalog.readNow());
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

  function applyUid(next: string | null): void {
    const changed = session.applyUid(next);
    if (!changed) return;
    // Порядок прежний: uid → сброс чужого баланса → сброс «Моих приветов».
    balance.applyUid(next);
    session.resetMyLots();
    if (next !== null) {
      void balance.refresh(next);
      if (session.myLotsTracked()) void session.readMyLots(next);
    }
  }

  return {
    uid: session.uid,
    whenUidKnown: session.whenUidKnown,
    balance: balance.value,
    balanceKnown: balance.known,
    catalogMap: catalog.map,
    catalogWindow: catalog.window,
    catalogHasMore: catalog.hasMore,
    lot: (slug) => catalog.lot(slug) ?? session.lot(slug),
    catalogKnown: catalog.known,
    catalogOk: catalog.ok,

    useCatalogPages: catalog.usePages,
    useRandomLots: catalog.useRandom,
    useLot: catalog.useLot,
    loadCatalogPage: catalog.loadPage,
    ensureCatalogLot: catalog.ensureLot,
    trackMyLots: session.trackMyLots,
    myLots: session.myLots,
    myLotsKnown: session.myLotsKnown,

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
      if (session.uidKnown()) prime({ kind: 'uid', uid: session.uid() });
      if (balance.known()) {
        prime({ kind: 'balance', balance: balance.value(), fresh: balance.fresh() });
      }
      if (catalog.known()) {
        prime({
          kind: 'catalog',
          changed: new Set(catalog.map().keys()),
          fresh: catalog.ok(),
        });
      }
      if (session.myLotsKnown()) {
        prime({
          kind: 'myLots',
          changed: new Set(session.myLots().map((st) => st.slug)),
        });
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

    reportLotsTick(tick) {
      catalog.noteInserted(tick.insertedSlugs);
      return schedule('catalog');
    },

    applyUid,

    async refreshBalance() {
      const u = await session.readUidSafe();
      applyUid(u);
      if (u === null) return null;
      return balance.refresh(u);
    },

    refreshLot: catalog.refreshLot,
    refreshLots: catalog.refreshLots,

    deferBalance: balance.defer,
    reportBalance: balance.report,

    reportPurchase(purchase) {
      emit({ kind: 'purchase', purchase });
      return schedule('all', true);
    },

    reportDeal(deal) {
      emit({ kind: 'deals' });
      const uid = session.uid();
      if (!session.myLotsTracked() || uid === null) return Promise.resolve();
      // Чужая сделка не трогает мои лоты: событие несёт продавца, лишний
      // запрос на каждую покупку в чате не нужен. Без продавца — перечитываем.
      if (typeof deal?.sellerUid === 'string' && deal.sellerUid !== uid) {
        return Promise.resolve();
      }
      return session.readMyLots(uid, true);
    },
  };
}
