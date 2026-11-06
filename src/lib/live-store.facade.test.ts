/**
 * Фасад live-store: старт, подписка, коалесцинг, покупка/сделка и смена uid.
 *
 * Владельцы проверяются своими файлами; здесь — только их склейка: порядок
 * событий, общая дорожка перечитывания и доменные факты от транспорта.
 */
import { describe, expect, it } from 'vitest';
import { createLiveStore } from './live-store';
import { collect, fakeReaders, kinds, lot } from './live-store-test-fixtures';

describe('createLiveStore', () => {
  it('start читает снапшот: uid, баланс, выборку — и объявляет их', async () => {
    const f = fakeReaders();
    f.state.uid = 'u1';
    f.state.balance = 1000;
    f.state.catalog.set('lot-a', lot());
    const store = createLiveStore(f.readers);
    store.useRandomLots(1);
    const events = collect(store);

    await store.start();

    expect(store.uid()).toBe('u1');
    expect(store.balance()).toBe(1000);
    expect(store.balanceKnown()).toBe(true);
    expect(store.catalogMap().get('lot-a')?.price).toBe(100);
    expect(store.catalogOk()).toBe(true);
    expect(kinds(events)).toEqual(['uid', 'balance', 'catalog']);
  });

  it('гость: uid null, баланс не читается, каталог объявляется', async () => {
    const f = fakeReaders();
    f.state.catalog.set('lot-a', lot());
    const store = createLiveStore(f.readers);
    store.useRandomLots(1);
    const events = collect(store);

    await store.start();

    expect(store.uid()).toBeNull();
    expect(store.balance()).toBeNull();
    expect(f.calls.balance).toBe(0);
    expect(kinds(events)).toEqual(['catalog']);
  });

  it('whenUidKnown: гостем — null после старта, ожидающие получают то же', async () => {
    const f = fakeReaders();
    const store = createLiveStore(f.readers);
    const first = store.whenUidKnown();
    const second = store.whenUidKnown();

    await store.start();

    await expect(first).resolves.toBeNull();
    await expect(second).resolves.toBeNull();
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

  it('sync объявляет синк и перечитывает; reportDeal объявляет сделку', async () => {
    const f = fakeReaders();
    f.state.catalog.set('lot-a', lot());
    const store = createLiveStore(f.readers);
    store.useRandomLots(1);
    const events = collect(store);
    await store.start();
    const catalogCalls = f.calls.bySlugs;

    await store.sync();
    await store.reportDeal();

    expect(f.calls.bySlugs).toBe(catalogCalls + 1);
    expect(kinds(events).at(-2)).toBe('sync');
    expect(kinds(events).at(-1)).toBe('deals');
  });

  it('reportDeal: чужая сделка не перечитывает мои лоты, своя и без продавца — да', async () => {
    const f = fakeReaders();
    f.state.uid = 'u1';
    f.state.catalog.set('lot-mine', lot({ slug: 'lot-mine', owner_uid: 'u1' }));
    const store = createLiveStore(f.readers);
    store.useRandomLots(1);
    store.trackMyLots();
    await store.start();
    expect(f.calls.mine).toBe(1);

    await store.reportDeal({ sellerUid: 'u2' });
    expect(f.calls.mine).toBe(1);

    await store.reportDeal({ sellerUid: 'u1' });
    expect(f.calls.mine).toBe(2);

    await store.reportDeal();
    expect(f.calls.mine).toBe(3);
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
    f.state.catalog.set('lot-a', lot({ owner_uid: 'u1', owner_login: 'me', price: 150 }));
    await store.reportPurchase({ slug: 'lot-a', price: 150 });

    expect(
      events.some((event) => event.kind === 'purchase' && event.purchase.slug === 'lot-a')
    ).toBe(true);
    expect(events.some((event) => event.kind === 'outbid')).toBe(false);
    expect(store.balance()).toBe(850);
    expect(store.catalogMap().get('lot-a')?.owner_uid).toBe('u1');
  });

  it('смена uid: чужой баланс уходит, каталог не перечитывается', async () => {
    const f = fakeReaders();
    f.state.uid = 'u1';
    f.state.balance = 1000;
    f.state.catalog.set('lot-a', lot({ owner_uid: 'u1' }));
    const store = createLiveStore(f.readers);
    store.useRandomLots(1);
    await store.start();
    const catalogCalls = f.calls.random + f.calls.bySlugs;

    f.state.uid = 'u2';
    f.state.balance = 2000;
    store.applyUid('u2');
    await store.refreshBalance();

    expect(f.calls.random + f.calls.bySlugs).toBe(catalogCalls);
    expect(store.balance()).toBe(2000);
    expect(store.catalogMap().get('lot-a')?.owner_uid).toBe('u1');
  });

  it('reportLotsTick: вставка в окно витрины приходит доменным фактом', async () => {
    const f = fakeReaders();
    f.state.catalog.set('lot-a', lot({ slug: 'lot-a', price: 100 }));
    f.state.catalog.set('lot-b', lot({ slug: 'lot-b', price: 200 }));
    f.state.catalog.set('lot-c', lot({ slug: 'lot-c', price: 300 }));
    const store = createLiveStore(f.readers);
    store.useCatalogPages(2);
    await store.start();
    expect(store.catalogWindow().map((st) => st.slug)).toEqual(['lot-a', 'lot-b']);

    f.state.catalog.set('lot-cheap', lot({ slug: 'lot-cheap', price: 150 }));
    await store.reportLotsTick({ insertedSlugs: ['lot-cheap'] });
    expect(store.catalogWindow().map((st) => st.slug)).toEqual(['lot-a', 'lot-cheap', 'lot-b']);

    f.state.catalog.set('lot-expensive', lot({ slug: 'lot-expensive', price: 1000 }));
    await store.reportLotsTick({ insertedSlugs: ['lot-expensive'] });
    expect(store.catalogWindow().map((st) => st.slug)).toEqual(['lot-a', 'lot-cheap', 'lot-b']);
  });

  it('колокол на выборке: «Мои приветы» дают перекуп вне окна', async () => {
    const f = fakeReaders();
    f.state.uid = 'u1';
    f.state.balance = 1000;
    f.state.catalog.set(
      'lot-mine',
      lot({ slug: 'lot-mine', price: 900, owner_uid: 'u1', owner_login: 'me' })
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
    // Свежая строка — в карте (её найдёт кнопка возврата), но не в окне.
    expect(store.lot('lot-mine')?.owner_login).toBe('carol');
  });

  it('сломанный подписчик не глушит остальных', async () => {
    const f = fakeReaders();
    f.state.catalog.set('lot-a', lot());
    const store = createLiveStore(f.readers);
    store.useRandomLots(1);
    const heard: string[] = [];
    store.subscribe(() => {
      throw new Error('сломанный подписчик');
    });
    store.subscribe((change) => heard.push(change.kind));

    await store.start();

    expect(heard.length).toBeGreaterThan(0);
  });
});
