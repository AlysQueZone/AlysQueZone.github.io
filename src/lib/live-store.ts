/**
 * Снапшот живых данных: чистое ядро без DOM, сети и Supabase.
 *
 * Этапы 2–3 кандидата B (решение — docs/adr/0003): живой транспорт и читатели —
 * в src/lib/live.ts; здесь состояние и события:
 *
 * - синхронные чтения снапшота: uid, баланс, каталог, один лот;
 * - одна подписка на изменения (uid / баланс / каталог / покупка / перекуп /
 *   сделки / синк) — поверхности читают снапшот и слушают;
 * - коалесцинг триггеров: одновременные перечитывания схлопываются в одно,
 *   триггер во время чтения не теряется — копится один догоняющий проход;
 * - неудача перечитывания не затирает последнее хорошее: данные остаются,
 *   свежесть — флаг `fresh` в событии (у каталога ещё и `catalogOk()`);
 * - доменные события считаются из снапшота: «лот ушёл к другому» — дифф
 *   владельца каталога при неизменном uid, «покупка» — от buyLot.
 *
 * Читатели инъектируются: тесты — src/lib/live-store.test.ts с fake-readers.
 */

/** Живое состояние Лота (было в lots.ts; чтения переехали в live.ts). */
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
  readCatalog(uid: string | null): Promise<CatalogRead>;
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
  applyUid(uid: string | null): void;
  // Явная свежесть для денежных гейтов (гамба, покупка).
  refreshBalance(): Promise<number | null>;
  refreshLot(slug: string): Promise<LotState | null>;
  // Значения и события от производителей (гамба/дейли, buyLot).
  reportBalance(value: number): void;
  /** Своя покупка: событие сразу, перечитка — следом (промис — вся дорожка). */
  reportPurchase(purchase: LivePurchase): Promise<void>;
  /** Сделка случилась (тик purchases) — сигнал своим проекциям (маркиза). */
  reportDeal(): void;
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
  let catalogValue = new Map<string, LotState>();
  let catalogFresh = false;
  let catalogKnown = false;
  let started = false;

  /** Одна дорожка перечитывания: 'all' (uid+баланс+каталог) или 'catalog' (тик). */
  let inFlight: Promise<void> | null = null;
  let pending: 'all' | 'catalog' | null = null;
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

  /**
   * Применить прочитанный каталог: «мой» флаг — под текущий uid (ответ мог
   * прийти уже после смены сессии), дифф владельца даёт событие перекупа
   * (только при неизменном uid — смена сессии не сделка), свежесть — флаг.
   */
  function applyCatalog(next: ReadonlyMap<string, LotState>, ok: boolean): void {
    const prev = catalogValue;
    const { merged, changed } = mergeCatalog(withMine(next, uidValue));

    const outbids: LiveOutbid[] = [];
    if (uidValue !== null) {
      for (const [slug, st] of merged) {
        const old = prev.get(slug);
        if (!old || old.owner_uid !== uidValue) continue;
        if (st.owner_uid === uidValue || st.owner_uid === null) continue;
        if (!Number.isFinite(st.price)) continue;
        outbids.push({
          slug,
          title: st.title,
          by: st.owner_login ?? 'Чатерс',
          price: st.price,
          at: Date.now(),
          video: st.video_url,
        });
      }
    }

    catalogValue = merged;
    const freshChanged = ok !== catalogFresh;
    catalogFresh = ok;
    if (changed.size > 0 || freshChanged || !catalogKnown) {
      catalogKnown = true;
      emit({ kind: 'catalog', changed, fresh: ok });
    }
    // Перекуп — после каталога: кнопкам возврата уже видна свежая N.
    for (const event of outbids) emit({ kind: 'outbid', event });
  }

  /** Баланс пришёл (или не пришёл): null не затирает последнее хорошее. */
  function applyBalance(value: number | null): void {
    const first = !balanceTried;
    balanceTried = true;
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

  async function readCatalogNow(): Promise<void> {
    let read: CatalogRead;
    try {
      read = await readers.readCatalog(uidValue);
    } catch {
      read = { ok: false, states: catalogValue };
    }
    applyCatalog(read.ok ? read.states : catalogValue, read.ok);
  }

  async function readAllNow(): Promise<void> {
    const u = await readUidSafe();
    applyUid(u);
    // Баланс раньше каталога: поверхности рисуют каталог уже с балансом
    // (без мигания «не хватает»), как было до переезда.
    if (u !== null) await readBalanceNow(u);
    await readCatalogNow();
  }

  /**
   * Единственная дорожка перечитывания. Триггер во время чтения не теряется:
   * копится один догоняющий проход сильнейшего охвата ('all' > 'catalog').
   */
  function schedule(scope: 'all' | 'catalog'): Promise<void> {
    if (inFlight) {
      pending = pending === 'all' || scope === 'all' ? 'all' : 'catalog';
      return inFlight;
    }
    const run = (async () => {
      let current: 'all' | 'catalog' | null = scope;
      while (current !== null) {
        pending = null;
        await (current === 'all' ? readAllNow() : readCatalogNow());
        current = pending;
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
    if (next !== before && next !== null) void readBalanceNow(next);
  }

  return {
    uid: () => uidValue,
    balance: () => balanceValue,
    balanceKnown: () => balanceTried,
    catalog: () => catalogValue,
    lot: (slug) => catalogValue.get(slug) ?? null,
    catalogKnown: () => catalogKnown,
    catalogOk: () => catalogFresh,

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
        prime({ kind: 'balance', balance: balanceValue, fresh: balanceValue !== null });
      }
      if (catalogKnown) {
        prime({ kind: 'catalog', changed: new Set(catalogValue.keys()), fresh: catalogFresh });
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
      return schedule('all');
    },

    refreshCatalog() {
      return schedule('catalog');
    },

    applyUid,

    async refreshBalance() {
      const u = await readUidSafe();
      applyUid(u);
      if (u === null) return null;
      return readBalanceNow(u);
    },

    async refreshLot(slug) {
      let read: LotStateRead;
      try {
        read = await readers.readLot(slug, uidValue);
      } catch {
        return null;
      }
      if (!read.ok) return null;
      const next = new Map(catalogValue);
      if (read.state) next.set(slug, read.state);
      else next.delete(slug);
      applyCatalog(next, true);
      return read.state;
    },

    reportBalance(value) {
      if (!Number.isFinite(value) || value < 0) return;
      applyBalance(value);
    },

    reportPurchase(purchase) {
      emit({ kind: 'purchase', purchase });
      return schedule('all');
    },

    reportDeal() {
      emit({ kind: 'deals' });
    },
  };
}
