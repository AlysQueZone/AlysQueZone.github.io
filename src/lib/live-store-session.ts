/**
 * Сессия и «Мои приветы»: uid, первое ожидание, полный список владельца.
 *
 * Контракт: владелец помнит uid и его «известность» (unknown → guest/user),
 * отпускает `whenUidKnown` без поллинга и читает полный список лотов владельца
 * отдельным запросом. Чужой ответ после смены uid не подхватывается; дедуп
 * дорожки списка — здесь. Коалесцинг перечитываний — у фасада, сброс списка
 * при смене сессии фасад ставит между балансом и списком.
 * Решение — docs/adr/0003, «Мои приветы» — docs/adr/0012.
 */

import {
  mergeLotState,
  outbidFrom,
  type CatalogRead,
  type LiveChange,
  type LiveReaders,
  type LotState,
  type SessionState,
} from './live-store-model';

export interface SessionOwnerDeps {
  readUid: LiveReaders['readUid'];
  readMyLots: LiveReaders['readMyLots'];
  readLot: LiveReaders['readLot'];
  emit(change: LiveChange): void;
  /** Положить свежие строки в карту каталога, не трогая окно и события. */
  rememberCatalog(states: readonly LotState[]): void;
}

export interface SessionOwner {
  uid(): string | null;
  uidKnown(): boolean;
  state(): SessionState;
  /** Первый прочитанный uid (гостем — null); один резолв на всех ожидающих. */
  whenUidKnown(): Promise<string | null>;
  /** Полный список «Моих приветов» владельца. */
  myLots(): readonly LotState[];
  /** Был ли ответ по «Моим приветам» (для честного скелетона). */
  myLotsKnown(): boolean;
  myLotsTracked(): boolean;
  /** Записать uid; true — сменился (событие `uid` уже объявлено). */
  applyUid(next: string | null): boolean;
  /** Сбросить чужой список после смены uid. */
  resetMyLots(): void;
  /** Включить полный список владельца; до uid — только флаг. */
  trackMyLots(): void;
  readMyLots(uid: string, force?: boolean): Promise<void>;
  /** Читатель uid с фолбэком на текущий: транспорт может не ответить. */
  readUidSafe(): Promise<string | null>;
  lot(slug: string): LotState | null;
}

export function createSessionOwner(deps: SessionOwnerDeps): SessionOwner {
  let uidValue: string | null = null;
  /** uid прочитан хотя бы раз (значение могло быть null — гость): подписка
   *  сразу отдаёт состояние, пришедшее до неё (авторизация между скриптами). */
  let uidKnown = false;
  /** Ожидающие первого applyUid: резолвятся разом и отпускаются. */
  let uidWaiters: ((uid: string | null) => void)[] | null = null;

  /** «Мои приветы» полным списком владельца — включается поверхностью. */
  let myLotsTracked = false;
  let myLotsValue = new Map<string, LotState>();
  let myLotsTried = false;
  /** Чей список сейчас в снапшоте: смена uid не подхватывает чужой ответ. */
  let myLotsUid: string | null = null;
  let myLotsInFlight: Promise<void> | null = null;
  let myLotsInFlightUid: string | null = null;

  /**
   * «Мои приветы» полным списком: окно витрины может не содержать часть моих
   * лотов, поэтому это отдельный запрос владельца. Ушедшие лоты дочитываются
   * по одному — событию перекупа нужен новый владелец и цена.
   */
  function readMyLots(uid: string, force = false): Promise<void> {
    if (!myLotsTracked) return Promise.resolve();
    if (!force && myLotsUid === uid) return myLotsInFlight ?? Promise.resolve();
    if (myLotsInFlight && myLotsInFlightUid === uid) return myLotsInFlight;

    const run = (async (): Promise<void> => {
      let read: CatalogRead;
      try {
        read = await deps.readMyLots(uid);
      } catch {
        read = { ok: false, states: new Map() };
      }
      if (uid !== uidValue || !myLotsTracked) return;
      // Отказ не выдаём за «пусто»: скелетон честнее; синк/фокус повторят.
      if (!read.ok) return;

      const prev = myLotsValue;
      const next = new Map<string, LotState>();
      const changed = new Set<string>();
      for (const raw of read.states.values()) {
        const merged = mergeLotState(next, raw);
        if (merged.changed) changed.add(raw.slug);
      }

      const gone = [...prev.keys()].filter((slug) => !next.has(slug));
      const sold: LotState[] = [];
      for (const slug of gone) {
        changed.add(slug);
        try {
          const one = await deps.readLot(slug);
          if (one.ok && one.state && one.state.owner_uid !== uid) sold.push(one.state);
        } catch {
          // best effort: колокол догонит сделку на фокусе/синке
        }
      }
      if (uid !== uidValue || !myLotsTracked) return;

      myLotsValue = next;
      myLotsTried = true;
      myLotsUid = uid;
      deps.emit({ kind: 'myLots', changed });

      if (sold.length > 0) {
        // Свежие строки — в карту, но не в окно: кнопке возврата нужна их N.
        deps.rememberCatalog(sold);
        for (const st of sold) deps.emit({ kind: 'outbid', event: outbidFrom(st) });
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

  return {
    uid: () => uidValue,
    uidKnown: () => uidKnown,
    state: () => (!uidKnown ? 'unknown' : uidValue === null ? 'guest' : 'user'),

    whenUidKnown() {
      if (uidKnown) return Promise.resolve(uidValue);
      return new Promise((resolve) => {
        (uidWaiters ??= []).push(resolve);
      });
    },

    myLots: () => [...myLotsValue.values()],
    myLotsKnown: () => myLotsTried,
    myLotsTracked: () => myLotsTracked,

    applyUid(next) {
      uidKnown = true;
      const changed = next !== uidValue;
      uidValue = next;
      // Первый ответ по uid (даже гостевой null) отпускает всех ожидающих.
      const waiters = uidWaiters;
      uidWaiters = null;
      if (waiters) for (const resolve of waiters) resolve(next);
      if (changed) deps.emit({ kind: 'uid', uid: next });
      return changed;
    },

    resetMyLots() {
      if (!myLotsTracked) return;
      if (myLotsValue.size > 0) {
        deps.emit({ kind: 'myLots', changed: new Set(myLotsValue.keys()) });
      }
      myLotsValue = new Map();
      myLotsTried = false;
      myLotsUid = null;
    },

    trackMyLots() {
      if (myLotsTracked) return;
      myLotsTracked = true;
      if (uidKnown && uidValue !== null) void readMyLots(uidValue);
    },

    readMyLots,

    async readUidSafe() {
      try {
        return await deps.readUid();
      } catch {
        return uidValue;
      }
    },

    lot: (slug) => myLotsValue.get(slug) ?? null,
  };
}
