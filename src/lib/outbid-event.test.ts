/**
 * Тесты строки продавца: чистое ядро раскрывает комиссию и отдаёт ник
 * отдельной частью — панель Колокольчика строит из неё ссылку на профиль,
 * Всплывающие уведомления берут готовую строку (docs/adr/0005).
 */
import { describe, expect, it } from 'vitest';
import { sellerLine, sellerLineParts, type OutbidEvent } from './outbid-event';

function ev(overrides: Partial<OutbidEvent> = {}): OutbidEvent {
  return {
    slug: 'lot-a',
    title: 'Привет A',
    by: 'foxindique',
    buyer_uid: 'fox-uid',
    price: 880,
    at: 1000,
    video: null,
    ...overrides,
  };
}

describe('sellerLineParts', () => {
  it('ник — отдельной частью, остальное — хвост с раскрытой комиссией', () => {
    expect(sellerLineParts(ev())).toEqual({
      by: 'foxindique',
      rest: ' забрал «Привет A» за 880 🍺 — получено 818 (комиссия 62)',
    });
  });

  it('sellerLine — те же части одной строкой', () => {
    const parts = sellerLineParts(ev());
    expect(sellerLine(ev())).toBe(parts.by + parts.rest);
    expect(sellerLine(ev())).toBe(
      'foxindique забрал «Привет A» за 880 🍺 — получено 818 (комиссия 62)'
    );
  });
});
