/**
 * Пейджер истории: один автомат первых страниц и дозагрузки для «Истории
 * перепродаж» Лота и «Лога сделок». Без DOM, Supabase, таймеров и текстов:
 * поверхность даёт `fetchPage(cursor)` и получает записи с фактами для анонса.
 *
 * Владеет: первой страницей (замена или слияние), дозагрузкой по курсору,
 * `hasMore`, ошибками (`failed` / `moreFailed`), поколением (`reset`) и одной
 * отложенной первой страницей — параллельных первых запросов нет.
 * Не владеет: курсором, слиянием и дедупом (`trade-history.ts`), разметкой,
 * `IntersectionObserver`, плашкой новых и текстами — это поверхности.
 *
 * Правило «полная страница = есть ещё» остаётся в адаптере источника: пейджер
 * берёт `hasMore` из ответа как есть и лишь не даёт зациклиться на странице,
 * целиком состоящей из уже показанных записей (`grew`).
 *
 * Тесты — src/lib/history-pager.test.ts.
 */

import {
  appendHistory,
  historyCursor,
  mergeHistory,
  type CursorEntry,
  type HistoryCursor,
} from './trade-history';

/** Страница источника: `ok: false` — ошибка чтения, а не пустая история. */
export interface HistoryPage<T extends CursorEntry> {
  ok: boolean;
  entries: readonly T[];
  /** За последней строкой страницы есть ещё. */
  hasMore: boolean;
}

export type FetchPage<T extends CursorEntry> = (
  cursor: HistoryCursor | null
) => Promise<HistoryPage<T>>;

export interface HistoryPagerState<T extends CursorEntry> {
  entries: readonly T[];
  /** Свежие записи, придержанные поверхностью до решения показать. */
  pending: readonly T[];
  loaded: boolean;
  hasMore: boolean;
  loadingFirst: boolean;
  loadingMore: boolean;
  /** Последняя первая страница не прочиталась; показанное не стёрто. */
  failed: boolean;
  /** Последняя дозагрузка не прочиталась; показанное и `hasMore` целы. */
  moreFailed: boolean;
}

/** Факты для поверхности: тексты анонса и разметка остаются у неё. */
export interface HistoryPageResult {
  /** Сколько записей операция добавила к показанным. */
  added: number;
  hasMore: boolean;
  failed: boolean;
  moreFailed: boolean;
  /** Загружено, но показывать нечего. */
  empty: boolean;
  /** Ответ отброшен `reset()`: по нему нельзя перерисовывать поверхность. */
  stale: boolean;
}

export interface HistoryPager<T extends CursorEntry> {
  state(): HistoryPagerState<T>;
  loadFirst(options?: { merge?: boolean }): Promise<HistoryPageResult>;
  refreshFirst(options?: { defer?: boolean }): Promise<HistoryPageResult>;
  loadMore(): Promise<HistoryPageResult>;
  /** Слить придержанные записи в показанные; вернуть их число. */
  showPending(): number;
  reset(): void;
  retryFirst(): Promise<HistoryPageResult>;
  retryMore(): Promise<HistoryPageResult>;
}

type FirstRequest = { kind: 'load'; merge: boolean } | { kind: 'refresh'; defer: boolean };

interface QueuedFirst {
  request: FirstRequest;
  settle: (result: HistoryPageResult) => void;
}

