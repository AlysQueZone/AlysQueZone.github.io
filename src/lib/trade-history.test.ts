/**
 * Тесты чистого ядра чтения сделок: строки `purchases` превращаются в записи
 * «Истории перепродаж» и «Лога сделок», в дни лога и в события
 * оффлайн-догона Колокольчика; здесь же курсор, слияние и дописывание.
 *
 * Шов один (чистое ядро — как у соседей, docs/adr/0003; канон живой
 * математики — docs/agents/economy.md): ни БД, ни DOM — строки на входе, то,
 * что видит чатерс, на выходе.
 */
import { describe, expect, it } from 'vitest';
import {
  appendHistory,
  dealEntries,
  formatRelativeTime,
  groupDealDays,
  historyCursor,
  historyEntries,
  mergeHistory,
  outbidCatchup,
  PURCHASE_SELLER_FALLBACK,
  type DealEntry,
  type HistoryEntry,
  type TradeRow,
} from './trade-history';

/** Строка `purchases` с соединённым лотом — как её отдаёт PostgREST. */
function purchase(overrides: Partial<TradeRow> = {}): TradeRow {
  return {
    id: 1,
    seller_uid: 'author-uid',
    seller_login: 'melkij_strateg',
    buyer_uid: 'buyer-uid',
    buyer_login: 'foxindique',
    price_paid: 880,
    created_at: '2026-10-13T12:00:00.000Z',
    lots: { slug: 'lot-a', title: 'Привет', video_url: null, owner_uid: 'buyer-uid' },
    ...overrides,
  };
}

/** Запись истории напрямую — для тестов курсора, слияния и времени. */
function entry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: 1,
    from: 'author',
    to: 'buyer',
    price: 880,
    buyer_uid: 'buyer-uid',
    created_at: '2026-10-13T12:00:00.000Z',
    ...overrides,
  };
}

/** Соединённый лот внутри строки сделки. */
function lot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { slug: 'lot-a', title: 'Привет', video_url: null, owner_uid: 'someone', ...overrides };
}

describe('historyEntries', () => {
  it('лот из заявки: в первой строке продавец — автор привета', () => {
    const entries = historyEntries([purchase({ seller_login: 'melkij_strateg' })]);
    expect(entries).toEqual([
      {
        id: 1,
        from: 'melkij_strateg',
        to: 'foxindique',
        price: 880,
        buyer_uid: 'buyer-uid',
        created_at: '2026-10-13T12:00:00.000Z',
      },
    ]);
  });

  it('ничейный лот: пустой продавец — «Биржа», а не пустая строка', () => {
    const entries = historyEntries([purchase({ seller_uid: null, seller_login: null })]);
    expect(entries[0]?.from).toBe(PURCHASE_SELLER_FALLBACK);
    expect(PURCHASE_SELLER_FALLBACK).toBe('Биржа');
  });

  it('пустая история — пустой список', () => {
    expect(historyEntries([])).toEqual([]);
  });

  it('uid покупателя сохранён — по нему рисуется пометка «ТВОЙ»', () => {
    const entries = historyEntries([purchase({ buyer_uid: 'me' })]);
    expect(entries[0]?.buyer_uid).toBe('me');
  });

  it('порядок входа сохраняется (не сортируем)', () => {
    const entries = historyEntries([
      purchase({ id: 1, created_at: '2026-10-13T12:00:00.000Z', seller_login: 'author' }),
      purchase({ id: 2, created_at: '2026-10-14T12:00:00.000Z', seller_login: 'foxindique' }),
    ]);
    expect(entries.map((entry) => entry.from)).toEqual(['author', 'foxindique']);
  });

  it('id строки сохранён — по нему дедуп и курсор', () => {
    const entries = historyEntries([purchase({ id: 42 })]);
    expect(entries[0]?.id).toBe(42);
  });

  it('битые строки отбрасываются, остальные остаются', () => {
    const entries = historyEntries([
      purchase({ id: 1 }),
      purchase({ id: 2, buyer_login: null }),
      purchase({ id: 3, buyer_login: '' }),
      purchase({ id: 4, price_paid: 'нет' }),
      purchase({ id: 5, price_paid: 0 }),
      purchase({ id: 6 }),
    ]);
    expect(entries).toHaveLength(2);
  });

  it('без id или без времени запись не годится (курсор и показ времени)', () => {
    const entries = historyEntries([
      purchase({ id: null }),
      purchase({ id: 0 }),
      purchase({ id: 'нет' }),
      purchase({ created_at: null }),
      purchase({ created_at: 'не дата' }),
      purchase({ id: 7 }),
    ]);
    expect(entries.map((entry) => entry.id)).toEqual([7]);
  });
});

