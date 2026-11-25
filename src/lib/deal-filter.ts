/**
 * Состояние фильтра «Лога сделок»: чистое ядро без DOM и сети.
 *
 * Владеет разбором `?user`/`?mine`, тем, какой buyer uid уходит в запрос,
 * адресом фильтра и заголовком. Не владеет запросом (`purchases-read`),
 * списком и историей браузера: страница только пишет URL и рисует.
 *
 * `?user=<uid>` — фильтр по покупателю для всех, включая гостя; он сильнее
 * `?mine=1`, потому что это ссылка на чужую историю, а не «мои покупки».
 * Битый uid отбрасывается (Postgres упал бы на cast) — фильтр откатывается к
 * mine/«Все», а не превращается в пустой экран.
 *
 * Заголовок не выдумывает ник: логин приходит из `public_profile` отдельным
 * чтением, и без него подпись честно общая — uuid на экран не попадает.
 * Тесты — src/lib/deal-filter.test.ts.
 */
import { cleanLogin, parseProfileUid } from './profile';

/** Состояние лога: вся биржа, мои покупки или покупки одного чатерса. */
export type DealFilter = { mode: 'all' } | { mode: 'mine' } | { mode: 'user'; uid: string };

/**
 * Разбор query-строки лога. `?user` wins over `?mine`; битый или пустой uid
 * игнорируется, и тогда решает `?mine=1`, иначе — «Все».
 */
export function parseDealFilter(search: string): DealFilter {
  const params = new URLSearchParams(search);
  const uid = parseProfileUid(params.get('user'));
  if (uid !== null) return { mode: 'user', uid };
  return params.get('mine') === '1' ? { mode: 'mine' } : { mode: 'all' };
}

/**
 * Buyer uid для запроса лога: «Все» — без фильтра, «Мои» — uid сессии (у гостя
 * его нет), `user` — uid из ссылки независимо от входа.
 */
export function buyerUidFor(filter: DealFilter, sessionUid: string | null): string | null {
  if (filter.mode === 'user') return filter.uid;
  return filter.mode === 'mine' ? sessionUid : null;
}

/**
 * Адрес состояния фильтра — единственное место, где живут `?user=` и `?mine=1`.
 * Оба параметра снимаются и ставится ровно один (или ни одного): «Все» и «Мои
 * покупки» — выходы из чужого фильтра. Прочие параметры и хеш не трогаются.
 */
export function dealFilterUrl(filter: DealFilter, current: URL): URL {
  const url = new URL(current.toString());
  url.searchParams.delete('user');
  url.searchParams.delete('mine');
  if (filter.mode === 'mine') url.searchParams.set('mine', '1');
  if (filter.mode === 'user') url.searchParams.set('user', filter.uid);
  return url;
}

/**
 * Заголовок лога: «Все» и «Мои покупки» — своими словами, чужой фильтр —
 * «Покупки @nick». Логина нет (нет строки, пустая подпись) — «Покупки
 * чатерса»: uuid как ник не печатаем.
 */
export function dealFilterTitle(filter: DealFilter, login: string | null | undefined): string {
  if (filter.mode === 'all') return 'Лог сделок';
  if (filter.mode === 'mine') return 'Мои покупки';
  const text = cleanLogin(login);
  return text.length > 0 ? `Покупки @${text}` : 'Покупки чатерса';
}

/**
 * Пустое состояние своим словами: «забери первый привет» — совет только для
 * всей биржи. В чужом фильтре это чужие покупки, советовать нечего; в «Моих» —
 * реплика про тебя. Логина нет — общая честная фраза без ника.
 */
export function dealFilterEmptyText(filter: DealFilter, login: string | null | undefined): string {
  if (filter.mode === 'all') return 'Сделок пока нет — забери первый привет';
  if (filter.mode === 'mine') return 'Ты пока ничего не покупал';
  const text = cleanLogin(login);
  return text.length > 0 ? `Покупок у @${text} пока нет` : 'Покупок пока нет';
}
