/**
 * Селектор владения Лотом: «Твой» считается от uid, а не хранится в снапшоте.
 */
import { describe, expect, it } from 'vitest';
import { isMine } from './lot-view';
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