describe('historyCursor', () => {
  it('пустая история — курсора нет', () => {
    expect(historyCursor([])).toBeNull();
  });

  it('одна запись — курсор по ней', () => {
    expect(historyCursor([entry({ id: 5, created_at: '2026-10-13T12:00:00.000Z' })])).toEqual({
      created_at: '2026-10-13T12:00:00.000Z',
      id: 5,
    });
  });

  it('несколько записей — курсор по самой старой (последней)', () => {
    const cursor = historyCursor([
      entry({ id: 3, created_at: '2026-10-14T12:00:00.000Z' }),
      entry({ id: 2, created_at: '2026-10-13T12:00:00.000Z' }),
      entry({ id: 1, created_at: '2026-10-12T12:00:00.000Z' }),
    ]);
    expect(cursor).toEqual({ created_at: '2026-10-12T12:00:00.000Z', id: 1 });
  });

  it('запись без времени курсором не становится', () => {
    expect(historyCursor([entry({ created_at: '' })])).toBeNull();
  });

  it('одинаковое время у соседей: id разводит границу страницы', () => {
    const cursor = historyCursor([
      entry({ id: 9, created_at: '2026-10-13T12:00:00.000Z' }),
      entry({ id: 8, created_at: '2026-10-13T12:00:00.000Z' }),
    ]);
    expect(cursor).toEqual({ created_at: '2026-10-13T12:00:00.000Z', id: 8 });
  });
});

describe('mergeHistory', () => {
  const shown = [
    entry({ id: 5, created_at: '2026-10-14T12:00:00.000Z' }),
    entry({ id: 4, created_at: '2026-10-13T12:00:00.000Z' }),
  ];

  it('новая страница встаёт сверху, дубли по id отсекаются', () => {
    const merged = mergeHistory(shown, [
      entry({ id: 7, created_at: '2026-10-16T12:00:00.000Z' }),
      entry({ id: 6, created_at: '2026-10-15T12:00:00.000Z' }),
      entry({ id: 5, created_at: '2026-10-14T12:00:00.000Z' }),
    ]);
    expect(merged.map((e) => e.id)).toEqual([7, 6, 5, 4]);
  });

  it('пустая свежая страница ничего не меняет', () => {
    expect(mergeHistory(shown, [])).toEqual(shown);
  });

  it('свежая страница без новых записей — показанное остаётся как есть', () => {
    expect(mergeHistory(shown, [entry({ id: 5 })])).toEqual(shown);
  });

  it('сливаются только id: пролистанное не сбрасывается', () => {
    const merged = mergeHistory(shown, [entry({ id: 4 }), entry({ id: 5 })]);
    expect(merged).toHaveLength(2);
    expect(merged.map((e) => e.id)).toEqual([5, 4]);
  });
});

describe('appendHistory', () => {
  const shown = [
    entry({ id: 5, created_at: '2026-10-14T12:00:00.000Z' }),
    entry({ id: 4, created_at: '2026-10-13T12:00:00.000Z' }),
  ];

  it('следующая страница дописывается снизу — список не прыгает', () => {
    const appended = appendHistory(shown, [
      entry({ id: 3, created_at: '2026-10-12T12:00:00.000Z' }),
      entry({ id: 2, created_at: '2026-10-11T12:00:00.000Z' }),
    ]);
    expect(appended.map((e) => e.id)).toEqual([5, 4, 3, 2]);
  });

  it('дубли (живой перекуп успел приклеить те же сделки) отсекаются', () => {
    const appended = appendHistory(shown, [entry({ id: 4 }), entry({ id: 3 })]);
    expect(appended.map((e) => e.id)).toEqual([5, 4, 3]);
  });

  it('пустая страница ничего не меняет', () => {
    expect(appendHistory(shown, [])).toEqual(shown);
  });
});