export function createHistoryPager<T extends CursorEntry>(
  fetchPage: FetchPage<T>
): HistoryPager<T> {
  let entries: T[] = [];
  let pending: T[] = [];
  let loaded = false;
  let hasMore = false;
  let loadingFirst = false;
  let loadingMore = false;
  let failed = false;
  let moreFailed = false;
  let generation = 0;
  let queued: QueuedFirst | null = null;

  function result(added = 0): HistoryPageResult {
    return {
      added,
      hasMore,
      failed,
      moreFailed,
      empty: loaded && entries.length === 0,
      stale: false,
    };
  }

  function staleResult(): HistoryPageResult {
    return { ...result(), added: 0, stale: true };
  }

  /** Один слот отложенной первой страницы: новый запрос вытесняет старый. */
  function queueFirst(request: FirstRequest): Promise<HistoryPageResult> {
    const previous = queued;
    queued = null;
    previous?.settle(staleResult());
    return new Promise((settle) => {
      queued = { request, settle };
    });
  }

  function runQueued(): void {
    const next = queued;
    queued = null;
    if (!next) return;
    const run =
      next.request.kind === 'load'
        ? loadFirst({ merge: next.request.merge })
        : refreshFirst({ defer: next.request.defer });
    void run.then(next.settle);
  }

  async function loadFirst(options: { merge?: boolean } = {}): Promise<HistoryPageResult> {
    const merge = options.merge === true;
    if (loadingFirst) return queueFirst({ kind: 'load', merge });
    const token = generation;
    loadingFirst = true;
    const page = await fetchPage(null);
    if (token !== generation) return staleResult();
    loadingFirst = false;
    let added = 0;
    if (!page.ok) {
      failed = true;
    } else {
      failed = false;
      loaded = true;
      const before = merge ? entries.length : 0;
      if (!merge) pending = [];
      entries = merge ? mergeHistory(entries, page.entries) : [...page.entries];
      added = merge ? entries.length - before : entries.length;
      hasMore = page.hasMore;
    }
    const outcome = result(added);
    runQueued();
    return outcome;
  }

  async function refreshFirst(options: { defer?: boolean } = {}): Promise<HistoryPageResult> {
    const defer = options.defer === true;
    if (loadingFirst) return queueFirst({ kind: 'refresh', defer });
    if (!loaded) return loadFirst();
    const token = generation;
    loadingFirst = true;
    const page = await fetchPage(null);
    if (token !== generation) return staleResult();
    loadingFirst = false;
    let added = 0;
    if (!page.ok) {
      failed = true;
    } else {
      failed = false;
      // Показанное и придержанное — одна история: свежая страница не должна
      // вернуть ни то, ни другое. Пагинацию (`hasMore`) живое обновление не
      // трогает: границу уже определил дозагруженный хвост.
      const known = new Set([...entries, ...pending].map((entry) => entry.id));
      const fresh = page.entries.filter((entry) => !known.has(entry.id));
      added = fresh.length;
      // Пустая свежая страница не трогает придержанное: если плашка видна,
      // её содержимым распоряжается кнопка, а не пустое обновление.
      if (fresh.length > 0) {
        if (defer) {
          pending = mergeHistory(pending, fresh);
        } else {
          entries = mergeHistory(entries, [...fresh, ...pending]);
          pending = [];
        }
      }
    }
    const outcome = result(added);
    runQueued();
    return outcome;
  }

  async function loadMore(): Promise<HistoryPageResult> {
    if (loadingFirst || loadingMore || !hasMore) return result();
    const cursor = historyCursor(entries);
    if (!cursor) {
      hasMore = false;
      return result();
    }
    const token = generation;
    loadingMore = true;
    const page = await fetchPage(cursor);
    if (token !== generation) return staleResult();
    loadingMore = false;
    if (!page.ok) {
      moreFailed = true;
      return result();
    }
    const before = entries.length;
    const next = appendHistory(entries, page.entries);
    entries = next;
    // `grew` защищает от вечного цикла, если страница целиком состоит из уже
    // показанных id: курсор не сдвинется, а транспорт продолжит говорить «есть
    // ещё».
    hasMore = page.hasMore && next.length > before;
    moreFailed = false;
    return result(next.length - before);
  }

  function showPending(): number {
    if (pending.length === 0) return 0;
    const count = pending.length;
    entries = mergeHistory(entries, pending);
    pending = [];
    return count;
  }

  function reset(): void {
    generation += 1;
    entries = [];
    pending = [];
    loaded = false;
    hasMore = false;
    loadingFirst = false;
    loadingMore = false;
    failed = false;
    moreFailed = false;
    const dropped = queued;
    queued = null;
    dropped?.settle(staleResult());
  }

  function state(): HistoryPagerState<T> {
    return {
      entries,
      pending,
      loaded,
      hasMore,
      loadingFirst,
      loadingMore,
      failed,
      moreFailed,
    };
  }

  return {
    state,
    loadFirst,
    refreshFirst,
    loadMore,
    showPending,
    reset,
    retryFirst: () => loadFirst(),
    retryMore: () => loadMore(),
  };
}
