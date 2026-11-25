/**
 * Профиль: тонкий транспорт публичного read model `public_profile`.
 *
 * Владеет одним RPC-вызовом на профиль и честным исходом: `ok` — строка
 * разобралась, `not-found` — БД вернула ноль строк (или uid битый, тогда
 * запроса нет), `error` — сеть/БД, с признаком офлайна из общего
 * классификатора (`lib/errors.ts`). Не владеет состоянием страницы, DOM и
 * формулами: статы считает `lib/profile.ts`, разметку — страница.
 *
 * uid проверяется здесь до вызова: Postgres кастует параметр до проверки строк
 * и на битом uuid падает 22P02 — это «не найден», а не «не загрузилось».
 */
import { isOfflineError } from './errors';
import { parseProfileUid, profileStats, type ProfileRow, type ProfileStats } from './profile';
import { getSupabase, withAuthRetry } from './session';

/** Исход чтения профиля: честное «нет такого» отдельно от «не загрузилось». */
export type ProfileReadResult =
  | { status: 'ok'; profile: ProfileStats }
  | { status: 'not-found' }
  | { status: 'error'; offline: boolean };

/**
 * Один вызов `public_profile(uid)` на профиль. Битый/пустой uid — `not-found`
 * без запроса. Ответ с битой строкой — `error`: лучше честный повтор, чем нули
 * в паспорте.
 */
export async function fetchPublicProfile(uid: string): Promise<ProfileReadResult> {
  const parsed = parseProfileUid(uid);
  if (parsed === null) return { status: 'not-found' };

  const sb = getSupabase();
  if (!sb) return { status: 'error', offline: false };

  try {
    const { data, error } = await withAuthRetry(() =>
      sb.rpc('public_profile', { uid: parsed }).maybeSingle()
    );
    if (error) return { status: 'error', offline: isOfflineError(error) };
    if (data === null || data === undefined) return { status: 'not-found' };
    const profile = profileStats(data as ProfileRow);
    return profile ? { status: 'ok', profile } : { status: 'error', offline: false };
  } catch (err) {
    return { status: 'error', offline: isOfflineError(err) };
  }
}
