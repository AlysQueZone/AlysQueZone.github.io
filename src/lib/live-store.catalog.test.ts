/**
 * Владелец среза каталога: режимы, окно, страницы, вставки, дифф и здоровье.
 *
 * Без DOM и сети: fake-читатели страницы/выборки/по slug и журнал событий.
 * «Мои приветы» живут у сессии; сюда они кладут только свежие строки.
 */
import { describe, expect, it } from 'vitest';
import { createCatalogOwner } from './live-store-catalog';
import { changeLog, fakeReaders, lot } from './live-store-test-fixtures';

function setup() {
  const f = fakeReaders();
  const log = changeLog();
  let uid: string | null = null;
  let started = false;
  const owner = createCatalogOwner({
    readRandomLots: f.readers.readRandomLots,
    readCatalogPage: f.readers.readCatalogPage,
    readCatalogBySlugs: f.readers.readCatalogBySlugs,
    readLot: f.readers.readLot,
    uid: () => uid,
    started: () => started,
    emit: log.emit,
  });
  return {
    f,
    log,
    owner,
    setUid(next: string | null) {
      uid = next;
    },
    markStarted() {
      started = true;
    },
  };
}

describe('createCatalogOwner', () => {
  it('выборка: старт читает N, тик обновляет только окно, новые не вставляются', async () => {
    const { f, owner } = setup();
    for (let i = 0; i < 5; i++) {
      const slug = `lot-${i}`;
      f.state.catalog.set(slug, lot({ slug, price: 100 + i }));
    }
    owner.useRandom(2);
    await owner.readNow();

    expect(f.calls.random).toBe(1);
    expect(owner.window().map((st) => st.slug)).toEqual(['lot-0', 'lot-1']);
    expect(owner.map().size).toBe(2);
    expect(owner.hasMore()).toBe(false);

    const selected = owner.window()[0];
    if (!selected) throw new Error('ожидалась выборка');
    f.state.catalog.set(selected.slug, lot({ slug: selected.slug, price: 999, nextPrice: 1000 }));
    owner.noteInserted([]);
    await owner.readNow();
    expect(f.calls.bySlugs).toBe(1);
    expect(owner.map().get(selected.slug)?.price).toBe(999);
    expect(owner.map().size).toBe(2);

    // Новый лот приходит только следующей загрузкой: выборка стабильна.
    f.state.catalog.set('lot-new', lot({ slug: 'lot-new', price: 50 }));
    owner.noteInserted(['lot-new']);
    await owner.readNow();
    expect(owner.window().map((st) => st.slug)).toEqual(['lot-0', 'lot-1']);
    expect(owner.map().has('lot-new')).toBe(false);
    expect(f.calls.bySlugs).toBe(2);
  });

  it('выборка: правка и удаление — changed ровно эти slug; ссылки стабильны', async () => {
    const { f, log, owner } = setup();
    const keep = lot({ slug: 'lot-keep' });
    f.state.catalog.set('lot-a', lot());
    f.state.catalog.set('lot-b', lot({ slug: 'lot-b' }));
    f.state.catalog.set('lot-keep', keep);
    owner.useRandom(10);
    await owner.readNow();
    expect(owner.window()).toHaveLength(3);

    f.state.catalog = new Map([
      ['lot-a', lot({ price: 150 })],
      ['lot-c', lot({ slug: 'lot-c' })],
      ['lot-keep', keep],
    ]);
    await owner.readNow();

    const last = log.events.at(-1);
    expect(last?.kind).toBe('catalog');
    if (last?.kind !== 'catalog') throw new Error('ожидалось событие каталога');
    expect([...last.changed].sort()).toEqual(['lot-a', 'lot-b']);
    expect(owner.map().size).toBe(2);
    expect(owner.map().get('lot-a')?.price).toBe(150);
    expect(owner.map().get('lot-keep')).toBe(keep);
    expect(owner.map().has('lot-c')).toBe(false);
  });

  it('здоровье: неудача не затирает хорошее, свежесть false; повтор восстанавливает', async () => {
    const { f, log, owner } = setup();
    f.state.catalog.set('lot-a', lot());
    owner.useRandom(1);
    await owner.readNow();
    const good = owner.map().get('lot-a');

    f.fail.catalog = true;
    await owner.readNow();

    expect(owner.ok()).toBe(false);
    expect(owner.map().get('lot-a')).toBe(good);
    expect(log.events.at(-1)).toMatchObject({ kind: 'catalog', fresh: false });

    f.fail.catalog = false;
    await owner.readNow();
    expect(owner.ok()).toBe(true);
    expect(log.events.at(-1)).toMatchObject({ kind: 'catalog', fresh: true });
  });

  it('первый отказ каталога объявляется: пустой снапшот + fresh false', async () => {
    const { f, log, owner } = setup();
    f.fail.catalog = true;
    owner.useRandom(1);

    await owner.readNow();

    expect(owner.known()).toBe(true);
    expect(owner.ok()).toBe(false);
    expect(log.events.at(-1)).toMatchObject({ kind: 'catalog', fresh: false });
  });

  it('страницы: первая — окно, следующая дописывается, дальше конец', async () => {
    const { f, owner } = setup();
    for (let i = 0; i < 15; i++) {
      const slug = `lot-${String(i).padStart(2, '0')}`;
      f.state.catalog.set(slug, lot({ slug, price: 100 + i }));
    }
    owner.usePages(12);
    await owner.readNow();

    expect(owner.window()).toHaveLength(12);
    expect(owner.map().size).toBe(12);
    expect(owner.hasMore()).toBe(true);
    expect(owner.window()[0]?.price).toBe(100);

    expect(await owner.loadPage()).toBe('ok');
    expect(owner.window()).toHaveLength(15);
    expect(owner.window().at(-1)?.slug).toBe('lot-14');
    expect(owner.hasMore()).toBe(false);
    expect(await owner.loadPage()).toBe('end');
  });

  it('ровно страница — конец известен сразу, без пустого запроса', async () => {
    const { f, owner } = setup();
    for (let i = 0; i < 12; i++) {
      const slug = `lot-${String(i).padStart(2, '0')}`;
      f.state.catalog.set(slug, lot({ slug, price: 100 + i }));
    }
    owner.usePages(12);
    await owner.readNow();

    expect(owner.window()).toHaveLength(12);
    expect(owner.hasMore()).toBe(false);
    expect(f.calls.page).toBe(1);
    expect(await owner.loadPage()).toBe('end');
    expect(f.calls.page).toBe(1);
  });

  it('страницы: веерная подгрузка — одна дорожка', async () => {
    const { f, owner } = setup();
    for (let i = 0; i < 15; i++) {
      const slug = `lot-${String(i).padStart(2, '0')}`;
      f.state.catalog.set(slug, lot({ slug, price: 100 + i }));
    }
    owner.usePages(12);
    await owner.readNow();
    expect(f.calls.page).toBe(1);

    const release = f.holdCatalog();
    const first = owner.loadPage();
    const second = owner.loadPage();
    release();
    await Promise.all([first, second]);

    expect(f.calls.page).toBe(2);
    expect(owner.window()).toHaveLength(15);
  });

  it('живой лот: в ценовом диапазоне окна — сразу, дороже границы — ждёт страницы', async () => {
    const { f, owner } = setup();
    f.state.catalog.set('lot-a', lot({ slug: 'lot-a', price: 100 }));
    f.state.catalog.set('lot-b', lot({ slug: 'lot-b', price: 200 }));
    f.state.catalog.set('lot-c', lot({ slug: 'lot-c', price: 300 }));
    owner.usePages(2);
    await owner.readNow();
    expect(owner.window().map((st) => st.slug)).toEqual(['lot-a', 'lot-b']);

    f.state.catalog.set('lot-cheap', lot({ slug: 'lot-cheap', price: 150 }));
    owner.noteInserted(['lot-cheap']);
    await owner.readNow();
    expect(owner.window().map((st) => st.slug)).toEqual(['lot-a', 'lot-cheap', 'lot-b']);

    f.state.catalog.set('lot-expensive', lot({ slug: 'lot-expensive', price: 1000 }));
    owner.noteInserted(['lot-expensive']);
    await owner.readNow();
    expect(owner.window().map((st) => st.slug)).toEqual(['lot-a', 'lot-cheap', 'lot-b']);

    // Дорогой лот приходит своей страницей, а не живой вставкой.
    await owner.loadPage();
    expect(owner.window().map((st) => st.slug)).toEqual([
      'lot-a',
      'lot-cheap',
      'lot-b',
      'lot-c',
      'lot-expensive',
    ]);
  });

  it('один лот: старт и тик читают только его, без полного каталога', async () => {
    const { f, owner } = setup();
    f.state.catalog.set('lot-a', lot({ slug: 'lot-a', price: 100 }));
    f.state.catalog.set('lot-b', lot({ slug: 'lot-b', price: 200 }));
    owner.useLot('lot-a');
    await owner.readNow();

    expect(f.calls.random).toBe(0);
    expect(f.calls.bySlugs).toBe(1);
    expect(owner.window().map((st) => st.slug)).toEqual(['lot-a']);
    expect(owner.map().has('lot-b')).toBe(false);

    f.state.catalog.set('lot-a', lot({ slug: 'lot-a', price: 150 }));
    owner.noteInserted([]);
    await owner.readNow();
    expect(owner.lot('lot-a')?.price).toBe(150);
    expect(f.calls.bySlugs).toBe(2);
  });

  it('один лот: нет строки — «лота нет», отказ БД — «не загрузилось»', async () => {
    const missing = setup();
    missing.owner.useLot('lot-missing');
    await missing.owner.readNow();

    expect(missing.owner.known()).toBe(true);
    expect(missing.owner.ok()).toBe(true);
    expect(missing.owner.lot('lot-missing')).toBeNull();
    expect(missing.owner.window()).toHaveLength(0);

    const broken = setup();
    broken.f.fail.catalog = true;
    broken.owner.useLot('lot-a');
    await broken.owner.readNow();

    expect(broken.owner.known()).toBe(true);
    expect(broken.owner.ok()).toBe(false);
    expect(broken.owner.lot('lot-a')).toBeNull();
  });

  it('выборка не перевыбирается, когда все выбранные лоты удалили', async () => {
    const { f, owner } = setup();
    f.state.catalog.set('lot-a', lot({ slug: 'lot-a', price: 100 }));
    f.state.catalog.set('lot-b', lot({ slug: 'lot-b', price: 200 }));
    owner.useRandom(2);
    await owner.readNow();
    expect(f.calls.random).toBe(1);

    f.state.catalog.clear();
    await owner.readNow();
    expect(owner.window()).toHaveLength(0);
    expect(owner.map().size).toBe(0);
    expect(owner.known()).toBe(true);
    expect(owner.ok()).toBe(true);

    // Выбор один раз за загрузку: ни новая строка, ни повтор не запускают перевыбор.
    await owner.readNow();
    f.state.catalog.set('lot-new', lot({ slug: 'lot-new' }));
    owner.noteInserted(['lot-new']);
    await owner.readNow();
    expect(f.calls.random).toBe(1);
    expect(owner.window()).toHaveLength(0);
    expect(owner.map().has('lot-new')).toBe(false);
  });

  it('удалённый лот страницы не перечитывается на каждом тике', async () => {
    const { f, owner } = setup();
    f.state.catalog.set('lot-a', lot({ slug: 'lot-a' }));
    owner.useLot('lot-a');
    await owner.readNow();
    expect(f.calls.bySlugs).toBe(1);

    f.state.catalog.clear();
    await owner.readNow();
    expect(owner.lot('lot-a')).toBeNull();
    expect(owner.known()).toBe(true);
    expect(owner.ok()).toBe(true);
    expect(f.calls.bySlugs).toBe(2);

    await owner.readNow();
    expect(f.calls.bySlugs).toBe(2);
  });

  it('отказ первого чтения лота повторяется следующим проходом', async () => {
    const { f, owner } = setup();
    f.state.catalog.set('lot-a', lot({ slug: 'lot-a' }));
    f.fail.catalog = true;
    owner.useLot('lot-a');
    await owner.readNow();
    expect(owner.ok()).toBe(false);
    expect(f.calls.bySlugs).toBe(1);

    f.fail.catalog = false;
    await owner.readNow();
    expect(owner.lot('lot-a')).not.toBeNull();
    expect(owner.ok()).toBe(true);
    expect(f.calls.bySlugs).toBe(2);
  });

  it('refreshLot не подменяет здоровье каталога одиночным чтением', async () => {
    const { f, log, owner } = setup();
    f.state.catalog.set('lot-a', lot());
    owner.useRandom(1);
    await owner.readNow();

    f.fail.catalog = true;
    await owner.readNow();
    expect(owner.ok()).toBe(false);

    f.fail.catalog = false;
    f.state.lots.set('lot-a', lot({ price: 120, nextPrice: 130 }));
    await owner.refreshLot('lot-a');
    expect(owner.lot('lot-a')?.price).toBe(120);
    expect(owner.ok()).toBe(false);
    expect(log.events.at(-1)).toMatchObject({ kind: 'catalog', fresh: false });
  });

  it('refreshLot: строка сливается с картой, исчезнувшая — уходит', async () => {
    const { f, owner } = setup();
    f.state.catalog.set('lot-a', lot());
    owner.useRandom(1);
    await owner.readNow();

    f.state.lots.set('lot-a', lot({ price: 120, nextPrice: 130 }));
    f.state.lots.set('lot-b', lot({ slug: 'lot-b' }));
    expect(await owner.refreshLot('lot-a')).toMatchObject({ price: 120 });
    expect(await owner.refreshLot('lot-b')).toMatchObject({ slug: 'lot-b' });
    expect(owner.lot('lot-a')?.nextPrice).toBe(130);
    expect(owner.lot('lot-b')?.slug).toBe('lot-b');

    f.state.lots.set('lot-b', null);
    expect(await owner.refreshLot('lot-b')).toBeNull();
    expect(owner.lot('lot-b')).toBeNull();
  });

  it('refreshLots: цены вне окна дочитываются без перекупа и без правки окна', async () => {
    const { f, log, owner } = setup();
    f.state.catalog.set('lot-a', lot());
    f.state.catalog.set('lot-b', lot({ slug: 'lot-b', price: 200 }));
    f.state.catalog.set('lot-c', lot({ slug: 'lot-c', price: 300 }));
    owner.useRandom(2);
    await owner.readNow();
    expect(owner.window().map((st) => st.slug)).toEqual(['lot-a', 'lot-b']);
    expect(owner.lot('lot-c')).toBeNull();

    f.state.catalog.set(
      'lot-a',
      lot({ price: 400, nextPrice: 440, owner_uid: 'u2', owner_login: 'bob' })
    );
    f.state.catalog.set('lot-c', lot({ slug: 'lot-c', price: 320, nextPrice: 350 }));
    log.events.length = 0;

    await owner.refreshLots(['lot-a', 'lot-c']);

    expect(owner.lot('lot-a')).toMatchObject({ nextPrice: 440, owner_login: 'bob' });
    expect(owner.lot('lot-c')?.nextPrice).toBe(350);
    // Окно витрины не пополнилось и не переехало; перекуп не задвоился.
    expect(owner.window().map((st) => st.slug)).toEqual(['lot-a', 'lot-b']);
    expect(log.events.map((event) => event.kind)).toEqual(['catalog']);
    expect(f.calls.bySlugs).toBe(1);
  });

  it('refreshLots: отказ не выдаёт себя за удаление, повтор дочитывает', async () => {
    const { f, log, owner } = setup();
    f.state.catalog.set('lot-a', lot());
    owner.useRandom(1);
    await owner.readNow();
    const before = owner.lot('lot-a');
    log.events.length = 0;

    f.fail.catalog = true;
    await owner.refreshLots(['lot-a']);
    expect(owner.lot('lot-a')).toBe(before);
    expect(log.events).toEqual([]);

    f.fail.catalog = false;
    f.state.catalog.set('lot-a', lot({ price: 120, nextPrice: 130 }));
    await owner.refreshLots(['lot-a']);
    expect(owner.lot('lot-a')?.nextPrice).toBe(130);
    expect(log.events.map((event) => event.kind)).toEqual(['catalog']);

    // Пустой ответ: лота нет — история решает сама, снапшот не трогаем.
    log.events.length = 0;
    await owner.refreshLots(['lot-gone']);
    expect(owner.lot('lot-gone')).toBeNull();
    expect(owner.lot('lot-a')?.nextPrice).toBe(130);
    expect(log.events).toEqual([]);
  });

  it('смена владельца моего лота — событие перекупа; чужой лот молчит', async () => {
    const { f, log, owner, setUid } = setup();
    setUid('u1');
    f.state.catalog.set('lot-mine', lot({ slug: 'lot-mine', owner_uid: 'u1', owner_login: 'me' }));
    f.state.catalog.set(
      'lot-other',
      lot({ slug: 'lot-other', owner_uid: 'u2', owner_login: 'bob' })
    );
    owner.useRandom(10);
    await owner.readNow();

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
    await owner.readNow();

    const outbids = log.events.filter((event) => event.kind === 'outbid');
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

  it('remember кладёт строки в карту вне окна и не объявляет событий', async () => {
    const { f, log, owner } = setup();
    f.state.catalog.set('lot-a', lot());
    owner.useRandom(1);
    await owner.readNow();
    log.events.length = 0;

    const outside = lot({ slug: 'lot-outside', price: 900, owner_uid: 'u3' });
    owner.remember([outside]);

    expect(owner.lot('lot-outside')).toBe(outside);
    expect(owner.window().map((st) => st.slug)).toEqual(['lot-a']);
    expect(log.events).toEqual([]);
  });

  it('ensureCatalogLot дочитывает страницы до нужного лота', async () => {
    const { f, owner } = setup();
    for (let i = 0; i < 5; i++) {
      const slug = `lot-${i}`;
      const state = lot({ slug, price: 100 + i });
      f.state.catalog.set(slug, state);
      f.state.lots.set(slug, state);
    }
    owner.usePages(2);
    await owner.readNow();
    expect(owner.window()).toHaveLength(2);

    const found = await owner.ensureLot('lot-4');
    expect(found?.slug).toBe('lot-4');
    expect(owner.window().map((st) => st.slug)).toContain('lot-4');
    expect(await owner.ensureLot('lot-missing')).toBeNull();
  });

  it('срез фиксируется до первого чтения, после — no-op', async () => {
    const { f, owner, markStarted } = setup();
    f.state.catalog.set('lot-a', lot());
    markStarted();
    owner.useRandom(1);
    await owner.readNow();
    expect(f.calls.random).toBe(0);
    expect(owner.window()).toHaveLength(0);
  });

  it('срез не меняется после первого ответа каталога', async () => {
    const { f, owner } = setup();
    f.state.catalog.set('lot-a', lot());
    owner.useRandom(1);
    await owner.readNow();
    expect(owner.window()).toHaveLength(1);

    owner.usePages(12);
    expect(await owner.loadPage()).toBe('end');
    expect(f.calls.page).toBe(0);
  });
});