describe('лог сделок: курсор, слияние и дописывание', () => {
  const sameTime = '2026-11-04T10:00:00.000Z';

  it('курсор по записям лога: id разводит одинаковое время соседей', () => {
    expect(
      historyCursor([
        deal({ id: 12, created_at: sameTime }),
        deal({ id: 11, created_at: sameTime }),
      ])
    ).toEqual({ created_at: sameTime, id: 11 });
  });

  it('следующая страница с одинаковым временем соседей не теряет и не дублирует строки', () => {
    const shown = [deal({ id: 12, created_at: sameTime }), deal({ id: 11, created_at: sameTime })];
    const appended = appendHistory(shown, [
      deal({ id: 11, created_at: sameTime }),
      deal({ id: 10, created_at: sameTime }),
      deal({ id: 9, created_at: sameTime }),
    ]);
    expect(appended.map((entry) => entry.id)).toEqual([12, 11, 10, 9]);
    expect(new Set(appended.map((entry) => entry.id)).size).toBe(4);
  });

  it('свежая страница встаёт сверху без дублей, пролистанное остаётся', () => {
    const shown = [deal({ id: 10 }), deal({ id: 9 }), deal({ id: 8 })];
    const merged = mergeHistory(shown, [deal({ id: 12 }), deal({ id: 11 }), deal({ id: 10 })]);
    expect(merged.map((entry) => entry.id)).toEqual([12, 11, 10, 9, 8]);
  });

  it('пустая свежая страница лога ничего не меняет', () => {
    const shown = [deal({ id: 10 }), deal({ id: 9 })];
    expect(mergeHistory(shown, [])).toEqual(shown);
  });

  it('пустая следующая страница не сдвигает показанное', () => {
    const shown = [deal({ id: 10 }), deal({ id: 9 })];
    expect(appendHistory(shown, [])).toEqual(shown);
  });
});

describe('formatRelativeTime', () => {
  const now = Date.parse('2026-10-16T12:00:00.000Z');
  const ago = (seconds: number): string => new Date(now - seconds * 1000).toISOString();

  it('меньше минуты — «только что»', () => {
    expect(formatRelativeTime(ago(0), now)).toBe('только что');
    expect(formatRelativeTime(ago(59), now)).toBe('только что');
  });

  it('меньше часа — минуты', () => {
    expect(formatRelativeTime(ago(60), now)).toBe('1 мин назад');
    expect(formatRelativeTime(ago(59 * 60), now)).toBe('59 мин назад');
  });

  it('меньше суток — часы', () => {
    expect(formatRelativeTime(ago(60 * 60), now)).toBe('1 ч назад');
    expect(formatRelativeTime(ago(23 * 60 * 60), now)).toBe('23 ч назад');
  });

  it('ровно сутки — «вчера»', () => {
    expect(formatRelativeTime(ago(24 * 60 * 60), now)).toBe('вчера');
    expect(formatRelativeTime(ago(36 * 60 * 60), now)).toBe('вчера');
  });

  it('до недели — дни', () => {
    expect(formatRelativeTime(ago(2 * 24 * 60 * 60), now)).toBe('2 дн назад');
    expect(formatRelativeTime(ago(6 * 24 * 60 * 60), now)).toBe('6 дн назад');
  });

  it('неделя и дальше — короткая дата (локальная зона)', () => {
    // Дата строится из локальных компонентов: «9 окт» в любой зоне.
    const at = new Date(2026, 9, 9, 12, 0, 0);
    const later = at.getTime() + 8 * 24 * 60 * 60 * 1000;
    expect(formatRelativeTime(at.toISOString(), later)).toBe('9 окт');
  });

  it('будущее время — «только что», битая дата — пусто', () => {
    expect(formatRelativeTime(new Date(now + 60_000).toISOString(), now)).toBe('только что');
    expect(formatRelativeTime('не дата', now)).toBe('');
  });
});

