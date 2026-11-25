/**
 * Представление Лота: селектор владения («Твой» считается от uid, а не хранится
 * в снапшоте), ссылка на профиль владельца и надпись кнопки покупки — одно
 * правило на все поверхности (docs/adr/0009).
 */
import { describe, expect, it } from 'vitest';
import { buyButtonView, isMine, ownerBadgeView } from './lot-view';
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

describe('ownerBadgeView', () => {
  const OWNER = '5b1f0c2e-9d3a-4f7b-8c1d-2e3f4a5b6c7d';

  it('владелец с uid — бейдж ведёт в профиль, доступное имя — ник', () => {
    expect(ownerBadgeView(lot({ owner_login: 'alice', owner_uid: OWNER }))).toEqual({
      login: 'alice',
      href: `/profile/?uid=${OWNER}`,
    });
  });

  it('uid не uuid (старые данные, мусор) — бейдж текстом, а не битой ссылкой', () => {
    expect(ownerBadgeView(lot({ owner_login: 'alice', owner_uid: 'u1' }))).toEqual({
      login: 'alice',
      href: null,
    });
  });

  it('«Биржа» и владелец без uid остаются текстом без ссылки', () => {
    expect(ownerBadgeView(lot({ owner_login: 'Биржа', owner_uid: null }))).toEqual({
      login: 'Биржа',
      href: null,
    });
  });

  it('владелец без ника, но с uid — «чатерс» и ссылка на профиль', () => {
    expect(ownerBadgeView(lot({ owner_login: null, owner_uid: OWNER }))).toEqual({
      login: 'чатерс',
      href: `/profile/?uid=${OWNER}`,
    });
  });

  it('свободный лот — пустой бейдж, ссылки нет', () => {
    expect(ownerBadgeView(lot({ owner_login: null, owner_uid: null }))).toEqual({
      login: '',
      href: null,
    });
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
    });
  });

  it('свой Лот погашен общей надписью «Твой привет»', () => {
    expect(buyButtonView(intent, { balance: 500, mine: true })).toEqual({
      text: 'Твой привет',
      disabled: true,
    });
  });

  it('профиль переопределяет надпись своего Лота — «Твой лот», логика та же', () => {
    expect(buyButtonView(intent, { balance: 500, mine: true, mineLabel: 'Твой лот' })).toEqual({
      text: 'Твой лот',
      disabled: true,
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
    });
  });

  it('N неизвестна — честное «…», по балансу не гасим', () => {
    expect(buyButtonView({ ...intent, price: null }, { balance: 0 })).toEqual({
      text: '▶ Забрать за … 🍺',
      disabled: false,
    });
  });
});
