/**
 * Владелец баланса и Церемонии: чтение, свежесть, дедуп, defer/release.
 *
 * Без DOM и сети: fake-читатель баланса и журнал событий; смена uid — тот же
 * шов, что у сессии, поэтому проверяется здесь.
 */
import { describe, expect, it } from 'vitest';
import { createBalanceOwner } from './live-store-balance';
import { changeLog, fakeReaders } from './live-store-test-fixtures';

function setup() {
  const f = fakeReaders();
  const log = changeLog();
  const owner = createBalanceOwner({ readBalance: f.readers.readBalance, emit: log.emit });
  return { f, log, owner };
}

describe('createBalanceOwner', () => {
  it('чтение: значение, known/fresh и событие', async () => {
    const { f, log, owner } = setup();
    f.state.balance = 1000;
    owner.applyUid('u1');

    expect(owner.value()).toBeNull();
    expect(owner.known()).toBe(false);
    expect(await owner.refresh('u1')).toBe(1000);

    expect(owner.value()).toBe(1000);
    expect(owner.known()).toBe(true);
    expect(owner.fresh()).toBe(true);
    expect(log.events).toEqual([{ kind: 'balance', balance: 1000, fresh: true }]);
  });

  it('первый отказ — честный прочерк, дальше последнее хорошее не затирается', async () => {
    const { f, log, owner } = setup();
    f.state.uid = 'u1';
    owner.applyUid('u1');
    f.fail.balance = true;

    expect(await owner.refresh('u1')).toBeNull();
    expect(owner.value()).toBeNull();
    expect(owner.known()).toBe(true);
    expect(owner.fresh()).toBe(false);
    expect(log.events).toEqual([{ kind: 'balance', balance: null, fresh: false }]);

    f.fail.balance = false;
    f.state.balance = 700;
    expect(await owner.refresh('u1')).toBe(700);
    expect(owner.value()).toBe(700);
    expect(owner.fresh()).toBe(true);

    log.events.length = 0;
    f.fail.balance = true;
    expect(await owner.refresh('u1')).toBeNull();
    expect(owner.value()).toBe(700);
    expect(owner.fresh()).toBe(false);
    // Повторный null не выдаёт «пусто» за новое значение.
    expect(log.events).toEqual([]);
  });

  it('дедуп: явная свежесть и тик делят одно чтение на uid', async () => {
    const { f, owner } = setup();
    f.state.balance = 1000;
    owner.applyUid('u1');
    const release = f.holdBalance();

    const first = owner.refresh('u1');
    const second = owner.refresh('u1');
    release();
    await Promise.all([first, second]);

    expect(f.calls.balance).toBe(1);
    expect(owner.value()).toBe(1000);
  });

  it('смена uid во время чтения: чужой ответ не подхватывается', async () => {
    const { f, owner } = setup();
    f.state.balance = 1000;
    owner.applyUid('u1');
    const release = f.holdBalance();
    const pending = owner.refresh('u1');

    f.state.balance = 2000;
    owner.applyUid('u2');
    release();

    await expect(pending).resolves.toBeNull();
    expect(owner.value()).toBeNull();
    expect(owner.known()).toBe(false);
  });

  it('смена uid сбрасывает баланс и свежесть; пустой — без события', async () => {
    const { f, log, owner } = setup();
    f.state.balance = 1000;
    owner.applyUid('u1');
    await owner.refresh('u1');
    log.events.length = 0;

    owner.applyUid('u2');

    expect(owner.value()).toBeNull();
    expect(owner.known()).toBe(false);
    expect(owner.fresh()).toBe(false);
    expect(log.events).toEqual([{ kind: 'balance', balance: null, fresh: false }]);

    log.events.length = 0;
    owner.applyUid('u3');
    expect(log.events).toEqual([]);
  });

  it('церемония держит значения и раскрывает последнее', async () => {
    const { f, log, owner } = setup();
    f.state.balance = 1000;
    owner.applyUid('u1');
    await owner.refresh('u1');
    const before = log.events.length;

    const release = owner.defer();
    owner.report(900);
    owner.report(950);

    expect(owner.value()).toBe(1000);
    expect(log.events).toHaveLength(before);

    release();

    expect(owner.value()).toBe(950);
    expect(log.events).toHaveLength(before + 1);
    expect(log.events.at(-1)).toMatchObject({ kind: 'balance', balance: 950, fresh: true });
  });

  it('release идемпотентен: повторный вызов ничего не раскрывает', async () => {
    const { f, log, owner } = setup();
    f.state.balance = 1000;
    owner.applyUid('u1');
    await owner.refresh('u1');
    const before = log.events.length;

    const release = owner.defer();
    owner.report(900);
    release();
    release();

    expect(log.events).toHaveLength(before + 1);
    expect(owner.value()).toBe(900);
  });

  it('refresh под удержанием: гейт получает свежее, снапшот — нет', async () => {
    const { f, owner } = setup();
    f.state.balance = 1000;
    owner.applyUid('u1');
    await owner.refresh('u1');

    const release = owner.defer();
    f.fail.balance = true;
    expect(await owner.refresh('u1')).toBeNull();
    f.fail.balance = false;
    f.state.balance = 700;
    expect(await owner.refresh('u1')).toBe(700);
    expect(owner.value()).toBe(1000); // придержано

    release();
    expect(owner.value()).toBe(700);
  });

  it('смена uid под церемонией: значение прежнего uid не раскрывается', async () => {
    const { f, owner } = setup();
    f.state.balance = 1000;
    owner.applyUid('u1');
    await owner.refresh('u1');

    const release = owner.defer();
    owner.report(900);
    owner.applyUid('u2');
    release();

    expect(owner.value()).toBeNull();
  });

  it('reportBalance игнорирует нечисло и отрицательное', () => {
    const { log, owner } = setup();
    owner.report(Number.NaN);
    owner.report(-1);
    expect(owner.value()).toBeNull();
    expect(log.events).toEqual([]);
  });
});