describe('outbidCatchup', () => {
  const me = 'uid-me';
  const mine = (overrides: Partial<TradeRow> = {}): TradeRow =>
    purchase({ seller_uid: me, seller_login: 'me', ...overrides });

  it('только мои продажи: чужие сделки мимо', () => {
    const events = outbidCatchup(
      [
        mine({ lots: lot({ slug: 'mine' }) }),
        purchase({ seller_uid: 'other', lots: lot({ slug: 'not-mine' }) }),
      ],
      me,
      10
    );
    expect(events.map((event) => event.slug)).toEqual(['mine']);
  });

  it('свежие события первыми', () => {
    const events = outbidCatchup(
      [
        mine({ created_at: '2026-10-13T12:00:00.000Z', lots: lot({ slug: 'old' }) }),
        mine({ created_at: '2026-10-15T12:00:00.000Z', lots: lot({ slug: 'new' }) }),
      ],
      me,
      10
    );
    expect(events.map((event) => event.slug)).toEqual(['new', 'old']);
  });

  it('лимит ограничивает число событий (самые свежие)', () => {
    const events = outbidCatchup(
      [
        mine({ created_at: '2026-10-13T12:00:00.000Z', lots: lot({ slug: 'a' }) }),
        mine({ created_at: '2026-10-14T12:00:00.000Z', lots: lot({ slug: 'b' }) }),
        mine({ created_at: '2026-10-15T12:00:00.000Z', lots: lot({ slug: 'c' }) }),
      ],
      me,
      2
    );
    expect(events.map((event) => event.slug)).toEqual(['c', 'b']);
  });

  it('лот, которым я владею сейчас, не попадает в догон', () => {
    const events = outbidCatchup(
      [mine({ lots: lot({ slug: 'bought-back', owner_uid: me }) })],
      me,
      10
    );
    expect(events).toEqual([]);
  });

  it('ничейный лот: продавца не было, но продажа моя — событие остаётся', () => {
    const events = outbidCatchup(
      [mine({ lots: lot({ slug: 'ownerless', owner_uid: null }) })],
      me,
      10
    );
    expect(events.map((event) => event.slug)).toEqual(['ownerless']);
  });

  it('выкупленный обратно лот среди свежих не съедает лимит', () => {
    const events = outbidCatchup(
      [
        mine({ created_at: '2026-10-15T12:00:00.000Z', lots: lot({ owner_uid: me }) }),
        mine({ created_at: '2026-10-14T12:00:00.000Z', lots: lot({ slug: 'b' }) }),
        mine({ created_at: '2026-10-13T12:00:00.000Z', lots: lot({ slug: 'a' }) }),
      ],
      me,
      2
    );
    expect(events.map((event) => event.slug)).toEqual(['b', 'a']);
  });

  it('лимит <= 0 — пусто', () => {
    expect(outbidCatchup([mine({ lots: lot({ slug: 'x' }) })], me, 0)).toEqual([]);
    expect(outbidCatchup([mine({ lots: lot({ slug: 'x' }) })], me, -3)).toEqual([]);
  });

  it('покупатель и время берутся из строки (форма LiveOutbid)', () => {
    const events = outbidCatchup(
      [
        mine({
          buyer_login: 'carol',
          price_paid: 150,
          created_at: '2026-10-14T10:00:00.000Z',
          lots: lot({
            slug: 'lot-x',
            title: 'Привет X',
            video_url: 'https://media/x.mp4',
            owner_uid: 'carol',
          }),
        }),
      ],
      me,
      10
    );
    expect(events).toEqual([
      {
        slug: 'lot-x',
        title: 'Привет X',
        by: 'carol',
        price: 150,
        at: Date.parse('2026-10-14T10:00:00.000Z'),
        video: 'https://media/x.mp4',
      },
    ]);
  });

  it('покупатель без ника — «Чатерс»; без названия — slug', () => {
    const events = outbidCatchup(
      [mine({ buyer_login: null, lots: lot({ slug: 'lot-y', title: '' }) })],
      me,
      10
    );
    expect(events[0]?.by).toBe('Чатерс');
    expect(events[0]?.title).toBe('lot-y');
  });

  it('битые строки (нет лота, битая цена/время) отбрасываются', () => {
    const events = outbidCatchup(
      [
        mine({ lots: null }),
        mine({ price_paid: 'нет' }),
        mine({ created_at: 'не дата' }),
        mine({ lots: lot({ slug: 'ok' }) }),
      ],
      me,
      10
    );
    expect(events.map((event) => event.slug)).toEqual(['ok']);
  });
});

/** Запись лога напрямую — для тестов группировки по дням. */
function deal(overrides: Partial<DealEntry> = {}): DealEntry {
  return {
    id: 1,
    slug: 'lot-a',
    title: 'Привет',
    seller: 'author',
    buyer: 'buyer',
    buyer_uid: 'buyer-uid',
    price: 880,
    created_at: '2026-10-13T12:00:00.000Z',
    video_url: null,
    ...overrides,
  };
}

/** Локальная дата как ISO — сутки считаются в зоне браузера, не в UTC. */
function localIso(
  year: number,
  month: number,
  day: number,
  hours = 12,
  minutes = 0,
  seconds = 0,
  ms = 0
): string {
  return new Date(year, month - 1, day, hours, minutes, seconds, ms).toISOString();
}

