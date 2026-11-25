/**
 * Читатель приветов владельца — тонкая обёртка над транспортом: страница
 * профиля зовёт его с uid из `?uid=`, а пустой uid отсекается без запроса
 * (Postgres упал бы на cast в uuid). Сама страница (keyset `(price, slug)`,
 * колонки и фильтр `owner_uid`) проверяется в preview против локального
 * Supabase; чистая механика листания — catalog-page.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { readOwnerLotsPage } from './live';

describe('readOwnerLotsPage', () => {
  it('пустой uid — отказ без запроса, не пустая страница БД', async () => {
    await expect(readOwnerLotsPage('', null, 12)).resolves.toEqual({
      ok: false,
      states: [],
      hasMore: false,
    });
  });
});
