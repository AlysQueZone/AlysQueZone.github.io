/**
 * Тесты чистого ядра Колокольчика: история Перекупов, непрочитанное,
 * метка просмотра, дедуп живого события, слияние оффлайн-догона и выкуп
 * обратно. Fake clock и fake storage — без DOM, localStorage и Supabase;
 * шов — docs/adr/0005 (адаптер панели живёт в outbid-notice.ts).
 */
import { describe, expect, it } from 'vitest';
import {
  createOutbidBell,
  outbidEventKey,
  type OutbidBell,
  type OutbidBellStorage,
} from './outbid-bell';
import type { OutbidEvent } from './outbid-event';

/** Событие перекупа; ключ дедупа — slug|price|by. */
function ev(overrides: Partial<OutbidEvent> = {}): OutbidEvent {
  return {
    slug: 'lot-a',
    title: 'Привет A',
    by: 'foxindique',
    price: 880,
    at: 1000,
    video: null,
    ...overrides,
  };
}

interface Harness {
  bell: OutbidBell;
  storage: Map<string, number>;
  setNow(at: number): void;
}

function makeBell(
  options: { maxHistory?: number; dedupeMs?: number; seen?: Record<string, number> } = {}
): Harness {
  const seen = new Map<string, number>(Object.entries(options.seen ?? {}));
  const storage: OutbidBellStorage = {
    readSeen: (uid) => seen.get(uid) ?? 0,
    writeSeen: (uid, at) => {
      seen.set(uid, at);
    },
  };
  let now = 10_000;
  const bell = createOutbidBell({
    storage,
    now: () => now,
    maxHistory: options.maxHistory,
    dedupeMs: options.dedupeMs,
  });
  return {
    bell,
    storage: seen,
    setNow(at: number): void {
      now = at;
    },
  };
}

describe('add', () => {
  it('запись встаёт сверху, unread растёт', () => {
    const { bell } = makeBell();
    expect(bell.add(ev({ slug: 'lot-a' }))).toBe('added');
    expect(bell.add(ev({ slug: 'lot-b', by: 'melkij_strateg' }))).toBe('added');
    expect(bell.snapshot()).toMatchObject({
      unread: 2,
      entries: [{ slug: 'lot-b' }, { slug: 'lot-a' }],
    });
  });

  it('история ограничена 10: старое вытесняется', () => {
    const { bell } = makeBell();
    for (let i = 0; i < 12; i += 1) {
      bell.add(ev({ slug: `lot-${i}`, at: 1000 + i }));
    }
    const { entries, unread } = bell.snapshot();
    expect(entries).toHaveLength(10);
    expect(entries[0]?.slug).toBe('lot-11');
    expect(entries.at(-1)?.slug).toBe('lot-2');
    expect(unread).toBe(12);
  });

  it('тот же ключ внутри 5 с — дубль, без записи и счётчика', () => {
    const { bell } = makeBell();
    bell.add(ev({ at: 1000 }));
    expect(bell.add(ev({ at: 5999 }))).toBe('duplicate');
    expect(bell.snapshot()).toMatchObject({ unread: 1 });
    expect(bell.snapshot().entries).toHaveLength(1);
  });

  it('тот же ключ позже 5 с — настоящий повтор', () => {
    const { bell } = makeBell();
    bell.add(ev({ at: 1000 }));
    expect(bell.add(ev({ at: 6000 }))).toBe('added');
    expect(bell.snapshot()).toMatchObject({ unread: 2 });
    expect(bell.snapshot().entries).toHaveLength(2);
  });

  it('другой ключ при том же Лоте — отдельное событие', () => {
    const { bell } = makeBell();
    bell.add(ev({ at: 1000 }));
    expect(bell.add(ev({ at: 1000, price: 900 }))).toBe('added');
    expect(bell.add(ev({ at: 1000, by: 'melkij_strateg' }))).toBe('added');
    expect(bell.snapshot().entries).toHaveLength(3);
  });

  it('ключ — slug|price|by, остальные поля не участвуют', () => {
    expect(outbidEventKey(ev())).toBe('lot-a|880|foxindique');
    const { bell } = makeBell();
    bell.add(ev({ title: 'Старое название' }));
    expect(bell.add(ev({ title: 'Новое название' }))).toBe('duplicate');
  });
});

