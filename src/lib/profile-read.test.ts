/**
 * Транспорт профиля: битый uid отсекается до сети (Postgres не должен
 * получить cast). Успешное чтение и состояния проверяются в preview против
 * локального Supabase — здесь только шов валидации.
 */
import { describe, expect, it } from 'vitest';
import { fetchPublicProfile } from './profile-read';

describe('fetchPublicProfile', () => {
  it('битый uid — «не найден» без запроса к БД', async () => {
    await expect(fetchPublicProfile('abc')).resolves.toEqual({ status: 'not-found' });
    await expect(fetchPublicProfile('')).resolves.toEqual({ status: 'not-found' });
  });
});
