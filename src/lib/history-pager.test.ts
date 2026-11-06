/**
 * Тесты пейджера истории: fake-fetch без DOM и сети.
 *
 * Шов один — публичные методы `history-pager`: страницы на входе, состояние и
 * факты для анонса на выходе. Курсор, слияние и дедуп — уже покрытое чистое
 * ядро `trade-history`; здесь проверяется автомат поверх него.
 */
import { describe, expect, it, vi } from 'vitest';
import { createHistoryPager, type HistoryPage } from './history-pager';

interface Row {
  id: number;
  created_at: string;
}

/** Запись с ненулевым временем: форма `CursorEntry`, которой хватает курсору. */
function row(id: number): Row {
  return { id, created_at: '2026-11-04T10:00:00.000Z' };
}

function page(ids: readonly number[], hasMore = false, ok = true): HistoryPage<Row> {
  return { ok, entries: ids.map(row), hasMore };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe('history-pager: первая страница', () => {
  it('заполняет записи, hasMore и loaded', async () => {
    const fetchPage = vi.fn(async () => page([3, 2, 1], true));
    const pager = createHistoryPager(fetchPage);

    const result = await pager.loadFirst();

    expect(fetchPage).toHaveBeenCalledWith(null);
    expect(pager.state()).toMatchObject({
      loaded: true,
      hasMore: true,
      loadingFirst: false,
      loadingMore: false,
      failed: false,
      moreFailed: false,
    });
    expect(pager.state().entries.map((entry) => entry.id)).toEqual([3, 2, 1]);
    expect(result).toEqual({
      added: 3,
      hasMore: true,
      failed: false,
      moreFailed: false,
      empty: false,
      stale: false,
    });
  });

  it('пустая первая страница — loaded и empty, а не ошибка', async () => {
    const pager = createHistoryPager(async () => page([], false));

    const result = await pager.loadFirst();

    expect(pager.state()).toMatchObject({ loaded: true, hasMore: false, failed: false });
    expect(result.empty).toBe(true);
  });

  it('слияние первой страницы не двигает пролистанное и не добавляет дубли', async () => {
    const pages = [page([3, 2], true), page([1, 0], false), page([5, 4, 3], false)];
    const pager = createHistoryPager(async () => pages.shift() ?? page([], false));

    await pager.loadFirst();
    await pager.loadMore();
    const result = await pager.loadFirst({ merge: true });

    expect(result.added).toBe(2);
    expect(pager.state().entries.map((entry) => entry.id)).toEqual([5, 4, 3, 2, 1, 0]);
    expect(pager.state().hasMore).toBe(false);
  });
});

describe('history-pager: дозагрузка', () => {
  it('конец истории: следующая страница не запрашивается', async () => {
    const fetchPage = vi.fn(async () => page([2, 1], false));
    const pager = createHistoryPager(fetchPage);
    await pager.loadFirst();

    const result = await pager.loadMore();

    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(result.added).toBe(0);
    expect(pager.state().entries.map((entry) => entry.id)).toEqual([2, 1]);
  });

  it('пустая следующая страница не меняет записи и выключает hasMore', async () => {
    const pages = [page([2, 1], true), page([], true)];
    const pager = createHistoryPager(async () => pages.shift() ?? page([], false));
    await pager.loadFirst();

    const result = await pager.loadMore();

    expect(result.added).toBe(0);
    expect(pager.state().entries.map((entry) => entry.id)).toEqual([2, 1]);
    expect(pager.state().hasMore).toBe(false);
  });

  it('дозагрузка не добавляет дубли по id', async () => {
    const pages = [page([3, 2], true), page([2, 1], true)];
    const pager = createHistoryPager(async () => pages.shift() ?? page([], false));
    await pager.loadFirst();

    const result = await pager.loadMore();

    expect(result.added).toBe(1);
    expect(pager.state().entries.map((entry) => entry.id)).toEqual([3, 2, 1]);
    expect(pager.state().hasMore).toBe(true);
  });

  it('полная страница из уже показанных записей выключает hasMore (grew guard)', async () => {
    const pages = [page([2, 1], true), page([2, 1], true)];
    const pager = createHistoryPager(async () => pages.shift() ?? page([], false));
    await pager.loadFirst();

    const result = await pager.loadMore();

    expect(result.added).toBe(0);
    expect(pager.state().entries.map((entry) => entry.id)).toEqual([2, 1]);
    expect(pager.state().hasMore).toBe(false);
  });

  it('без курсора (пустое время последней записи) hasMore выключается', async () => {
    const fetchPage = vi.fn(async () => ({
      ok: true,
      entries: [{ id: 1, created_at: '' }],
      hasMore: true,
    }));
    const pager = createHistoryPager(fetchPage);
    await pager.loadFirst();

    await pager.loadMore();

    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(pager.state().hasMore).toBe(false);
  });
});

describe('history-pager: ошибки и повтор', () => {
  it('ошибка первой страницы даёт failed и не стирает показанное', async () => {
    const responses: Array<HistoryPage<Row>> = [page([4, 3], true), page([], false, false)];
    const pager = createHistoryPager(async () => responses.shift() ?? page([], false));
    await pager.loadFirst();

    const result = await pager.loadFirst({ merge: true });

    expect(result.failed).toBe(true);
    expect(result.stale).toBe(false);
    expect(pager.state().failed).toBe(true);
    expect(pager.state().entries.map((entry) => entry.id)).toEqual([4, 3]);
  });

  it('retryFirst повторяет первую страницу и снимает failed', async () => {
    let attempt = 0;
    const fetchPage = vi.fn(async () => {
      attempt += 1;
      return attempt === 1 ? page([], false, false) : page([5], false);
    });
    const pager = createHistoryPager(fetchPage);

    await pager.loadFirst();
    expect(pager.state().failed).toBe(true);
    expect(pager.state().loaded).toBe(false);

    await pager.retryFirst();

    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(pager.state().failed).toBe(false);
    expect(pager.state().loaded).toBe(true);
    expect(pager.state().entries.map((entry) => entry.id)).toEqual([5]);
  });

  it('ошибка дозагрузки даёт moreFailed, записи и hasMore целы', async () => {
    const responses: Array<HistoryPage<Row>> = [page([3, 2], true), page([], false, false)];
    const pager = createHistoryPager(async () => responses.shift() ?? page([], false));
    await pager.loadFirst();

    const result = await pager.loadMore();

    expect(result.moreFailed).toBe(true);
    expect(result.added).toBe(0);
    expect(pager.state().moreFailed).toBe(true);
    expect(pager.state().entries.map((entry) => entry.id)).toEqual([3, 2]);
    expect(pager.state().hasMore).toBe(true);
  });

  it('retryMore повторяет дозагрузку с тем же курсором и снимает moreFailed', async () => {
    const calls: Array<{ created_at: string; id: number } | null> = [];
    let attempt = 0;
    const fetchPage = vi.fn(async (cursor: { created_at: string; id: number } | null) => {
      calls.push(cursor);
      if (cursor === null) return page([3, 2], true);
      attempt += 1;
      return attempt === 1 ? page([], false, false) : page([1], false);
    });
    const pager = createHistoryPager(fetchPage);
    await pager.loadFirst();

    await pager.loadMore();
    expect(pager.state().moreFailed).toBe(true);

    await pager.retryMore();

    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(calls[1]).toEqual({ created_at: '2026-11-04T10:00:00.000Z', id: 2 });
    expect(calls[2]).toEqual(calls[1]);
    expect(pager.state().moreFailed).toBe(false);
    expect(pager.state().entries.map((entry) => entry.id)).toEqual([3, 2, 1]);
  });

  it('дозагрузка не стартует, пока идёт первая страница', async () => {
    const first = deferred<HistoryPage<Row>>();
    const fetchPage = vi.fn(() => first.promise);
    const pager = createHistoryPager(fetchPage);
    const loading = pager.loadFirst();

    await pager.loadMore();

    expect(fetchPage).toHaveBeenCalledTimes(1);
    first.resolve(page([2, 1], true));
    await loading;
  });
});

describe('history-pager: поколение', () => {
  it('ответ старого поколения после reset игнорируется', async () => {
    const oldPage = deferred<HistoryPage<Row>>();
    const newPage = deferred<HistoryPage<Row>>();
    const fetchPage = vi
      .fn<() => Promise<HistoryPage<Row>>>()
      .mockImplementationOnce(() => oldPage.promise)
      .mockImplementationOnce(() => newPage.promise);
    const pager = createHistoryPager(fetchPage);

    const oldCall = pager.loadFirst();
    pager.reset();
    const newCall = pager.retryFirst();

    oldPage.resolve(page([9, 8], false));
    const oldResult = await oldCall;
    expect(oldResult.stale).toBe(true);
    expect(pager.state().entries).toEqual([]);
    expect(pager.state().loaded).toBe(false);

    newPage.resolve(page([2, 1], false));
    const newResult = await newCall;
    expect(newResult.stale).toBe(false);
    expect(pager.state().entries.map((entry) => entry.id)).toEqual([2, 1]);
  });

  it('reset очищает состояние и отложенную первую страницу', async () => {
    const first = deferred<HistoryPage<Row>>();
    const fetchPage = vi.fn(() => first.promise);
    const pager = createHistoryPager(fetchPage);
    const loading = pager.loadFirst();
    const queued = pager.refreshFirst();

    pager.reset();
    const queuedResult = await queued;
    expect(queuedResult.stale).toBe(true);

    first.resolve(page([9], true));
    await loading;
    expect(pager.state()).toMatchObject({
      entries: [],
      pending: [],
      loaded: false,
      hasMore: false,
      loadingFirst: false,
      loadingMore: false,
      failed: false,
      moreFailed: false,
    });
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('запрос во время загрузки идёт в одну отложенную очередь', async () => {
    const first = deferred<HistoryPage<Row>>();
    const second = deferred<HistoryPage<Row>>();
    let active = 0;
    let maxActive = 0;
    const fetchPage = vi.fn(() => {
      const attempt = fetchPage.mock.calls.length;
      active += 1;
      maxActive = Math.max(maxActive, active);
      const pending = attempt === 1 ? first : second;
      return pending.promise.then((value) => {
        active -= 1;
        return value;
      });
    });
    const pager = createHistoryPager(fetchPage);

    const initial = pager.loadFirst();
    const replaced = pager.refreshFirst({ defer: true });
    const queued = pager.loadFirst({ merge: true });

    // Параллельных первых страниц нет, а в очереди — только последний запрос.
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect((await replaced).stale).toBe(true);

    first.resolve(page([5], true));
    await initial;
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(pager.state().loadingFirst).toBe(true);

    second.resolve(page([6], true));
    const result = await queued;
    expect(result.stale).toBe(false);
    expect(pager.state().loadingFirst).toBe(false);
    expect(pager.state().entries.map((entry) => entry.id)).toEqual([6, 5]);
    expect(maxActive).toBe(1);
  });
});

describe('history-pager: свежие записи и плашка', () => {
  it('refreshFirst({ defer: true }) копит новые в pending, showPending сливает их', async () => {
    const pages = [page([3, 2], true), page([4, 3], true), page([5, 4], true), page([5], true)];
    const pager = createHistoryPager(async () => pages.shift() ?? page([], false));
    await pager.loadFirst();

    const first = await pager.refreshFirst({ defer: true });
    expect(first.added).toBe(1);
    expect(pager.state().entries.map((entry) => entry.id)).toEqual([3, 2]);
    expect(pager.state().pending.map((entry) => entry.id)).toEqual([4]);

    const second = await pager.refreshFirst({ defer: true });
    expect(second.added).toBe(1);
    expect(pager.state().pending.map((entry) => entry.id)).toEqual([5, 4]);

    expect(pager.showPending()).toBe(2);
    expect(pager.state().entries.map((entry) => entry.id)).toEqual([5, 4, 3, 2]);
    expect(pager.state().pending).toEqual([]);
    expect(pager.showPending()).toBe(0);
  });

  it('refreshFirst без defer вставляет новые сверху и забирает pending', async () => {
    const pages = [page([3, 2], true), page([4], true), page([5, 4], true)];
    const pager = createHistoryPager(async () => pages.shift() ?? page([], false));
    await pager.loadFirst();
    await pager.refreshFirst({ defer: true });
    expect(pager.state().pending.map((entry) => entry.id)).toEqual([4]);

    const result = await pager.refreshFirst();

    expect(result.added).toBe(1);
    expect(pager.state().entries.map((entry) => entry.id)).toEqual([5, 4, 3, 2]);
    expect(pager.state().pending).toEqual([]);
  });

  it('живое обновление не возвращает дубли показанных и придержанных', async () => {
    const pages = [page([3, 2], true), page([4, 3], true), page([4, 3], true)];
    const pager = createHistoryPager(async () => pages.shift() ?? page([], false));
    await pager.loadFirst();
    await pager.refreshFirst({ defer: true });

    const result = await pager.refreshFirst({ defer: true });

    expect(result.added).toBe(0);
    expect(pager.state().pending.map((entry) => entry.id)).toEqual([4]);
  });

  it('пустое живое обновление не трогает придержанное', async () => {
    const pages = [page([3, 2], true), page([4, 3], true), page([4, 3], true)];
    const pager = createHistoryPager(async () => pages.shift() ?? page([], false));
    await pager.loadFirst();
    await pager.refreshFirst({ defer: true });

    const result = await pager.refreshFirst();

    expect(result.added).toBe(0);
    expect(pager.state().entries.map((entry) => entry.id)).toEqual([3, 2]);
    expect(pager.state().pending.map((entry) => entry.id)).toEqual([4]);
  });

  it('loadFirst заменяет записи и сбрасывает придержанное', async () => {
    const pages = [page([3, 2], true), page([4, 3], true), page([9], false)];
    const pager = createHistoryPager(async () => pages.shift() ?? page([], false));
    await pager.loadFirst();
    await pager.refreshFirst({ defer: true });
    expect(pager.state().pending.map((entry) => entry.id)).toEqual([4]);

    await pager.loadFirst();

    expect(pager.state().entries.map((entry) => entry.id)).toEqual([9]);
    expect(pager.state().pending).toEqual([]);
  });

  it('ошибка живого обновления не стирает показанное', async () => {
    const pages = [page([3, 2], true), page([], false, false)];
    const pager = createHistoryPager(async () => pages.shift() ?? page([], false));
    await pager.loadFirst();

    const result = await pager.refreshFirst({ defer: true });

    expect(result.failed).toBe(true);
    expect(pager.state().entries.map((entry) => entry.id)).toEqual([3, 2]);
    expect(pager.state().pending).toEqual([]);
  });
});