describe('dealEntries', () => {
  it('строка purchases + лот превращается в запись лога', () => {
    const entries = dealEntries([
      purchase({
        id: 7,
        seller_login: 'melkij_strateg',
        buyer_login: 'foxindique',
        buyer_uid: 'buyer-uid',
        price_paid: 990,
        created_at: '2026-11-04T10:00:00.000Z',
        lots: lot({ slug: 'privet', title: 'Привет с дачи', video_url: 'https://media/a.webm' }),
      }),
    ]);
    expect(entries).toEqual([
      {
        id: 7,
        slug: 'privet',
        title: 'Привет с дачи',
        seller: 'melkij_strateg',
        buyer: 'foxindique',
        buyer_uid: 'buyer-uid',
        price: 990,
        created_at: '2026-11-04T10:00:00.000Z',
        video_url: 'https://media/a.webm',
      },
    ]);
  });

  it('пустой продавец — «Биржа», а не пустая строка', () => {
    const entries = dealEntries([purchase({ seller_login: null })]);
    expect(entries[0]?.seller).toBe(PURCHASE_SELLER_FALLBACK);
  });

  it('лот без названия — запись остаётся с slug вместо названия', () => {
    const entries = dealEntries([purchase({ lots: lot({ slug: 'bez-nazvaniya', title: '' }) })]);
    expect(entries[0]?.title).toBe('bez-nazvaniya');
  });

  it('битые строки отбрасываются: нет id, времени, цены, покупателя, лота или slug', () => {
    const entries = dealEntries([
      purchase({ id: 1 }),
      purchase({ id: null }),
      purchase({ id: 2, created_at: null }),
      purchase({ id: 3, created_at: 'не дата' }),
      purchase({ id: 4, price_paid: 0 }),
      purchase({ id: 5, price_paid: 'нет' }),
      purchase({ id: 6, buyer_login: null }),
      purchase({ id: 7, buyer_login: '' }),
      purchase({ id: 8, lots: null }),
      purchase({ id: 9, lots: lot({ slug: '' }) }),
      purchase({ id: 10, lots: [] }),
    ]);
    expect(entries.map((entry) => entry.id)).toEqual([1]);
  });

  it('порядок входа сохраняется (новые сверху — от запроса)', () => {
    const entries = dealEntries([
      purchase({ id: 3, lots: lot({ slug: 'new' }) }),
      purchase({ id: 2, lots: lot({ slug: 'mid' }) }),
      purchase({ id: 1, lots: lot({ slug: 'old' }) }),
    ]);
    expect(entries.map((entry) => entry.slug)).toEqual(['new', 'mid', 'old']);
  });

  it('пустой вход — пустой лог', () => {
    expect(dealEntries([])).toEqual([]);
  });
});

describe('groupDealDays', () => {
  const now = new Date(2026, 10, 4, 10, 0, 0).getTime();

  it('«Сегодня», «Вчера», дата; год — только у другого года', () => {
    const days = groupDealDays(
      [
        deal({ id: 3, created_at: localIso(2026, 11, 4, 9) }),
        deal({ id: 2, created_at: localIso(2026, 11, 3, 23, 30) }),
        deal({ id: 1, created_at: localIso(2026, 11, 2, 12) }),
        deal({ id: 0, created_at: localIso(2025, 12, 31, 12) }),
      ],
      now
    );
    expect(days.map((day) => day.label)).toEqual([
      'Сегодня',
      'Вчера',
      '2 ноября',
      '31 декабря 2025',
    ]);
  });

  it('границы локальных суток: полночь — уже новый день, 23:59:59 — старый', () => {
    const days = groupDealDays(
      [
        deal({ id: 2, created_at: localIso(2026, 11, 4, 0, 0, 0, 0) }),
        deal({ id: 1, created_at: localIso(2026, 11, 3, 23, 59, 59, 999) }),
      ],
      now
    );
    expect(days.map((day) => day.label)).toEqual(['Сегодня', 'Вчера']);
  });

  it('в дне — количество, сумма и записи в исходном порядке', () => {
    const days = groupDealDays(
      [
        deal({ id: 3, price: 100, created_at: localIso(2026, 11, 4, 9) }),
        deal({ id: 2, price: 50, created_at: localIso(2026, 11, 4, 8) }),
        deal({ id: 1, price: 70, created_at: localIso(2026, 11, 3, 20) }),
      ],
      now
    );
    expect(days.map((day) => day.count)).toEqual([2, 1]);
    expect(days.map((day) => day.total)).toEqual([150, 70]);
    expect(days[0]?.entries.map((entry) => entry.id)).toEqual([3, 2]);
    expect(days[1]?.entries.map((entry) => entry.id)).toEqual([1]);
  });

  it('дни идут в порядке появления, а не по календарю', () => {
    const days = groupDealDays(
      [
        deal({ id: 3, created_at: localIso(2026, 11, 2, 9) }),
        deal({ id: 2, created_at: localIso(2026, 11, 4, 9) }),
        deal({ id: 1, created_at: localIso(2026, 11, 3, 9) }),
      ],
      now
    );
    expect(days.map((day) => day.label)).toEqual(['2 ноября', 'Сегодня', 'Вчера']);
  });

  it('пустой лог — пустой список дней', () => {
    expect(groupDealDays([], now)).toEqual([]);
  });
});
