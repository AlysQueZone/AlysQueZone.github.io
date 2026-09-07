/** Баланс Пивкойнов: локальная косметика в localStorage, бэкенда нет.
 * Инвентарь/история покупок жили тут до polish-01, теперь «Мои приветы»
 * и история — из shared-БД; старые ключи больше не читаем. */

export const BALANCE_KEY = 'pivkoiny_balance';
export const START_BALANCE = 1000;

function hasStorage(): boolean {
  return typeof localStorage !== 'undefined';
}

export function getBalance(): number {
  if (!hasStorage()) return START_BALANCE;
  const raw = localStorage.getItem(BALANCE_KEY);
  if (raw === null) {
    localStorage.setItem(BALANCE_KEY, String(START_BALANCE));
    return START_BALANCE;
  }
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : START_BALANCE;
}

export function canAfford(price: number): boolean {
  return getBalance() >= price;
}

/** Списывает price, если хватает. Возвращает true при успехе. */
export function spend(price: number): boolean {
  if (!hasStorage() || !canAfford(price)) return false;
  localStorage.setItem(BALANCE_KEY, String(getBalance() - price));
  return true;
}

/** Начисляет amount пивкойнов (тикет 22: scum-кнопка дарит +1000). Возвращает новый баланс. */
export function earn(amount: number): number {
  const delta = Math.floor(Number(amount));
  if (!hasStorage() || !Number.isFinite(delta) || delta <= 0) return getBalance();
  const next = getBalance() + delta;
  localStorage.setItem(BALANCE_KEY, String(next));
  return next;
}
