/**
 * Шапка: чистое ядро ссылок и плашки баланса — без DOM.
 *
 * Владеет тем, что видит зритель: гость — «Войти через Twitch» без ника и
 * плашки; залогиненный — ник и плашка баланса, обе ведут в свой профиль через
 * `profileHref` (второй формулы `/profile/?uid=` не заводим). Не владеет
 * разметкой, текстами, сессией и чтением баланса (это `session.ts` и
 * `live.ts`) — компоненты лишь накладывают результат.
 *
 * Ник без uid ссылкой не становится (ник — вечная идентичность, ADR 0014).
 * Пустой логин — гость, как и `null`: `@` на экран не выводится.
 * Пока ответа по балансу нет, плашку не показываем, чтобы не мигать прочерком.
 *
 * Тесты — src/lib/header.test.ts.
 */
import { cleanLogin, profileHref } from './profile';

/** Ник в шапке: видимость, подпись и адрес своего профиля. */
export interface NickLinkState {
  signedIn: boolean;
  /** `@login`; гость — пустая строка. */
  text: string;
  href: string | null;
}

export function nickLink(input: { login: string | null; uid: string | null }): NickLinkState {
  // Пустой логин — та же пустота, что и `null` (паспорт: `profileCaption`).
  const login = cleanLogin(input.login);
  if (login.length === 0) return { signedIn: false, text: '', href: null };
  return {
    signedIn: true,
    text: `@${login}`,
    href: profileHref(input.uid),
  };
}

/** Плашка баланса: видимость, значение и адрес своего профиля. */
export interface BalancePlateState {
  visible: boolean;
  /** Текст баланса; пустая строка — не красить, ответа ещё нет. */
  value: string;
  href: string | null;
}

export function balancePlate(input: {
  uid: string | null;
  balanceKnown: boolean;
  balance: number | null;
}): BalancePlateState {
  const href = profileHref(input.uid);
  if (input.uid === null || !input.balanceKnown) {
    return { visible: false, value: '', href };
  }
  return {
    visible: true,
    value: input.balance === null ? '—' : String(input.balance),
    href,
  };
}
