/**
 * Общие fake-читатели и журнал событий для тестов владельцев live-store.
 *
 * Только фабрики: состояние БД в памяти, задержки чтений и сбор событий;
 * поведения конкретного владельца здесь нет.
 */

import { compareCatalog, type CatalogKey } from './catalog-page';
import type { LiveChange, LiveReaders, LotState } from './live-store-model';

export function lot(overrides: Partial<LotState> = {}): LotState {
  return {
    slug: 'lot-a',
    title: 'Привет A',
    video_url: null,
    price: 100,
    nextPrice: 110,
    owner_login: 'alice',
    owner_uid: 'u1',
    suggested_by_login: null,
    ...overrides,
  };
}

export interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

export function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

export interface FakeReaders {
  readers: LiveReaders;
  calls: {
    uid: number;
    balance: number;
    random: number;
    bySlugs: number;
    lot: number;
    page: number;
    mine: number;
  };
  state: {
    uid: string | null;
    balance: number | null;
    catalog: Map<string, LotState>;
    lots: Map<string, LotState | null>;
  };
  fail: { catalog: boolean; balance: boolean };
  /** Задержать чтение среза каталога; вернуть release. */
  holdCatalog(): () => void;
  /** Задержать чтение баланса; вернуть release. */
  holdBalance(): () => void;
  /** Задержать чтение «Моих приветов»; вернуть release. */
  holdMyLots(): () => void;
}

export function fakeReaders(): FakeReaders {
  const calls = { uid: 0, balance: 0, random: 0, bySlugs: 0, lot: 0, page: 0, mine: 0 };
  const state = {
    uid: null as string | null,
    balance: null as number | null,
    catalog: new Map<string, LotState>(),
    lots: new Map<string, LotState | null>(),
  };
  const fail = { catalog: false, balance: false };
  let catalogGate: Promise<void> | null = null;
  let balanceGate: Promise<void> | null = null;
  let mineGate: Promise<void> | null = null;

  const ordered = (): LotState[] =>
    [...state.catalog.values()].sort((a, b) => compareCatalog(a, b));
  const after = (row: CatalogKey, cursor: CatalogKey): boolean => compareCatalog(row, cursor) > 0;

  const readers: LiveReaders = {
    async readUid() {
      calls.uid += 1;
      return state.uid;
    },
    async readBalance() {
      calls.balance += 1;
      const wait = balanceGate;
      if (wait) await wait;
      return fail.balance ? null : state.balance;
    },
    async readRandomLots(limit) {
      const wait = catalogGate;
      if (wait) await wait;
      calls.random += 1;
      if (fail.catalog) return { ok: false, states: [] };
      return { ok: true, states: ordered().slice(0, Math.max(1, limit)) };
    },
    async readCatalogPage(cursor, limit) {
      const wait = catalogGate;
      if (wait) await wait;
      calls.page += 1;
      if (fail.catalog) return { ok: false, states: [], hasMore: false };
      const rows = ordered().filter((row) => (cursor ? after(row, cursor) : true));
      return {
        ok: true,
        states: rows.slice(0, Math.max(1, limit)),
        hasMore: rows.length > Math.max(1, limit),
      };
    },
    async readCatalogBySlugs(slugs) {
      const wait = catalogGate;
      if (wait) await wait;
      calls.bySlugs += 1;
      if (fail.catalog) return { ok: false, states: new Map<string, LotState>() };
      const states = new Map<string, LotState>();
      for (const slug of slugs) {
        const lotState = state.catalog.get(slug);
        if (lotState) states.set(slug, lotState);
      }
      return { ok: true, states };
    },
    async readMyLots(uid) {
      const wait = mineGate;
      if (wait) await wait;
      calls.mine += 1;
      if (fail.catalog) return { ok: false, states: new Map<string, LotState>() };
      const states = new Map<string, LotState>();
      for (const lotState of ordered()) {
        if (lotState.owner_uid === uid) states.set(lotState.slug, lotState);
      }
      return { ok: true, states };
    },
    async readLot(slug) {
      calls.lot += 1;
      if (fail.catalog) return { ok: false, state: null };
      if (!state.lots.has(slug)) return { ok: false, state: null };
      return { ok: true, state: state.lots.get(slug) ?? null };
    },
  };

  return {
    readers,
    calls,
    state,
    fail,
    holdCatalog() {
      const d = deferred();
      catalogGate = d.promise;
      return () => {
        catalogGate = null;
        d.resolve();
      };
    },
    holdBalance() {
      const d = deferred();
      balanceGate = d.promise;
      return () => {
        balanceGate = null;
        d.resolve();
      };
    },
    holdMyLots() {
      const d = deferred();
      mineGate = d.promise;
      return () => {
        mineGate = null;
        d.resolve();
      };
    },
  };
}

export function changeLog(): { events: LiveChange[]; emit: (change: LiveChange) => void } {
  const events: LiveChange[] = [];
  return { events, emit: (change) => events.push(change) };
}

export interface ChangeSource {
  subscribe(cb: (change: LiveChange) => void): () => void;
}

export function collect(source: ChangeSource): LiveChange[] {
  const events: LiveChange[] = [];
  source.subscribe((change) => events.push(change));
  return events;
}

export function kinds(events: LiveChange[]): string[] {
  return events.map((event) => event.kind);
}
