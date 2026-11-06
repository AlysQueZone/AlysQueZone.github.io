/**
 * Навигация отложенной покупки: какой Лот переоткрыть после возврата из логина.
 *
 * Владеет меткой `alysque:pending-buy` в sessionStorage и `?buy=` в адресе;
 * сети и клиента хранилища не импортирует, поэтому витрина (`/lots/`) берёт
 * отсюда только `peekPendingBuy` и не тянет auth ради навигации. Решение о
 * возврате (когда стирать метку) принимает поверхность — `BuyModal`.
 */

/** Ключ отложенной покупки: какой Лот переоткрыть после возврата из логина. */
const PENDING_BUY_KEY = 'alysque:pending-buy';

/** Запомнить Лот, к которому вернуться после логина. */
export function stashPendingBuy(lotId: string): void {
  try {
    sessionStorage.setItem(PENDING_BUY_KEY, lotId);
  } catch {
    // приватный режим — возврат сработает через ?buy= в URL
  }
}

/** Прочитать запомненный Лот, не стирая его: возврат ждёт появления кнопки
 *  (витрина/страница рисуют карточку из БД уже после загрузки). */
export function peekPendingBuy(): string | null {
  let fromStorage: string | null = null;
  try {
    fromStorage = sessionStorage.getItem(PENDING_BUY_KEY);
  } catch {
    // приватный режим — вернёмся через ?buy= в URL
  }
  if (typeof window === 'undefined') return fromStorage;
  const fromUrl = new URL(window.location.href).searchParams.get('buy');
  return fromStorage ?? fromUrl;
}

/** Стереть запомненный Лот (после успешного возврата к нему) и убрать ?buy= из адреса. */
export function clearPendingBuy(): void {
  try {
    sessionStorage.removeItem(PENDING_BUY_KEY);
  } catch {
    // приватный режим — чистить нечего
  }
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (url.searchParams.has('buy')) {
    url.searchParams.delete('buy');
    window.history.replaceState(null, '', url.toString());
  }
}

/** URL возврата после логина: текущий адрес + ?buy=<lotId>. */
export function returnUrlForLot(lotId: string): string {
  const url = new URL(window.location.href);
  url.searchParams.set('buy', lotId);
  return url.toString().split('#')[0];
}
