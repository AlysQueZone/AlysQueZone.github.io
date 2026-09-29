import { describe, expect, it } from 'vitest';
import {
  buyAvailability,
  formatStaged,
  parseBuyIntent,
  serializeBuyIntent,
  type BuyIntent,
} from './buy-intent';

const base: BuyIntent = {
  slug: 'lot-privet-bradhi',
  title: 'Привет Брадхи',
  price: 120,
  owner: 'alysque',
  video: 'https://example.test/privet.mp4',
};

describe('serializeBuyIntent / parseBuyIntent', () => {
  it('round-trip сохраняет все поля', () => {
    expect(parseBuyIntent(serializeBuyIntent(base))).toEqual(base);
  });

  it('цена null и видео null — законная форма (N неизвестна)', () => {
    const intent: BuyIntent = { ...base, price: null, video: null };
    expect(parseBuyIntent(serializeBuyIntent(intent))).toEqual(intent);
  });

  it('пустой слот и не-строка — null', () => {
    expect(parseBuyIntent(undefined)).toBeNull();
    expect(parseBuyIntent('')).toBeNull();
    expect(parseBuyIntent(42)).toBeNull();
  });

  it('битый JSON, массив и примитив — null', () => {
    expect(parseBuyIntent('{')).toBeNull();
    expect(parseBuyIntent('[]')).toBeNull();
    expect(parseBuyIntent('null')).toBeNull();
    expect(parseBuyIntent('"строка"')).toBeNull();
  });

  it('обязательные строки проверяются', () => {
    expect(parseBuyIntent(JSON.stringify({ ...base, slug: '' }))).toBeNull();
    expect(parseBuyIntent(JSON.stringify({ ...base, title: '' }))).toBeNull();
    expect(parseBuyIntent(JSON.stringify({ ...base, owner: 7 }))).toBeNull();
  });

  it('цена — null или положительное конечное число', () => {
    expect(parseBuyIntent(JSON.stringify({ ...base, price: 0 }))).toBeNull();
    expect(parseBuyIntent(JSON.stringify({ ...base, price: -5 }))).toBeNull();
    expect(parseBuyIntent(JSON.stringify({ ...base, price: '120' }))).toBeNull();
    // JSON.parse('1e999') даёт Infinity — конечным числом не считается.
    expect(
      parseBuyIntent('{"slug":"s","title":"t","owner":"o","price":1e999,"video":null}')
    ).toBeNull();
  });

  it('видео — null или непустая строка', () => {
    expect(parseBuyIntent(JSON.stringify({ ...base, video: '' }))).toBeNull();
    expect(parseBuyIntent(JSON.stringify({ ...base, video: 9 }))).toBeNull();
  });

  it('лишние ключи отбрасываются, а не протекают', () => {
    const parsed = parseBuyIntent(JSON.stringify({ ...base, injected: '<img>' }));
    expect(parsed).toEqual(base);
    expect(parsed && 'injected' in parsed).toBe(false);
  });
});

describe('buyAvailability', () => {
  it('цена неизвестна — «unknown»: не гасим и не врём', () => {
    expect(buyAvailability({ ...base, price: null }, 0)).toBe('unknown');
  });

  it('баланс неизвестен — «available»: сравнить не с чем, решает сервер', () => {
    expect(buyAvailability(base, null)).toBe('available');
  });

  it('баланс меньше цены — «short»', () => {
    expect(buyAvailability(base, 119)).toBe('short');
  });

  it('ровно хватает и больше — «available»', () => {
    expect(buyAvailability(base, 120)).toBe('available');
    expect(buyAvailability(base, 1000)).toBe('available');
  });
});

describe('formatStaged', () => {
  it('неизвестная N — «…», известная — число строкой', () => {
    expect(formatStaged(null)).toBe('…');
    expect(formatStaged(120)).toBe('120');
  });
});
