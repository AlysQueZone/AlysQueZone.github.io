/**
 * Представление Лота: селектор владения («Твой» считается от uid, а не хранится
 * в снапшоте) и надпись кнопки покупки — одно правило на все поверхности
 * (docs/adr/0009).
 */
import { describe, expect, it } from 'vitest';
import { buyButtonView, isMine } from './lot-view';
import type { BuyIntent } from './buy-intent';
import { lot } from './live-store-test-fixtures';

describe('isMine', () => {
  it('мой — когда uid совпал с владельцем', () => {
    expect(isMine(lot({ owner_uid: 'u1' }), 'u1')).toBe(true);
  });

  it('гость и чужой uid — не мой', () => {
    expect(isMine(lot({ owner_uid: 'u1' }), null)).toBe(false);
    expect(isMine(lot({ owner_uid: 'u1' }), 'u2')).toBe(false);
  });

  it('свободный лот не становится моим у гостя', () => {
    expect(isMine(lot({ owner_uid: null }), null)).toBe(false);
  });
});

describe('buyButtonView', () => {
  const intent: BuyIntent = {
    slug: 'lot-a',
    title: 'Привет A',
    price: 120,
    owner: 'alice',
    video: null,
  };

  it('чужой Лот забирается: цена и действие — в надписи, кнопка живая', () => {
    expect(buyButtonView(intent, { balance: 500 })).toEqual({
      text: '▶ Забрать за 120 🍺',
      disabled: false,
      muted: false,
    });
  });

  it('свой Лот погашен общей надписью «Твой привет»', () => {
    expect(buyButtonView(intent, { balance: 500, mine: true })).toEqual({
      text: 'Твой привет',
      disabled: true,
      muted: true,
    });
  });

  it('профиль переопределяет надпись своего Лота — «Твой лот», логика та же', () => {
    expect(buyButtonView(intent, { balance: 500, mine: true, mineLabel: 'Твой лот' })).toEqual({
      text: 'Твой лот',
      disabled: true,
      muted: true,
    });
    // Чужой Лот метку не берёт: она только про своё владение.
    expect(buyButtonView(intent, { balance: 500, mineLabel: 'Твой лот' }).text).toBe(
      '▶ Забрать за 120 🍺'
    );
  });

  it('не хватает баланса — погашена, цена остаётся в надписи', () => {
    expect(buyButtonView(intent, { balance: 100 })).toEqual({
      text: 'Не хватает · 120 🍺',
      disabled: true,
      muted: true,
    });
  });

  it('N неизвестна — честное «…», по балансу не гасим', () => {
    expect(buyButtonView({ ...intent, price: null }, { balance: 0 })).toEqual({
      text: '▶ Забрать за … 🍺',
      disabled: false,
      muted: false,
    });
  });
});
