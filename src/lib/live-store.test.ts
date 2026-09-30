/**
 * Тесты снапшота живых данных (кандидат B, этапы 2–3): синхронные чтения,
 * коалесцинг перечитываний, флаг свежести, доменные события из диффа снапшота.
 *
 * Гоняются с fake-readers — без сети, DOM и Supabase; проверяют ровно те
 * швы, из-за которых снапшот вынесен из страниц.
 */
import { describe, expect, it } from 'vitest';
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
  calls: { uid: number; balance: number; catalog: number; lot: number };
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
  const calls = { uid: 0, balance: 0, catalog: 0, lot: 0 };
  const state = {
    uid: null as string | null,
    balance: null as number | null,
    catalog: new Map<string, LotState>(),
    lots: new Map<string, LotState | null>(),
  };
  const fail = { catalog: false, balance: false };
  let gate: Promise<void> | null = null;
  let balanceGate: Promise<void> | null = null;

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
    async readCatalog() {
      const wait = gate;
      if (wait) await wait;
      calls.catalog += 1;
      if (fail.catalog) return { ok: false, states: new Map<string, LotState>() };
      return { ok: true, states: new Map(state.catalog) };
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
  it('start читает снапшот: uid, баланс, каталог — и объявляет их', async () => {
    const f = fakeReaders();
    f.state.uid = 'u1';
    f.state.balance = 1000;
    f.state.catalog.set('lot-a', lot({ mine: true }));
    const store = createLiveStore(f.readers);
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
    const events = collect(store);

    await store.start();

    expect(store.uid()).toBeNull();
    expect(store.balance()).toBeNull();
    expect(f.calls.balance).toBe(0);
    // Гость ничего не объявляет по uid (некому), каталог — объявляется.
    expect(kinds(events)).toEqual(['catalog']);
  });

  it('каталог: добавление, правка и удаление — changed ровно эти slug, стабильные ссылки целы', async () => {
    const f = fakeReaders();
    const keep = lot({ slug: 'lot-keep' });
    f.state.catalog.set('lot-a', lot());
    f.state.catalog.set('lot-b', lot({ slug: 'lot-b' }));
    f.state.catalog.set('lot-keep', keep);
    const store = createLiveStore(f.readers);
    const events = collect(store);
    await store.start();

    const changedA = lot({ price: 150 });
    f.state.catalog = new Map([
      ['lot-a', changedA],
      ['lot-c', lot({ slug: 'lot-c' })],
      ['lot-keep', keep],
    ]);
    await store.refreshCatalog();

    const last = events.at(-1);
    expect(last?.kind).toBe('catalog');
    if (last?.kind !== 'catalog') throw new Error('ожидалось событие каталога');
    expect([...last.changed].sort()).toEqual(['lot-a', 'lot-b', 'lot-c']);
    expect(store.catalog().size).toBe(3);
    expect(store.catalog().get('lot-a')?.price).toBe(150);
    // Неизменившийся лот не пересобирался — ссылка та же.
    expect(store.catalog().get('lot-keep')).toBe(keep);
  });

  it('неудача перечитывания не затирает последнее хорошее, свежесть — false', async () => {
    const f = fakeReaders();
    f.state.catalog.set('lot-a', lot());
    const store = createLiveStore(f.readers);
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
    const events = collect(store);

    await store.start();

    expect(store.catalogOk()).toBe(false);
    expect(events.at(-1)).toMatchObject({ kind: 'catalog', fresh: false });
  });

  it('коалесцинг: триггеры во время чтения дают один догоняющий проход', async () => {
    const f = fakeReaders();
    f.state.catalog.set('lot-a', lot());
    const store = createLiveStore(f.readers);
    await store.start();
    expect(f.calls.catalog).toBe(1);

    const release = f.holdCatalog();
    const first = store.refreshCatalog();
    const second = store.refreshCatalog();
    release();
    await Promise.all([first, second]);

    // Первый тик прочитал, второй не потерялся — догнал одним проходом.
    expect(f.calls.catalog).toBe(3);
  });

  it('смена uid: «мой» флаг пересчитан без чтения каталога, чужой баланс не показывается', async () => {
    const f = fakeReaders();
    f.state.uid = 'u1';
    f.state.balance = 1000;
    f.state.catalog.set('lot-a', lot({ owner_uid: 'u1', mine: true }));
    const store = createLiveStore(f.readers);
    const events = collect(store);
    await store.start();
    const catalogCalls = f.calls.catalog;

    f.state.uid = 'u2';
    f.state.balance = 2000;
    store.applyUid('u2');
    await store.refreshBalance();

    expect(f.calls.catalog).toBe(catalogCalls);
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

    f.fail.balance = false;
    f.state.balance = 700;
    expect(await store.refreshBalance()).toBe(700);
    expect(store.balance()).toBe(700);
  });

  it('refreshLot: одиночная строка сливается с каталогом, исчезнувшая — уходит', async () => {
    const f = fakeReaders();
    f.state.catalog.set('lot-a', lot());
    const store = createLiveStore(f.readers);
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
    await store.start();

    // Гонка: uid сменился, пока каталог был в полёте; ответ несёт флаг старого uid.
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
    const store = createLiveStore(f.readers);
    const events = collect(store);
    await store.start();
    const catalogCalls = f.calls.catalog;

    await store.sync();
    store.reportDeal();

    expect(f.calls.catalog).toBe(catalogCalls + 1);
    expect(kinds(events).at(-2)).toBe('sync');
    expect(kinds(events).at(-1)).toBe('deals');
  });

  it('сломанный подписчик не глушит остальных', async () => {
    const f = fakeReaders();
    f.state.catalog.set('lot-a', lot());
    const store = createLiveStore(f.readers);
    const heard: LiveChange[] = [];
    store.subscribe(() => {
      throw new Error('сломанный подписчик');
    });
    store.subscribe((change) => heard.push(change));

    await store.start();

    expect(heard.length).toBeGreaterThan(0);
  });
});
