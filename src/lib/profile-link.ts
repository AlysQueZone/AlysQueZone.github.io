/**
 * Ник-ссылка на профиль — DOM-адаптер над чистым `profileHref`.
 *
 * Один узел на все поверхности: лог сделок, история перепродаж Лота и панель
 * колокольчика собирали «ссылка или текст» руками. uid не uuid («Биржа»,
 * свободный лот, мусор) — ник остаётся текстом, а не ведёт в никуда.
 *
 * `base` — общие классы ссылки и текста: вид не должен прыгать, когда uid
 * появляется. `link` — только ссылке (обычно hover-цвет и подчёркивание).
 * Доступное имя — сам ник: лишних `aria-label` модуль не ставит.
 */
import { profileHref } from './profile';

export interface ProfileNickOptions {
  /** Классы у ссылки и у текста-фолбэка: вид одинаков в обоих состояниях. */
  base?: string;
  /** Дополнительные классы только ссылки; по умолчанию `hover:text-ember`. */
  link?: string;
  /** Тег текста, когда uid нет; жирный ник — `b`. */
  tag?: 'span' | 'b';
}

/** Ник как ссылка на профиль; uid невалиден — тот же ник текстом. */
export function profileNick(
  text: string,
  uid: string | null | undefined,
  opts: ProfileNickOptions = {}
): HTMLElement {
  const base = opts.base ?? '';
  const href = profileHref(uid);
  if (href === null) {
    const fallback = document.createElement(opts.tag ?? 'span');
    fallback.className = base;
    fallback.textContent = text;
    return fallback;
  }
  const link = document.createElement('a');
  link.className = [base, opts.link ?? 'hover:text-ember'].filter(Boolean).join(' ');
  link.href = href;
  link.textContent = text;
  return link;
}
