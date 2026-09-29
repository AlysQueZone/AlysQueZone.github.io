import { describe, expect, it } from 'vitest';
import { errorText, isNoAuthError, isOfflineError } from './errors';

describe('errorText', () => {
  it('Error, объект с message, примитивы — одна форма', () => {
    expect(errorText(new Error('бум'))).toBe('бум');
    expect(errorText({ message: 'PGRST301' })).toBe('PGRST301');
    expect(errorText('строка')).toBe('строка');
    expect(errorText(null)).toBe('null');
  });
});

describe('isOfflineError', () => {
  it('маркеры транспорта — офлайн', () => {
    for (const msg of [
      'Failed to fetch',
      'NetworkError when attempting to fetch resource',
      'network error',
      'Load failed',
      'offline',
    ]) {
      expect(isOfflineError(new Error(msg))).toBe(true);
    }
  });

  it('TypeError от fetch — офлайн, даже с чужим текстом', () => {
    expect(isOfflineError(new TypeError('что-то'))).toBe(true);
  });

  it('серверная ошибка — не офлайн', () => {
    expect(isOfflineError({ message: 'insufficient funds' })).toBe(false);
    expect(isOfflineError(new Error('cooldown 30s'))).toBe(false);
  });
});

describe('isNoAuthError', () => {
  it('маркеры входа — нет входа', () => {
    for (const msg of [
      'not authenticated',
      'new row violates row-level security policy',
      'JWT expired',
      'no twitch identity',
    ]) {
      expect(isNoAuthError(new Error(msg))).toBe(true);
    }
  });

  it('доменные ошибки — не про вход', () => {
    expect(isNoAuthError({ message: 'cooldown 30s' })).toBe(false);
    expect(isNoAuthError({ message: 'insufficient funds' })).toBe(false);
    expect(isNoAuthError({ message: 'Failed to fetch' })).toBe(false);
  });
});
