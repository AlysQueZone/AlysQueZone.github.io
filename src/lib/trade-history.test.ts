/**
 * Тесты чистого ядра чтения сделок: строки `purchases` превращаются в записи
 * «Истории перепродаж» и в события оффлайн-догона Колокольчика.
 *
 * Шов один (спека scratch/purchase-seller/spec.md): ни БД, ни DOM — строки на
 * входе, то, что видит чатерс, на выходе.
 */
import { describe, expect, it } from 'vitest';
import {
  historyEntries,
  outbidCatchup,
  PURCHASE_SELLER_FALLBACK,
  type TradeRow,
} from './trade-history';

/** Строка `purchases` с соединённым лотом — как её отдаёт PostgREST. */
function purchase(overrides: Partial<TradeRow> = {}): TradeRow {
  return {
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

/** Соединённый лот внутри строки сделки. */
function lot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { slug: 'lot-a', title: 'Привет', video_url: null, owner_uid: 'someone', ...overrides };
}

describe('historyEntries', () => {
  it('лот из заявки: в первой строке продавец — автор привета', () => {
    const entries = historyEntries([purchase({ seller_login: 'melkij_strateg' })]);
    expect(entries).toEqual([
      {
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
      purchase({ created_at: '2026-10-13T12:00:00.000Z', seller_login: 'author' }),
      purchase({ created_at: '2026-10-14T12:00:00.000Z', seller_login: 'foxindique' }),
    ]);
    expect(entries.map((entry) => entry.from)).toEqual(['author', 'foxindique']);
  });

  it('битые строки отбрасываются, остальные остаются', () => {
    const entries = historyEntries([
      purchase(),
      purchase({ buyer_login: null }),
      purchase({ buyer_login: '' }),
      purchase({ price_paid: 'нет' }),
      purchase({ price_paid: 0 }),
      purchase(),
    ]);
    expect(entries).toHaveLength(2);
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
