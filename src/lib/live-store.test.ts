/**
 * Тесты снапшота живых данных (docs/adr/0003): синхронные чтения,
 * коалесцинг перечитываний, флаг свежести, доменные события из диффа снапшота.
 *
 * Гоняются с fake-readers — без сети, DOM и Supabase; проверяют ровно те
 * швы, из-за которых снапшот вынесен из страниц.
 */
import { describe, expect, it } from 'vitest';
import { compareCatalog, type CatalogKey } from './catalog-page';
import {
  createLiveStore,
  type LiveChange,
  type LiveReaders,
  type LiveStore,
  type LotState,
} from './live-store';

function lot(overrides: Partial<LotState> = {}): LotState {
  return {
    slug: 'lot-a',
    title: 'Привет A',
    video_url: null,
    price: 100,
    nextPrice: 110,
    owner_login: 'alice',
    owner_uid: 'u1',
    suggested_by_login: null,
    mine: false,
    ...overrides,
  };
}

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

interface FakeReaders {
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
  /** Задержать чтение каталога (коалесцинг); вернуть release. */
  holdCatalog(): () => void;
  /** Задержать чтение баланса (гонка со сменой uid); вернуть release. */
  holdBalance(): () => void;
}

function fakeReaders(): FakeReaders {
  const calls = { uid: 0, balance: 0, random: 0, bySlugs: 0, lot: 0, page: 0, mine: 0 };
  const state = {
    uid: null as string | null,
    balance: null as number | null,
    catalog: new Map<string, LotState>(),
    lots: new Map<string, LotState | null>(),
  };
  const fail = { catalog: false, balance: false };
  let gate: Promise<void> | null = null;
  let balanceGate: Promise<void> | null = null;

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
    async readRandomLots(_uid, limit) {
      const wait = gate;
      if (wait) await wait;
      calls.random += 1;
      if (fail.catalog) return { ok: false, states: [] };
      return { ok: true, states: ordered().slice(0, Math.max(1, limit)) };
    },
    async readCatalogPage(_uid, cursor, limit) {
      const wait = gate;
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
    async readCatalogBySlugs(_uid, slugs) {
      const wait = gate;
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
      gate = d.promise;
      return () => {
        gate = null;
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
  };
}

function collect(store: LiveStore): LiveChange[] {
  const events: LiveChange[] = [];
  store.subscribe((change) => events.push(change));
  return events;
}

function kinds(events: LiveChange[]): string[] {
  return events.map((event) => event.kind);
}

describe('createLiveStore', () => {
  it('start читает снапшот: uid, баланс, выборку — и объявляет их', async () => {
    const f = fakeReaders();
    f.state.uid = 'u1';
    f.state.balance = 1000;
    f.state.catalog.set('lot-a', lot({ mine: true }));
    const store = createLiveStore(f.readers);
    store.useRandomLots(1);
    const events = collect(store);

    await store.start();

    expect(store.uid()).toBe('u1');
    expect(store.balance()).toBe(1000);
    expect(store.balanceKnown()).toBe(true);
    expect(store.catalog().get('lot-a')?.mine).toBe(true);
    expect(store.catalogOk()).toBe(true);
    expect(kinds(events)).toEqual(['uid', 'balance', 'catalog']);
  });

  it('гость: uid null, баланс не читается, каталог всё равно объявляется', async () => {
    const f = fakeReaders();
    f.state.catalog.set('lot-a', lot());
    const store = createLiveStore(f.readers);
    store.useRandomLots(1);
    const events = collect(store);

    await store.start();

    expect(store.uid()).toBeNull();
    expect(store.balance()).toBeNull();
    expect(f.calls.balance).toBe(0);
    // Гость ничего не объявляет по uid (некому), каталог — объявляется.
    expect(kinds(events)).toEqual(['catalog']);
  });

  it('выборка: правка и удаление — changed ровно эти slug; новый лот ждёт перезагрузки', async () => {
    const f = fakeReaders();
    const keep = lot({ slug: 'lot-keep' });
    f.state.catalog.set('lot-a', lot());
    f.state.catalog.set('lot-b', lot({ slug: 'lot-b' }));
    f.state.catalog.set('lot-keep', keep);
    const store = createLiveStore(f.readers);
    store.useRandomLots(10);
    const events = collect(store);
    await store.start();
    expect(store.catalogWindow()).toHaveLength(3);

    f.state.catalog = new Map([
      ['lot-a', lot({ price: 150 })],
      ['lot-c', lot({ slug: 'lot-c' })],
      ['lot-keep', keep],
    ]);
    await store.refreshCatalog();

    const last = events.at(-1);
    expect(last?.kind).toBe('catalog');
    if (last?.kind !== 'catalog') throw new Error('ожидалось событие каталога');
    expect([...last.changed].sort()).toEqual(['lot-a', 'lot-b']);
    expect(store.catalog().size).toBe(2);
    expect(store.catalog().get('lot-a')?.price).toBe(150);
    // Неизменившийся лот не пересобирался — ссылка та же.
    expect(store.catalog().get('lot-keep')).toBe(keep);
    // Новый лот вне выборки: главная его не добирает (ADR 0012).
    expect(store.catalog().has('lot-c')).toBe(false);
  });

  it('неудача перечитывания не затирает последнее хорошее, свежесть — false', async () => {
    const f = fakeReaders();
    f.state.catalog.set('lot-a', lot());
    const store = createLiveStore(f.readers);
    store.useRandomLots(1);
    const events = collect(store);
    await store.start();
    const good = store.catalog().get('lot-a');

    f.fail.catalog = true;
    await store.refreshCatalog();

    expect(store.catalogOk()).toBe(false);
    expect(store.catalog().get('lot-a')).toBe(good);
    expect(events.at(-1)).toMatchObject({ kind: 'catalog', fresh: false });

    f.fail.catalog = false;
    await store.refreshCatalog();
    expect(store.catalogOk()).toBe(true);
    expect(events.at(-1)).toMatchObject({ kind: 'catalog', fresh: true });
  });

  it('первый отказ каталога объявляется: пустой снапшот + fresh false', async () => {
    const f = fakeReaders();
    f.fail.catalog = true;
    const store = createLiveStore(f.readers);
    store.useRandomLots(1);
    const events = collect(store);

    await store.start();

    expect(store.catalogOk()).toBe(false);
    expect(events.at(-1)).toMatchObject({ kind: 'catalog', fresh: false });
  });

  it('коалесцинг: триггеры во время чтения дают один догоняющий проход', async () => {
    const f = fakeReaders();
    f.state.catalog.set('lot-a', lot());
    const store = createLiveStore(f.readers);
    store.useRandomLots(1);
    await store.start();
    expect(f.calls.random).toBe(1);

    const release = f.holdCatalog();
    const first = store.refreshCatalog();
    const second = store.refreshCatalog();
    release();
    await Promise.all([first, second]);

    // Первый тик прочитал выборку, второй не потерялся — догнал одним проходом.
    expect(f.calls.bySlugs).toBe(2);
  });

  it('смена uid: «мой» флаг пересчитан без чтения каталога, чужой баланс не показывается', async () => {
    const f = fakeReaders();
    f.state.uid = 'u1';
    f.state.balance = 1000;
    f.state.catalog.set('lot-a', lot({ owner_uid: 'u1', mine: true }));
    const store = createLiveStore(f.readers);
    store.useRandomLots(1);
    const events = collect(store);
    await store.start();
    const catalogCalls = f.calls.random + f.calls.bySlugs;

    f.state.uid = 'u2';
    f.state.balance = 2000;
    store.applyUid('u2');
    await store.refreshBalance();

    expect(f.calls.random + f.calls.bySlugs).toBe(catalogCalls);
    expect(store.catalog().get('lot-a')?.mine).toBe(false);
    expect(store.balance()).toBe(2000);
    expect(kinds(events)).toEqual([
      'uid',
      'balance',
      'catalog',
      'uid',
      'catalog',
      'balance',
      'balance',
    ]);
    expect(events.some((event) => event.kind === 'outbid')).toBe(false);
  });

  it('смена владельца моего лота — событие перекупа из диффа; чужой лот молчит', async () => {
    const f = fakeReaders();
    f.state.uid = 'u1';
    f.state.balance = 1000;
    f.state.catalog.set(
      'lot-mine',
      lot({ slug: 'lot-mine', owner_uid: 'u1', owner_login: 'me', mine: true })
    );
    f.state.catalog.set(
      'lot-other',
      lot({ slug: 'lot-other', owner_uid: 'u2', owner_login: 'bob' })
    );
    const store = createLiveStore(f.readers);
    store.useRandomLots(10);
    const events = collect(store);
    await store.start();

    f.state.catalog.set(
      'lot-mine',
      lot({
        slug: 'lot-mine',
        title: 'Мой',
        owner_uid: 'u3',
        owner_login: 'carol',
        price: 150,
        video_url: 'https://media/lot-mine.mp4',
      })
    );
    f.state.catalog.set(
      'lot-other',
      lot({ slug: 'lot-other', owner_uid: 'u4', owner_login: 'dave' })
    );
    await store.refreshCatalog();

    const outbids = events.filter((event) => event.kind === 'outbid');
    expect(outbids).toHaveLength(1);
    expect(outbids[0]).toMatchObject({
      kind: 'outbid',
      event: {
        slug: 'lot-mine',
        title: 'Мой',
        by: 'carol',
        price: 150,
        video: 'https://media/lot-mine.mp4',
      },
    });
    if (outbids[0]?.kind === 'outbid') expect(outbids[0].event.at).toBeGreaterThan(0);
  });

  it('своя покупка: событие purchase + перечитка; перекупа нет', async () => {
    const f = fakeReaders();
    f.state.uid = 'u1';
    f.state.balance = 1000;
    f.state.catalog.set('lot-a', lot({ owner_uid: 'u2', owner_login: 'bob' }));
    const store = createLiveStore(f.readers);
    store.useRandomLots(1);
    const events = collect(store);
    await store.start();

    f.state.balance = 850;
    f.state.catalog.set(
      'lot-a',
      lot({ owner_uid: 'u1', owner_login: 'me', mine: true, price: 150 })
    );
    await store.reportPurchase({ slug: 'lot-a', price: 150 });

    expect(
      events.some((event) => event.kind === 'purchase' && event.purchase.slug === 'lot-a')
    ).toBe(true);
    expect(events.some((event) => event.kind === 'outbid')).toBe(false);
    expect(store.balance()).toBe(850);
    expect(store.lot('lot-a')?.mine).toBe(true);
  });

  it('явная свежесть гейта: отказ — null и последнее хорошее на экране, успех — свежее значение', async () => {
    const f = fakeReaders();
    f.state.uid = 'u1';
    f.state.balance = 1000;
    const store = createLiveStore(f.readers);
    await store.start();

    f.fail.balance = true;
    expect(await store.refreshBalance()).toBeNull();
    expect(store.balance()).toBe(1000);
    // Новый подписчик видит последнее хорошее, но честно несвежее.
    const primed = collect(store).find((event) => event.kind === 'balance');
    expect(primed).toMatchObject({ balance: 1000, fresh: false });

    f.fail.balance = false;
    f.state.balance = 700;
    expect(await store.refreshBalance()).toBe(700);
    expect(store.balance()).toBe(700);
    const after = collect(store).find((event) => event.kind === 'balance');
    expect(after).toMatchObject({ balance: 700, fresh: true });
  });

  it('церемония держит баланс: значения копятся, release раскрывает последнее', async () => {
    const f = fakeReaders();
    f.state.uid = 'u1';
    f.state.balance = 1000;
    const store = createLiveStore(f.readers);
    const events = collect(store);
    await store.start();
    const balanceEvents = (): LiveChange[] => events.filter((e) => e.kind === 'balance');
    expect(balanceEvents()).toHaveLength(1);

    const release = store.deferBalance();
    store.reportBalance(900);
    store.reportBalance(950);

    // Снапшот и события ещё держат прежнее значение.
    expect(store.balance()).toBe(1000);
    expect(balanceEvents()).toHaveLength(1);

    release();

    expect(store.balance()).toBe(950);
    expect(balanceEvents()).toHaveLength(2);
    expect(balanceEvents().at(-1)).toMatchObject({ kind: 'balance', balance: 950, fresh: true });
  });

  it('release идемпотентен: повторный вызов ничего не раскрывает и не эмитит', async () => {
    const f = fakeReaders();
    f.state.uid = 'u1';
    f.state.balance = 1000;
    const store = createLiveStore(f.readers);
    const events = collect(store);
    await store.start();

    const release = store.deferBalance();
    store.reportBalance(900);
    release();
    release();

    expect(events.filter((e) => e.kind === 'balance')).toHaveLength(2);
    expect(store.balance()).toBe(900);
  });

  it('refreshBalance под удержанием: гейт получает свежее, снапшот — нет; null не раскрывается', async () => {
    const f = fakeReaders();
    f.state.uid = 'u1';
    f.state.balance = 1000;
    const store = createLiveStore(f.readers);
    await store.start();

    const release = store.deferBalance();
    f.fail.balance = true;
    expect(await store.refreshBalance()).toBeNull();
    f.fail.balance = false;
    f.state.balance = 700;
    expect(await store.refreshBalance()).toBe(700);
    expect(store.balance()).toBe(1000); // придержано

    release();
    expect(store.balance()).toBe(700);
  });

  it('смена uid под церемонией: значение прежнего uid не раскрывается', async () => {
    const f = fakeReaders();
    f.state.uid = 'u1';
    f.state.balance = 1000;
    const store = createLiveStore(f.readers);
    await store.start();

    const release = store.deferBalance();
    store.reportBalance(900);
    store.applyUid('u2');
    release();

    expect(store.uid()).toBe('u2');
    expect(store.balance()).toBeNull();
  });

  it('refreshLot не подменяет здоровье каталога одиночным чтением', async () => {
    const f = fakeReaders();
    f.state.catalog.set('lot-a', lot());
    const store = createLiveStore(f.readers);
    store.useRandomLots(1);
    const events = collect(store);
    await store.start();

    f.fail.catalog = true;
    await store.refreshCatalog();
    expect(store.catalogOk()).toBe(false);

    // Модалка открылась и прочитала один лот — каталог всё ещё несвежий.
    f.fail.catalog = false;
    f.state.lots.set('lot-a', lot({ price: 120, nextPrice: 130 }));
    await store.refreshLot('lot-a');
    expect(store.lot('lot-a')?.price).toBe(120);
    expect(store.catalogOk()).toBe(false);
    expect(events.at(-1)).toMatchObject({ kind: 'catalog', fresh: false });
  });

  it('refreshLot: одиночная строка сливается с каталогом, исчезнувшая — уходит', async () => {
    const f = fakeReaders();
    f.state.catalog.set('lot-a', lot());
    const store = createLiveStore(f.readers);
    store.useRandomLots(1);
    const events = collect(store);
    await store.start();

    f.state.lots.set('lot-a', lot({ price: 120, nextPrice: 130 }));
    f.state.lots.set('lot-b', lot({ slug: 'lot-b' }));
    expect(await store.refreshLot('lot-a')).toMatchObject({ price: 120 });
    expect(await store.refreshLot('lot-b')).toMatchObject({ slug: 'lot-b' });
    expect(store.lot('lot-a')?.nextPrice).toBe(130);
    expect(store.lot('lot-b')?.slug).toBe('lot-b');
    expect(events.at(-1)).toMatchObject({ kind: 'catalog' });

    f.state.lots.set('lot-b', null);
    expect(await store.refreshLot('lot-b')).toBeNull();
    expect(store.lot('lot-b')).toBeNull();
  });

  it('смена uid во время чтения баланса: чужой ответ не подхватывается, свой читается', async () => {
    const f = fakeReaders();
    f.state.uid = 'u1';
    f.state.balance = 1000;
    const store = createLiveStore(f.readers);
    const release = f.holdBalance();
    const started = store.start(); // висит на чтении баланса u1

    // Пока баланс u1 в полёте, вкладку переоткрыли за u2.
    f.state.uid = 'u2';
    f.state.balance = 2000;
    store.applyUid('u2');
    release();
    await started;

    expect(store.balance()).toBe(2000);
  });

  it('ответ каталога с чужим «мой» флагом нормализуется под текущий uid', async () => {
    const f = fakeReaders();
    f.state.uid = 'u1';
    f.state.catalog.set('lot-a', lot({ owner_uid: 'u1', mine: true }));
    const store = createLiveStore(f.readers);
    store.useRandomLots(1);
    await store.start();

    // Гонка: uid сменился, пока выборка была в полёте; ответ несёт флаг старого uid.
    store.applyUid('u2');
    await store.refreshCatalog();

    expect(store.lot('lot-a')?.mine).toBe(false);
  });

  it('подписка после первого чтения сразу отдаёт текущее состояние', async () => {
    const f = fakeReaders();
    f.state.uid = 'u1';
    f.state.balance = 1000;
    f.state.catalog.set('lot-a', lot());
    const store = createLiveStore(f.readers);
    store.useRandomLots(1);
    await store.start();

    const late = collect(store);

    expect(kinds(late)).toEqual(['uid', 'balance', 'catalog']);
    expect(late[0]).toMatchObject({ kind: 'uid', uid: 'u1' });
    expect(late[1]).toMatchObject({ kind: 'balance', balance: 1000 });
    if (late[2]?.kind === 'catalog') expect([...late[2].changed]).toEqual(['lot-a']);
  });

  it('подписка отдаёт только прочитанное: uid до старта — без выдуманного каталога', async () => {
    const f = fakeReaders();
    f.state.uid = 'u1';
    f.state.balance = 500;
    const store = createLiveStore(f.readers);
    store.useRandomLots(1);
    expect(store.catalogKnown()).toBe(false);

    // Авторизация сработала до первого чтения (между скриптами страницы).
    store.applyUid('u1');
    const events = collect(store);

    // uid уже известен — отдан сразу; баланс ещё в полёте; каталог не выдуман.
    expect(kinds(events)).toEqual(['uid']);

    await store.start();
    expect(store.catalogKnown()).toBe(true);
    expect(kinds(events)).toContain('balance');
    expect(kinds(events)).toContain('catalog');
  });

  it('sync объявляет синк и перечитывает; reportDeal объявляет сделку', async () => {
    const f = fakeReaders();
    f.state.catalog.set('lot-a', lot());
    const store = createLiveStore(f.readers);
    store.useRandomLots(1);
    const events = collect(store);
    await store.start();
    const catalogCalls = f.calls.bySlugs;

    await store.sync();
    store.reportDeal();

    expect(f.calls.bySlugs).toBe(catalogCalls + 1);
    expect(kinds(events).at(-2)).toBe('sync');
    expect(kinds(events).at(-1)).toBe('deals');
  });

  it('сломанный подписчик не глушит остальных', async () => {
    const f = fakeReaders();
    f.state.catalog.set('lot-a', lot());
    const store = createLiveStore(f.readers);
    store.useRandomLots(1);
    const heard: LiveChange[] = [];
    store.subscribe(() => {
      throw new Error('сломанный подписчик');
    });
    store.subscribe((change) => heard.push(change));

    await store.start();

    expect(heard.length).toBeGreaterThan(0);
  });

  it('выборка главной: старт читает N, тик обновляет только её, новые лоты не вставляются', async () => {
    const f = fakeReaders();
    for (let i = 0; i < 5; i++) {
      const slug = `lot-${i}`;
      f.state.catalog.set(slug, lot({ slug, price: 100 + i }));
    }
    const store = createLiveStore(f.readers);
    store.useRandomLots(2);
    await store.start();

    expect(f.calls.random).toBe(1);
    expect(store.catalogWindow().map((st) => st.slug)).toEqual(['lot-0', 'lot-1']);
    expect(store.catalog().size).toBe(2);
    expect(store.catalogHasMore()).toBe(false);

    const selected = store.catalogWindow()[0];
    if (!selected) throw new Error('ожидалась выборка');
    f.state.catalog.set(selected.slug, lot({ slug: selected.slug, price: 999, nextPrice: 1000 }));
    await store.reportLotsTick({ eventType: 'UPDATE', new: { slug: selected.slug } });
    expect(f.calls.bySlugs).toBe(1);
    expect(store.catalog().get(selected.slug)?.price).toBe(999);
    expect(store.catalog().size).toBe(2);

    // Новый лот приходит только следующей загрузкой: выборка стабильна.
    f.state.catalog.set('lot-new', lot({ slug: 'lot-new', price: 50 }));
    await store.reportLotsTick({ eventType: 'INSERT', new: { slug: 'lot-new' } });
    expect(store.catalogWindow().map((st) => st.slug)).toEqual(['lot-0', 'lot-1']);
    expect(store.catalog().has('lot-new')).toBe(false);
    // UPDATE и INSERT обновили только окно по slug — полного каталога нет.
    expect(f.calls.bySlugs).toBe(2);
  });

  it('один лот: старт и тик читают только его, без полного каталога', async () => {
    const f = fakeReaders();
    f.state.catalog.set('lot-a', lot({ slug: 'lot-a', price: 100 }));
    f.state.catalog.set('lot-b', lot({ slug: 'lot-b', price: 200 }));
    const store = createLiveStore(f.readers);
    store.useLot('lot-a');
    await store.start();

    expect(f.calls.random).toBe(0);
    expect(f.calls.bySlugs).toBe(1);
    expect(store.catalogWindow().map((st) => st.slug)).toEqual(['lot-a']);
    expect(store.catalog().has('lot-b')).toBe(false);

    f.state.catalog.set('lot-a', lot({ slug: 'lot-a', price: 150 }));
    await store.reportLotsTick({ eventType: 'UPDATE', new: { slug: 'lot-a' } });
    expect(store.lot('lot-a')?.price).toBe(150);
    expect(f.calls.bySlugs).toBe(2);
  });

  it('один лот: нет строки — «лота нет», отказ БД — «не загрузилось»', async () => {
    const missing = fakeReaders();
    const missingStore = createLiveStore(missing.readers);
    missingStore.useLot('lot-missing');
    await missingStore.start();

    expect(missingStore.catalogKnown()).toBe(true);
    expect(missingStore.catalogOk()).toBe(true);
    expect(missingStore.lot('lot-missing')).toBeNull();
    expect(missingStore.catalogWindow()).toHaveLength(0);

    const broken = fakeReaders();
    broken.fail.catalog = true;
    const brokenStore = createLiveStore(broken.readers);
    brokenStore.useLot('lot-a');
    await brokenStore.start();

    expect(brokenStore.catalogKnown()).toBe(true);
    expect(brokenStore.catalogOk()).toBe(false);
    expect(brokenStore.lot('lot-a')).toBeNull();
  });

  it('колокол на выборке: «Мои приветы» дают перекуп вне окна', async () => {
    const f = fakeReaders();
    f.state.uid = 'u1';
    f.state.balance = 1000;
    f.state.catalog.set(
      'lot-mine',
      lot({ slug: 'lot-mine', price: 900, owner_uid: 'u1', owner_login: 'me', mine: true })
    );
    f.state.catalog.set('lot-other', lot({ slug: 'lot-other', price: 100, owner_uid: 'u2' }));
    const store = createLiveStore(f.readers);
    store.useRandomLots(1);
    store.trackMyLots();
    const events = collect(store);
    await store.start();

    // Выбрался дешёвый чужой лот; мой — вне окна, но в «Моих приветах».
    expect(store.catalogWindow().map((st) => st.slug)).toEqual(['lot-other']);
    expect(store.myLots().map((st) => st.slug)).toEqual(['lot-mine']);

    f.state.catalog.set(
      'lot-mine',
      lot({ slug: 'lot-mine', title: 'Мой', price: 1200, owner_uid: 'u3', owner_login: 'carol' })
    );
    f.state.lots.set(
      'lot-mine',
      lot({ slug: 'lot-mine', title: 'Мой', price: 1200, owner_uid: 'u3', owner_login: 'carol' })
    );
    await store.reportDeal();

    const outbids = events.filter((event) => event.kind === 'outbid');
    expect(outbids).toHaveLength(1);
    expect(outbids[0]).toMatchObject({
      kind: 'outbid',
      event: { slug: 'lot-mine', title: 'Мой', by: 'carol', price: 1200 },
    });
    expect(store.catalogWindow().map((st) => st.slug)).toEqual(['lot-other']);
  });

  it('витрина страницами: первая страница — окно, следующая дописывается, дальше конец', async () => {
    const f = fakeReaders();
    for (let i = 0; i < 15; i++) {
      const slug = `lot-${String(i).padStart(2, '0')}`;
      f.state.catalog.set(slug, lot({ slug, price: 100 + i }));
    }
    const store = createLiveStore(f.readers);
    store.useCatalogPages(12);
    await store.start();

    expect(store.catalogWindow()).toHaveLength(12);
    expect(store.catalog().size).toBe(12);
    expect(store.catalogHasMore()).toBe(true);
    expect(store.catalogWindow()[0]?.price).toBe(100);

    expect(await store.loadCatalogPage()).toBe('ok');
    expect(store.catalogWindow()).toHaveLength(15);
    expect(store.catalogWindow().at(-1)?.slug).toBe('lot-14');
    expect(store.catalogHasMore()).toBe(false);
    expect(await store.loadCatalogPage()).toBe('end');
  });

  it('ровно страница — конец известен сразу, без пустого запроса', async () => {
    const f = fakeReaders();
    for (let i = 0; i < 12; i++) {
      const slug = `lot-${String(i).padStart(2, '0')}`;
      f.state.catalog.set(slug, lot({ slug, price: 100 + i }));
    }
    const store = createLiveStore(f.readers);
    store.useCatalogPages(12);
    await store.start();

    expect(store.catalogWindow()).toHaveLength(12);
    expect(store.catalogHasMore()).toBe(false);
    expect(f.calls.page).toBe(1);
    expect(await store.loadCatalogPage()).toBe('end');
    expect(f.calls.page).toBe(1);
  });

  it('живой лот: в ценовом диапазоне окна — сразу, дороже границы — ждёт страницы', async () => {
    const f = fakeReaders();
    f.state.catalog.set('lot-a', lot({ slug: 'lot-a', price: 100 }));
    f.state.catalog.set('lot-b', lot({ slug: 'lot-b', price: 200 }));
    f.state.catalog.set('lot-c', lot({ slug: 'lot-c', price: 300 }));
    const store = createLiveStore(f.readers);
    store.useCatalogPages(2);
    await store.start();
    expect(store.catalogWindow().map((st) => st.slug)).toEqual(['lot-a', 'lot-b']);

    f.state.catalog.set('lot-cheap', lot({ slug: 'lot-cheap', price: 150 }));
    await store.reportLotsTick({ eventType: 'INSERT', new: { slug: 'lot-cheap' } });
    expect(store.catalogWindow().map((st) => st.slug)).toEqual(['lot-a', 'lot-cheap', 'lot-b']);

    f.state.catalog.set('lot-expensive', lot({ slug: 'lot-expensive', price: 1000 }));
    await store.reportLotsTick({ eventType: 'INSERT', new: { slug: 'lot-expensive' } });
    expect(store.catalogWindow().map((st) => st.slug)).toEqual(['lot-a', 'lot-cheap', 'lot-b']);

    // Дорогой лот приходит своей страницей, а не живой вставкой.
    await store.loadCatalogPage();
    expect(store.catalogWindow().map((st) => st.slug)).toEqual([
      'lot-a',
      'lot-cheap',
      'lot-b',
      'lot-c',
      'lot-expensive',
    ]);
  });

  it('«Мои приветы» — полный список вне окна; ушедший лот даёт перекуп', async () => {
    const f = fakeReaders();
    f.state.uid = 'u1';
    f.state.balance = 1000;
    f.state.catalog.set(
      'lot-mine',
      lot({ slug: 'lot-mine', price: 900, owner_uid: 'u1', owner_login: 'me', mine: true })
    );
    f.state.catalog.set('lot-a', lot({ slug: 'lot-a', price: 100, owner_uid: 'u2' }));
    const store = createLiveStore(f.readers);
    store.useCatalogPages(1);
    store.trackMyLots();
    const events = collect(store);
    await store.start();

    expect(store.catalogWindow().map((st) => st.slug)).toEqual(['lot-a']);
    expect(store.myLots().map((st) => st.slug)).toEqual(['lot-mine']);
    expect(store.myLotsKnown()).toBe(true);

    // Мой лот перекупили: из списка ушёл, свежая строка — у нового владельца.
    f.state.catalog.set(
      'lot-mine',
      lot({
        slug: 'lot-mine',
        title: 'Мой',
        price: 1200,
        owner_uid: 'u3',
        owner_login: 'carol',
      })
    );
    f.state.lots.set(
      'lot-mine',
      lot({
        slug: 'lot-mine',
        title: 'Мой',
        price: 1200,
        owner_uid: 'u3',
        owner_login: 'carol',
      })
    );
    await store.reportDeal();

    const outbids = events.filter((event) => event.kind === 'outbid');
    expect(outbids).toHaveLength(1);
    expect(outbids[0]).toMatchObject({
      kind: 'outbid',
      event: { slug: 'lot-mine', title: 'Мой', by: 'carol', price: 1200 },
    });
    expect(store.myLots()).toHaveLength(0);
    // Свежая строка — в карте (её найдёт кнопка возврата), но не в окне витрины.
    expect(store.lot('lot-mine')?.owner_login).toBe('carol');
    expect(store.catalogWindow().map((st) => st.slug)).toEqual(['lot-a']);
  });

  it('ensureCatalogLot дочитывает страницы до нужного лота', async () => {
    const f = fakeReaders();
    for (let i = 0; i < 5; i++) {
      const slug = `lot-${i}`;
      const state = lot({ slug, price: 100 + i });
      f.state.catalog.set(slug, state);
      f.state.lots.set(slug, state);
    }
    const store = createLiveStore(f.readers);
    store.useCatalogPages(2);
    await store.start();
    expect(store.catalogWindow()).toHaveLength(2);

    const found = await store.ensureCatalogLot('lot-4');
    expect(found?.slug).toBe('lot-4');
    expect(store.catalogWindow().map((st) => st.slug)).toContain('lot-4');
    expect(await store.ensureCatalogLot('lot-missing')).toBeNull();
  });
});
