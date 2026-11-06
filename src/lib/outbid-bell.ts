/**
 * Колокольчик: чистое состояние истории Перекупов.
 *
 * Владеет записями, счётчиком непрочитанных, меткой просмотра, дедупом
 * живого события, слиянием оффлайн-догона, удалением по Покупке и сбросом
 * при смене uid. Не владеет DOM, панелью, Поповером, Escape, live-подпиской,
 * звуком и Всплывающими уведомлениями — это адаптер outbid-notice.ts
 * (docs/adr/0005).
 *
 * Хранилище метки и часы инъектируются: ядро не знает ни localStorage, ни
 * Date.now — замена хранилища остаётся правкой адаптера. Дедуп живого события
 * — окно `dedupeMs` по ключу `slug|price|by`; догон — повторное чтение того
 * же источника, поэтому дедупит по ключу без окна.
 *
 * Тесты — src/lib/outbid-bell.test.ts.
 */
import type { OutbidEvent } from './outbid-event';

/** Метка просмотра: per-uid, чтобы смена аккаунта не смешивала прочитанное. */
export interface OutbidBellStorage {
  readSeen(uid: string): number;
  writeSeen(uid: string, at: number): void;
}

export interface OutbidBellOptions {
  storage: OutbidBellStorage;
  now: () => number;
  maxHistory?: number;
  dedupeMs?: number;
}

export interface OutbidBellSnapshot {
  /** Живая история сверху вниз: свежие записи первыми. */
  entries: readonly OutbidEvent[];
  unread: number;
  seenAt: number;
}

export interface OutbidBell {
  /** Смена сессии: гость очищает всё, залогиненный читает свою метку. */
  setUid(uid: string | null): void;
  /** Живое событие: дубль в окне — `duplicate`, иначе запись сверху. */
  add(ev: OutbidEvent): 'added' | 'duplicate';
  /**
   * Оффлайн-догон: дедуп по ключу против истории и `knownKeys`, сортировка
   * по времени вниз, лимит истории. Возвращает число добавленных записей.
   */
  merge(found: readonly OutbidEvent[], knownKeys?: Iterable<string>): number;
  /** Выкуп обратно: убрать все записи Лота, вернуть их slug'и (уникальные). */
  removeBought(slug: string): readonly string[];
  /** Открытие панели: счётчик в ноль, метка просмотра — в хранилище. */
  markSeen(at?: number): void;
  snapshot(): OutbidBellSnapshot;
}

const DEFAULT_MAX_HISTORY = 10;
const DEFAULT_DEDUPE_MS = 5000;

/** Ключ дедупа один на живое событие и догон: `slug|price|by`. */
export function outbidEventKey(ev: OutbidEvent): string {
  return `${ev.slug}|${ev.price}|${ev.by}`;
}

export function createOutbidBell(options: OutbidBellOptions): OutbidBell {
  const { storage, now } = options;
  const maxHistory = options.maxHistory ?? DEFAULT_MAX_HISTORY;
  const dedupeMs = options.dedupeMs ?? DEFAULT_DEDUPE_MS;

  let uid: string | null = null;
  const entries: OutbidEvent[] = [];
  let unread = 0;
  let seenAt = 0;

  function trim(): void {
    while (entries.length > maxHistory) entries.pop();
  }

  /** Гость и смена владельца не должны видеть чужую историю: записи общие
   *  для сессии экрана, поэтому сбрасываются на любом переходе uid. */
  function setUid(next: string | null): void {
    if (next === uid) return;
    uid = next;
    entries.length = 0;
    unread = 0;
    seenAt = 0;
    if (next !== null) {
      const stored = storage.readSeen(next);
      seenAt = Number.isFinite(stored) && stored > 0 ? stored : 0;
    }
  }

  function add(ev: OutbidEvent): 'added' | 'duplicate' {
    const key = outbidEventKey(ev);
    const duplicate = entries.some(
      (entry) => outbidEventKey(entry) === key && Math.abs(entry.at - ev.at) < dedupeMs
    );
    if (duplicate) return 'duplicate';
    entries.unshift(ev);
    trim();
    unread += 1;
    return 'added';
  }

  function merge(found: readonly OutbidEvent[], knownKeys: Iterable<string> = []): number {
    const known = new Set(knownKeys);
    for (const entry of entries) known.add(outbidEventKey(entry));
    const fresh: OutbidEvent[] = [];
    for (const ev of found) {
      const key = outbidEventKey(ev);
      if (known.has(key)) continue;
      known.add(key);
      fresh.push(ev);
    }
    if (fresh.length === 0) return 0;
    // Догон — единственное место, где история пересортировывается: живое
    // событие уже стоит сверху, и каждая его вставка не должна двигать панель.
    entries.push(...fresh);
    entries.sort((a, b) => b.at - a.at);
    trim();
    // Счётчик растёт только на события новее метки: старый догон пополняет
    // историю, но не выдаёт себя за непрочитанное.
    for (const ev of fresh) if (ev.at > seenAt) unread += 1;
    return fresh.length;
  }

  function removeBought(slug: string): readonly string[] {
    const removed: string[] = [];
    for (let i = entries.length - 1; i >= 0; i--) {
      if (entries[i]?.slug !== slug) continue;
      entries.splice(i, 1);
      if (!removed.includes(slug)) removed.push(slug);
    }
    if (removed.length === 0) return removed;
    // Пересчёт по оставшимся: выкуп прочитанного Лота не должен съедать
    // чужой непрочитанный счётчик.
    unread = entries.filter((entry) => entry.at > seenAt).length;
    return removed;
  }

  function markSeen(at: number = now()): void {
    unread = 0;
    seenAt = at;
    if (uid !== null) storage.writeSeen(uid, at);
  }

  function snapshot(): OutbidBellSnapshot {
    return { entries: [...entries], unread, seenAt };
  }

  return { setUid, add, merge, removeBought, markSeen, snapshot };
}
