/**
 * Владелец сессии и «Моих приветов»: unknown → guest/user, первое ожидание,
 * полный список владельца, чужой ответ после смены uid.
 *
 * Без DOM и сети: fake-читатель uid/списка/одного Лота; сброс списка фасад
 * ставит отдельно, поэтому здесь он проверяется явно.
 */
import { describe, expect, it } from 'vitest';
import { createSessionOwner } from './live-store-session';
import { changeLog, fakeReaders, lot } from './live-store-test-fixtures';

function setup() {
  const f = fakeReaders();
  const log = changeLog();
  const remembered: ReturnType<typeof lot>[] = [];
  const owner = createSessionOwner({
    readUid: f.readers.readUid,
    readMyLots: f.readers.readMyLots,
    readLot: f.readers.readLot,
    emit: log.emit,
    rememberCatalog: (states) => remembered.push(...states),
  });
  return { f, log, remembered, owner };
}

describe('createSessionOwner', () => {
  it('unknown: ожидание первого uid резолвится гостем без события uid', async () => {
    const { log, owner } = setup();
    const pending = owner.whenUidKnown();
    let settled = false;
    void pending.then(() => {
      settled = true;
    });

    expect(owner.state()).toBe('unknown');
    expect(owner.uidKnown()).toBe(false);
    expect(settled).toBe(false);

    expect(owner.applyUid(null)).toBe(false);
    await expect(pending).resolves.toBeNull();

    expect(owner.state()).toBe('guest');
    expect(owner.uidKnown()).toBe(true);
    expect(log.events).toEqual([]);
  });

  it('user: uid, состояние и событие; повтор того же uid — без события', () => {
    const { log, owner } = setup();

    expect(owner.applyUid('u1')).toBe(true);
    expect(owner.uid()).toBe('u1');
    expect(owner.state()).toBe('user');
    expect(log.events).toEqual([{ kind: 'uid', uid: 'u1' }]);

    expect(owner.applyUid('u1')).toBe(false);
    expect(log.events).toHaveLength(1);
  });

  it('whenUidKnown: все ожидающие получают одно значение, прочитанное — сразу', async () => {
    const { owner } = setup();
    const first = owner.whenUidKnown();
    const second = owner.whenUidKnown();
    owner.applyUid('u1');

    await expect(first).resolves.toBe('u1');
    await expect(second).resolves.toBe('u1');
    await expect(owner.whenUidKnown()).resolves.toBe('u1');
  });

  it('trackMyLots читает полный список владельца вне окна', async () => {
    const { f, log, owner } = setup();
    f.state.uid = 'u1';
    f.state.catalog.set(
      'lot-mine',
      lot({ slug: 'lot-mine', price: 900, owner_uid: 'u1', owner_login: 'me' })
    );
    f.state.catalog.set('lot-other', lot({ slug: 'lot-other', owner_uid: 'u2' }));
    owner.applyUid('u1');
    log.events.length = 0;

    owner.trackMyLots();
    await owner.readMyLots('u1');

    expect(owner.myLots().map((st) => st.slug)).toEqual(['lot-mine']);
    expect(owner.myLotsKnown()).toBe(true);
    expect(owner.myLotsTracked()).toBe(true);
    expect(log.events).toEqual([{ kind: 'myLots', changed: new Set(['lot-mine']) }]);
  });

  it('дедуп списка: повтор без force не читает; force и веер — одна дорожка', async () => {
    const { f, owner } = setup();
    f.state.uid = 'u1';
    f.state.catalog.set('lot-mine', lot({ slug: 'lot-mine', owner_uid: 'u1' }));
    owner.applyUid('u1');
    owner.trackMyLots();
    await owner.readMyLots('u1');
    expect(f.calls.mine).toBe(1);

    await owner.readMyLots('u1');
    expect(f.calls.mine).toBe(1);

    const release = f.holdMyLots();
    const first = owner.readMyLots('u1', true);
    const second = owner.readMyLots('u1', true);
    release();
    await Promise.all([first, second]);
    expect(f.calls.mine).toBe(2);
  });

  it('чужой ответ после смены uid не подхватывается', async () => {
    const { f, owner } = setup();
    f.state.uid = 'u1';
    f.state.catalog.set('lot-mine', lot({ slug: 'lot-mine', owner_uid: 'u1' }));
    owner.applyUid('u1');
    owner.trackMyLots();
    await owner.readMyLots('u1');

    const release = f.holdMyLots();
    const pending = owner.readMyLots('u1', true);
    owner.applyUid('u2');
    owner.resetMyLots();
    release();
    await pending;

    expect(owner.myLots()).toHaveLength(0);
    expect(owner.myLotsKnown()).toBe(false);
  });

  it('ушедший лот: событие перекупа и свежая строка в карту каталога', async () => {
    const { f, log, remembered, owner } = setup();
    f.state.uid = 'u1';
    f.state.catalog.set(
      'lot-mine',
      lot({ slug: 'lot-mine', price: 900, owner_uid: 'u1', owner_login: 'me' })
    );
    owner.applyUid('u1');
    owner.trackMyLots();
    await owner.readMyLots('u1');
    log.events.length = 0;

    const sold = lot({
      slug: 'lot-mine',
      title: 'Мой',
      price: 1200,
      owner_uid: 'u3',
      owner_login: 'carol',
    });
    f.state.catalog.set('lot-mine', sold);
    f.state.lots.set('lot-mine', sold);
    await owner.readMyLots('u1', true);

    expect(owner.myLots()).toHaveLength(0);
    expect(remembered).toEqual([sold]);
    expect(log.events.map((event) => event.kind)).toEqual(['myLots', 'outbid']);
    expect(log.events[1]).toMatchObject({
      kind: 'outbid',
      event: { slug: 'lot-mine', title: 'Мой', by: 'carol', price: 1200 },
    });
  });

  it('resetMyLots очищает список и объявляет ушедшие slug', async () => {
    const { f, log, owner } = setup();
    f.state.uid = 'u1';
    f.state.catalog.set('lot-mine', lot({ slug: 'lot-mine', owner_uid: 'u1' }));
    owner.applyUid('u1');
    owner.trackMyLots();
    await owner.readMyLots('u1');
    log.events.length = 0;

    owner.resetMyLots();

    expect(owner.myLots()).toHaveLength(0);
    expect(owner.myLotsKnown()).toBe(false);
    expect(log.events).toEqual([{ kind: 'myLots', changed: new Set(['lot-mine']) }]);
  });

  it('readUidSafe: отказ читателя оставляет текущий uid', async () => {
    const f = fakeReaders();
    const owner = createSessionOwner({
      readUid: async () => {
        throw new Error('нет сессии');
      },
      readMyLots: f.readers.readMyLots,
      readLot: f.readers.readLot,
      emit: () => {},
      rememberCatalog: () => {},
    });
    owner.applyUid('u1');
    await expect(owner.readUidSafe()).resolves.toBe('u1');
  });

  it('trackMyLots до uid только включает флаг, без чтения', () => {
    const { f, owner } = setup();
    owner.trackMyLots();
    expect(owner.myLotsTracked()).toBe(true);
    expect(f.calls.mine).toBe(0);
  });
});