describe('merge (оффлайн-догон)', () => {
  it('дедупит против истории и knownKeys, возвращает число добавленных', () => {
    const { bell } = makeBell();
    bell.add(ev({ slug: 'lot-a', at: 3000 }));
    const added = bell.merge(
      [
        ev({ slug: 'lot-a', at: 3000 }), // уже в истории
        ev({ slug: 'lot-b', at: 2000 }), // уже показан окошком
        ev({ slug: 'lot-c', at: 1000 }),
      ],
      [outbidEventKey(ev({ slug: 'lot-b', at: 2000 }))]
    );
    expect(added).toBe(1);
    expect(bell.snapshot().entries.map((entry) => entry.slug)).toEqual(['lot-a', 'lot-c']);
  });

  it('сортирует по времени вниз и режет до лимита', () => {
    const { bell } = makeBell({ maxHistory: 3 });
    bell.add(ev({ slug: 'lot-history', at: 9000 }));
    const found = [500, 7000, 2000, 8000, 1000].map((at, i) => ev({ slug: `lot-${i}`, at }));
    const added = bell.merge(found);
    expect(added).toBe(5);
    expect(bell.snapshot().entries.map((entry) => entry.slug)).toEqual([
      'lot-history',
      'lot-3',
      'lot-1',
    ]);
  });

  it('unread растёт только на события новее seenAt', () => {
    const { bell } = makeBell({ seen: { u1: 3000 } });
    bell.setUid('u1');
    bell.merge([ev({ slug: 'lot-old', at: 1000 }), ev({ slug: 'lot-new', at: 4000 })]);
    const { entries, unread, seenAt } = bell.snapshot();
    expect(seenAt).toBe(3000);
    expect(unread).toBe(1);
    expect(entries.map((entry) => entry.slug)).toEqual(['lot-new', 'lot-old']);
  });

  it('пустой догон и полный дубль ничего не меняют', () => {
    const { bell } = makeBell();
    expect(bell.merge([])).toBe(0);
    bell.add(ev({ slug: 'lot-a' }));
    expect(bell.merge([ev({ slug: 'lot-a' })])).toBe(0);
    expect(bell.snapshot()).toMatchObject({ unread: 1 });
    expect(bell.snapshot().entries).toHaveLength(1);
  });
});

describe('removeBought (выкуп обратно)', () => {
  it('удаляет все записи Лота, возвращает slug и пересчитывает unread', () => {
    const { bell } = makeBell();
    bell.add(ev({ slug: 'lot-a', by: 'foxindique', at: 3000 }));
    bell.add(ev({ slug: 'lot-b', by: 'melkij_strateg', at: 2000 }));
    bell.add(ev({ slug: 'lot-a', by: 'kek', at: 1000 }));
    expect(bell.removeBought('lot-a')).toEqual(['lot-a']);
    expect(bell.snapshot().entries.map((entry) => entry.slug)).toEqual(['lot-b']);
    expect(bell.snapshot().unread).toBe(1);
  });

  it('идемпотентен: повторный выкуп ничего не возвращает', () => {
    const { bell } = makeBell();
    bell.add(ev({ slug: 'lot-a' }));
    expect(bell.removeBought('lot-a')).toEqual(['lot-a']);
    expect(bell.removeBought('lot-a')).toEqual([]);
  });

  it('не съедает непрочитанное другого Лота', () => {
    const { bell } = makeBell();
    bell.add(ev({ slug: 'lot-a', at: 1000 }));
    bell.markSeen(1000);
    bell.add(ev({ slug: 'lot-a', at: 2000, by: 'kek' }));
    bell.add(ev({ slug: 'lot-b', at: 3000 }));
    expect(bell.snapshot().unread).toBe(2);
    bell.removeBought('lot-a');
    // Осталась одна запись новее метки — счётчик пересчитан, а не вычтен.
    expect(bell.snapshot().unread).toBe(1);
  });
});

describe('markSeen', () => {
  it('гасит счётчик, ставит метку и пишет её в хранилище', () => {
    const { bell, storage, setNow } = makeBell();
    bell.setUid('u1');
    bell.add(ev());
    setNow(12_345);
    bell.markSeen();
    expect(bell.snapshot()).toMatchObject({ unread: 0, seenAt: 12_345 });
    expect(bell.snapshot().entries).toHaveLength(1);
    expect(storage.get('u1')).toBe(12_345);
  });

  it('гостю метку не пишет', () => {
    const { bell, storage } = makeBell();
    bell.add(ev());
    bell.markSeen(500);
    expect(bell.snapshot()).toMatchObject({ unread: 0, seenAt: 500 });
    expect(storage.size).toBe(0);
  });
});

describe('setUid', () => {
  it('гость очищает историю и счётчик', () => {
    const { bell } = makeBell();
    bell.setUid('u1');
    bell.add(ev());
    bell.setUid(null);
    expect(bell.snapshot()).toEqual({ entries: [], unread: 0, seenAt: 0 });
  });

  it('залогиненный читает метку просмотра из хранилища', () => {
    const { bell } = makeBell({ seen: { u1: 777 } });
    bell.setUid('u1');
    expect(bell.snapshot().seenAt).toBe(777);
  });

  it('смена uid не смешивает историю и метки', () => {
    const { bell } = makeBell({ seen: { u1: 111, u2: 222 } });
    bell.setUid('u1');
    bell.add(ev());
    bell.setUid('u2');
    expect(bell.snapshot()).toEqual({ entries: [], unread: 0, seenAt: 222 });
  });

  it('повторный тот же uid историю не трогает', () => {
    const { bell } = makeBell();
    bell.setUid('u1');
    bell.add(ev());
    bell.setUid('u1');
    expect(bell.snapshot()).toMatchObject({ unread: 1 });
    expect(bell.snapshot().entries).toHaveLength(1);
  });
});

describe('snapshot', () => {
  it('отдаёт копию: правка снаружи ядро не меняет', () => {
    const { bell } = makeBell();
    bell.add(ev());
    const snap = bell.snapshot();
    (snap.entries as OutbidEvent[]).push(ev({ slug: 'lot-b' }));
    expect(bell.snapshot().entries).toHaveLength(1);
  });
});
