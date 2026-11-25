/**
 * Читатель приветов владельца — тонкая обёртка над транспортом: страница
 * профиля зовёт его с uid из `?uid=`, а не-uuid и пустой uid отсекаются без
 * запроса (Postgres упал бы на cast в uuid). Сама страница (keyset `(price, slug)`,
 * колонки и фильтр `owner_uid`) проверяется в preview против локального
 * Supabase; чистая механика листания — catalog-page.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { readOwnerLotsPage } from './live';

describe('readOwnerLotsPage', () => {
  it('не uuid — отказ без запроса, не пустая страница БД', async () => {
    for (const bad of ['', '   ', 'abc', 'Биржа', '@ShidouQuE', 'seller_uid']) {
      await expect(readOwnerLotsPage(bad, null, 12), bad).resolves.toEqual({
        ok: false,
        states: [],
        hasMore: false,
      });
    }
  });
});
