/**
 * Тесты чистого состояния фильтра «Лога сделок»: разбор `?user`/`?mine`,
 * buyer uid, URL и заголовок. Без DOM и сети; URL сравнивается точной строкой
 * (`pathname + search`) — ссылки строит модуль, страница только пишет историю.
 *
 * Правила продукта: `?user` сильнее `?mine`, битый uid игнорируется,
 * «Все» и «Мои покупки» сбрасывают `user`, заголовок без логина — честный
 * фолбэк, а не выдуманный ник и не uuid.
 */
import { describe, expect, it } from 'vitest';
import {
  buyerUidFor,
  dealFilterTitle,
  dealFilterUrl,
  parseDealFilter,
  type DealFilter,
} from './deal-filter';

const UID = '5b1f0c2e-9d3a-4f7b-8c1d-2e3f4a5b6c7d';
const OTHER_UID = '0a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d';

function deals(query = ''): URL {
  return new URL(`https://alysque.zone/deals/${query}`);
}

function shown(url: URL): string {
  return `${url.pathname}${url.search}`;
}

describe('parseDealFilter', () => {
  it('пустой query — «Все»', () => {
    expect(parseDealFilter('')).toEqual({ mode: 'all' });
    expect(parseDealFilter('?')).toEqual({ mode: 'all' });
  });

  it('?mine=1 — «Мои покупки», другое значение mine не считается', () => {
    expect(parseDealFilter('?mine=1')).toEqual({ mode: 'mine' });
    expect(parseDealFilter('mine=1')).toEqual({ mode: 'mine' });
    expect(parseDealFilter('?mine=0')).toEqual({ mode: 'all' });
    expect(parseDealFilter('?mine=yes')).toEqual({ mode: 'all' });
  });

  it('?user — фильтр по покупателю; uid нормализуется', () => {
    expect(parseDealFilter(`?user=${UID}`)).toEqual({ mode: 'user', uid: UID });
    expect(parseDealFilter(`?user=${UID.toUpperCase()}`)).toEqual({ mode: 'user', uid: UID });
    expect(parseDealFilter(`?user=${encodeURIComponent(` ${UID} `)}`)).toEqual({
      mode: 'user',
      uid: UID,
    });
  });

  it('?user сильнее ?mine — это один фильтр, а не два', () => {
    expect(parseDealFilter(`?user=${UID}&mine=1`)).toEqual({ mode: 'user', uid: UID });
    expect(parseDealFilter(`?mine=1&user=${UID}`)).toEqual({ mode: 'user', uid: UID });
  });

  it('битый uid игнорируется: остаётся mine или «Все»', () => {
    for (const bad of ['', 'abc', '42', '5b1f0c2e9d3a4f7b8c1d2e3f4a5b6c7d']) {
      expect(parseDealFilter(`?user=${bad}`)).toEqual({ mode: 'all' });
      expect(parseDealFilter(`?user=${bad}&mine=1`)).toEqual({ mode: 'mine' });
    }
  });
});

describe('buyerUidFor', () => {
  it('«Все» — запрос без фильтра, даже когда вошёл', () => {
    expect(buyerUidFor({ mode: 'all' }, UID)).toBeNull();
    expect(buyerUidFor({ mode: 'all' }, null)).toBeNull();
  });

  it('«Мои покупки» — uid сессии; у гостя фильтра нет', () => {
    expect(buyerUidFor({ mode: 'mine' }, UID)).toBe(UID);
    expect(buyerUidFor({ mode: 'mine' }, null)).toBeNull();
  });

  it('чужой фильтр работает и гостю: uid из ссылки', () => {
    expect(buyerUidFor({ mode: 'user', uid: OTHER_UID }, null)).toBe(OTHER_UID);
    expect(buyerUidFor({ mode: 'user', uid: OTHER_UID }, UID)).toBe(OTHER_UID);
  });
});

describe('dealFilterUrl', () => {
  it('«Все» — чистая ссылка без user и mine', () => {
    expect(shown(dealFilterUrl({ mode: 'all' }, deals()))).toBe('/deals/');
    expect(shown(dealFilterUrl({ mode: 'all' }, deals(`?user=${UID}`)))).toBe('/deals/');
    expect(shown(dealFilterUrl({ mode: 'all' }, deals('?mine=1')))).toBe('/deals/');
    expect(shown(dealFilterUrl({ mode: 'all' }, deals(`?user=${UID}&mine=1`)))).toBe('/deals/');
  });

  it('«Мои покупки» — ?mine=1 и без прежнего user', () => {
    expect(shown(dealFilterUrl({ mode: 'mine' }, deals()))).toBe('/deals/?mine=1');
    expect(shown(dealFilterUrl({ mode: 'mine' }, deals(`?user=${UID}`)))).toBe('/deals/?mine=1');
  });

  it('чужой фильтр — ?user=<uid>, mine сбрасывается', () => {
    expect(shown(dealFilterUrl({ mode: 'user', uid: UID }, deals()))).toBe(`/deals/?user=${UID}`);
    expect(shown(dealFilterUrl({ mode: 'user', uid: UID }, deals('?mine=1')))).toBe(
      `/deals/?user=${UID}`
    );
    expect(shown(dealFilterUrl({ mode: 'user', uid: UID }, deals(`?user=${OTHER_UID}`)))).toBe(
      `/deals/?user=${UID}`
    );
  });

  it('чужие параметры не трогает, исходный URL не меняет', () => {
    const current = deals(`?ref=1&user=${UID}`);
    const next = dealFilterUrl({ mode: 'all' }, current);
    expect(next.searchParams.get('ref')).toBe('1');
    expect(next.searchParams.has('user')).toBe(false);
    expect(current.searchParams.get('user')).toBe(UID);
  });
});

describe('dealFilterTitle', () => {
  const cases: ReadonlyArray<[DealFilter, string]> = [
    [{ mode: 'all' }, 'Лог сделок'],
    [{ mode: 'mine' }, 'Мои покупки'],
  ];

  it('«Все» и «Мои покупки» подписаны своими словами', () => {
    for (const [filter, title] of cases) expect(dealFilterTitle(filter, null)).toBe(title);
  });

  it('чужой фильтр — «Покупки @nick»', () => {
    expect(dealFilterTitle({ mode: 'user', uid: UID }, 'ShidouQuE')).toBe('Покупки @ShidouQuE');
    expect(dealFilterTitle({ mode: 'user', uid: UID }, '@Bradhi')).toBe('Покупки @Bradhi');
  });

  it('логина нет — «Покупки чатерса», без uuid и выдуманного ника', () => {
    for (const login of [null, undefined, '', '   ', '@']) {
      const title = dealFilterTitle({ mode: 'user', uid: UID }, login);
      expect(title).toBe('Покупки чатерса');
      expect(title).not.toContain(UID);
    }
  });
});
