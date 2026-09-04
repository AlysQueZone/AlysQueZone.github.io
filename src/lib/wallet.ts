/** Фейк-кошелёк Пивкойнов: всё в localStorage, бэкенда нет. */

export const BALANCE_KEY = 'pivkoiny_balance';
export const INVENTORY_KEY = 'pivkoiny_inventory';
export const HISTORY_KEY = 'pivkoiny_history';
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

/** Кладёт id лота в локальный инвентарь «Мои приветы». */
export function addToInventory(lotId: string): void {
  if (!hasStorage()) return;
  const owned = getInventory();
  if (!owned.includes(lotId)) {
    owned.push(lotId);
    localStorage.setItem(INVENTORY_KEY, JSON.stringify(owned));
  }
}

export function getInventory(): string[] {
  if (!hasStorage()) return [];
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(INVENTORY_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

/** true, если лот уже лежит в «Моих привета». */
export function owns(lotId: string): boolean {
  return getInventory().includes(lotId);
}

export interface PurchaseRecord {
  from: string;
  to: string;
  price: number;
}

type HistoryMap = Record<string, PurchaseRecord[]>;

function readHistoryMap(): HistoryMap {
  if (!hasStorage()) return {};
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '{}');
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    return parsed as HistoryMap;
  } catch {
    return {};
  }
}

/**
 * Локальные записи истории покупок для лота.
 * Карточка лота (тикет 11) клеит их поверх базовой истории из lots.json:
 * `[...lot.history, ...getLocalHistory(lot.id)]`.
 */
export function getLocalHistory(lotId: string): PurchaseRecord[] {
  const entries = readHistoryMap()[lotId];
  return Array.isArray(entries) ? entries : [];
}

/** Дописывает «ты → владелец» в локальную историю лота. */
export function appendHistory(lotId: string, entry: PurchaseRecord): void {
  if (!hasStorage()) return;
  const map = readHistoryMap();
  map[lotId] = [...(Array.isArray(map[lotId]) ? map[lotId] : []), entry];
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(map));
  } catch {
    // localStorage переполнен/недоступен — покупка уже учтена, молча пропускаем
  }
}
