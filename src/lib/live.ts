/**
 * Живые данные страницы: транспорт, читатели и единственный вход.
 *
 * Единственный владелец живых данных: `sb.channel()` и window-шина
 * (`alysque:balance`/`alysque:bought`) вне этого модуля не живут
 * (docs/adr/0003). Здесь — Supabase-транспорт, чтения (uid, баланс, каталог,
 * страница витрины, мои приветы, один Лот) и триггеры перезапроса (тик таблиц,
 * фокус/возврат, смена сессии, своя покупка); состояние, коалесцинг и доменные
 * события — в чистом ядре src/lib/live-store.ts.
 *
 * Поверхности читают снапшот синхронно (`live.uid()`, `live.balance()`,
 * `live.catalog()`, `live.lot(slug)`, …) и подписываются на изменения
 * (`live.subscribe`); денежные гейты (гамба, покупка) просят явную свежесть
 * (`live.refreshBalance()`, `live.refreshLot(slug)`). Витрина `/lots/`
 * включает страницы (`live.useCatalogPages`) и «Мои приветы»
 * (`live.trackMyLots`); остальные страницы читают каталог целиком
 * (docs/adr/0012). Модуль сам поднимается на первом subscribe / refresh /
 * report — отдельного «старта» у поверхностей нет.
 */
import { getSupabase, withAuthRetry } from './supabase';
import type { CatalogCursor } from './catalog-page';
import { createLiveRegistry, type LivePayload, type LiveTransport } from './live-core';
import {
  createLiveStore,
  normalizeNextPrice,
  type CatalogMoreResult,
  type CatalogPageRead,
  type CatalogRead,
  type LiveChange,
  type LiveReaders,
  type LivePurchase,
  type LotState,
  type LotStateRead,
} from './live-store';

export type { LiveChange, LiveOutbid, LotState } from './live-store';
export { normalizeNextPrice } from './live-store';

// ---------------------------------------------------------------------------
// Читатели Supabase: каталог + «мой» флаг за один запрос к вью
// `lots_with_next_price` (N считает БД тем же выражением, что и BEFORE-триггер,
// клиент формулы не знает и не хранит).
// ---------------------------------------------------------------------------

type LotRow = Record<string, unknown>;

function str(row: LotRow, key: string): string | null {
  const value = row[key];
  return typeof value === 'string' ? value : null;
}

function toLotState(row: LotRow, uid: string | null): LotState | null {
  const slug = row['slug'];
  const price = Number(row['price']);
  if (typeof slug !== 'string' || !Number.isFinite(price)) return null;
  const owner_uid = str(row, 'owner_uid');
  return {
    slug,
    title: str(row, 'title') ?? slug,
    video_url: str(row, 'video_url'),
    price,
    nextPrice: normalizeNextPrice(row['next_price']),
    owner_login: str(row, 'owner_login'),
    owner_uid,
    suggested_by_login: str(row, 'suggested_by_login'),
    mine: uid !== null && owner_uid !== null && owner_uid === uid,
  };
}

function fillCatalog(rows: unknown, uid: string | null): Map<string, LotState> {
  const map = new Map<string, LotState>();
  if (!Array.isArray(rows)) return map;
  for (const row of rows as LotRow[]) {
    const state = toLotState(row, uid);
    if (state) map.set(state.slug, state);
  }
  return map;
}

/** Строки страницы в порядке БД (цена, slug): курсор и окно держатся за него. */
function fillCatalogList(rows: unknown, uid: string | null): LotState[] {
  if (!Array.isArray(rows)) return [];
  const list: LotState[] = [];
  for (const row of rows as LotRow[]) {
    const state = toLotState(row, uid);
    if (state) list.push(state);
  }
  return list;
}

/** Баланс из значения строки БД: конечное ≥ 0, иначе null (деньги целы). */
function normalizeBalance(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const VIEW = 'lots_with_next_price';
const VIEW_COLUMNS =
  'slug,title,video_url,price,owner_login,owner_uid,suggested_by_login,next_price';
const TABLE_COLUMNS = 'slug,title,video_url,price,owner_login,owner_uid,suggested_by_login';

/**
 * Сколько slug уходит в один `.in(...)`: длинный список не должен упираться
 * в предел длины URL. Окно витрины обычно укладывается в один запрос.
 */
const SLUGS_CHUNK = 100;

/** Читатели живых данных поверх Supabase (ядро зовёт их, DOM/сети не знает). */
function supabaseReaders(): LiveReaders {
  return {
    async readUid(): Promise<string | null> {
      const sb = getSupabase();
      if (!sb) return null;
      try {
        const { data } = await sb.auth.getSession();
        return data.session?.user.id ?? null;
      } catch {
        return null;
      }
    },

    async readBalance(uid: string): Promise<number | null> {
      const sb = getSupabase();
      if (!sb) return null;
      try {
        const { data, error } = await withAuthRetry(() =>
          sb.from('profiles').select('balance').eq('user_id', uid).single()
        );
        if (error || !data) return null;
        return normalizeBalance((data as unknown as { balance: unknown }).balance);
      } catch {
        return null;
      }
    },

    /**
     * Весь каталог одним запросом. Вью отсутствует (миграция ещё не применена) —
     * фолбэк на таблицу `lots` с nextPrice null (клиентской формулы нет и не будет).
     * Ошибка/ненастроенное хранилище → `ok: false` (витрина отличает «пусто» от
     * «не загрузилось»). Секретов здесь нет: только publishable-ключ.
     */
    async readCatalog(uid: string | null): Promise<CatalogRead> {
      const empty = new Map<string, LotState>();
      const sb = getSupabase();
      if (!sb) return { ok: false, states: empty };
      try {
        const fromView = await withAuthRetry(() => sb.from(VIEW).select(VIEW_COLUMNS));
        if (!fromView.error && Array.isArray(fromView.data)) {
          return { ok: true, states: fillCatalog(fromView.data, uid) };
        }
      } catch {
        // вью нет — фолбэк ниже
      }
      try {
        const fromTable = await withAuthRetry(() => sb.from('lots').select(TABLE_COLUMNS));
        if (fromTable.error || !Array.isArray(fromTable.data)) return { ok: false, states: empty };
        return { ok: true, states: fillCatalog(fromTable.data, uid) };
      } catch {
        return { ok: false, states: empty };
      }
    },

    /**
     * Одна страница витрины после курсора (null — первая). Keyset по паре
     * `(price, slug)`: цена меняется от перекупов, slug добивает ничью и
     * держит границу страниц на месте (offset бы сдвинулся живой вставкой).
     * Вью отсутствует — фолбэк на таблицу, как у полного каталога.
     */
    async readCatalogPage(
      uid: string | null,
      cursor: CatalogCursor | null,
      limit: number
    ): Promise<CatalogPageRead> {
      const sb = getSupabase();
      if (!sb) return { ok: false, states: [] };
      const cap = Math.max(1, Math.floor(limit));
      const read = (table: string, columns: string) => {
        let query = sb
          .from(table)
          .select(columns)
          .order('price', { ascending: true })
          .order('slug', { ascending: true })
          .limit(cap);
        if (cursor) {
          query = query.or(
            `price.gt.${cursor.price},and(price.eq.${cursor.price},slug.gt.${cursor.slug})`
          );
        }
        return query;
      };
      try {
        const fromView = await withAuthRetry(() => read(VIEW, VIEW_COLUMNS));
        if (!fromView.error && Array.isArray(fromView.data)) {
          return { ok: true, states: fillCatalogList(fromView.data, uid) };
        }
      } catch {
        // вью нет — фолбэк ниже
      }
      try {
        const fromTable = await withAuthRetry(() => read('lots', TABLE_COLUMNS));
        if (fromTable.error || !Array.isArray(fromTable.data)) return { ok: false, states: [] };
        return { ok: true, states: fillCatalogList(fromTable.data, uid) };
      } catch {
        return { ok: false, states: [] };
      }
    },

    /**
     * Загруженное окно по slug: освежить цены/владельцев и узнать удалённые
     * (строка не вернулась). Списки длинные — режем на пачки по `SLUGS_CHUNK`.
     */
    async readCatalogBySlugs(uid: string | null, slugs: readonly string[]): Promise<CatalogRead> {
      const states = new Map<string, LotState>();
      const sb = getSupabase();
      if (!sb) return { ok: false, states };
      const list = [...new Set(slugs)];
      for (let i = 0; i < list.length; i += SLUGS_CHUNK) {
        const chunk = list.slice(i, i + SLUGS_CHUNK);
        try {
          const fromView = await withAuthRetry(() =>
            sb.from(VIEW).select(VIEW_COLUMNS).in('slug', chunk)
          );
          if (!fromView.error && Array.isArray(fromView.data)) {
            for (const [slug, state] of fillCatalog(fromView.data, uid)) states.set(slug, state);
            continue;
          }
        } catch {
          // вью нет — фолбэк ниже
        }
        try {
          const fromTable = await withAuthRetry(() =>
            sb.from('lots').select(TABLE_COLUMNS).in('slug', chunk)
          );
          if (fromTable.error || !Array.isArray(fromTable.data)) {
            return { ok: false, states: new Map() };
          }
          for (const [slug, state] of fillCatalog(fromTable.data, uid)) states.set(slug, state);
        } catch {
          return { ok: false, states: new Map() };
        }
      }
      return { ok: true, states };
    },

    /**
     * Все мои лоты: окно витрины может их не содержать, поэтому это отдельный
     * полный запрос владельца (не фильтр загруженных страниц). Порядок — витрины.
     */
    async readMyLots(uid: string): Promise<CatalogRead> {
      const empty = new Map<string, LotState>();
      const sb = getSupabase();
      if (!sb) return { ok: false, states: empty };
      try {
        const fromView = await withAuthRetry(() =>
          sb
            .from(VIEW)
            .select(VIEW_COLUMNS)
            .eq('owner_uid', uid)
            .order('price', { ascending: true })
            .order('slug', { ascending: true })
        );
        if (!fromView.error && Array.isArray(fromView.data)) {
          return { ok: true, states: fillCatalog(fromView.data, uid) };
        }
      } catch {
        // вью нет — фолбэк ниже
      }
      try {
        const fromTable = await withAuthRetry(() =>
          sb
            .from('lots')
            .select(TABLE_COLUMNS)
            .eq('owner_uid', uid)
            .order('price', { ascending: true })
            .order('slug', { ascending: true })
        );
        if (fromTable.error || !Array.isArray(fromTable.data)) return { ok: false, states: empty };
        return { ok: true, states: fillCatalog(fromTable.data, uid) };
      } catch {
        return { ok: false, states: empty };
      }
    },

    /**
     * Один Лот (проекция модалки, свежая N перед записью). `maybeSingle` вместо
     * `single`: отсутствие строки — это null без ошибки, а не PostgREST 406.
     */
    async readLot(slug: string, uid: string | null): Promise<LotStateRead> {
      const sb = getSupabase();
      if (!sb) return { ok: false, state: null };
      try {
        const fromView = await withAuthRetry(() =>
          sb.from(VIEW).select(VIEW_COLUMNS).eq('slug', slug).maybeSingle()
        );
        if (!fromView.error && fromView.data) {
          return { ok: true, state: toLotState(fromView.data as unknown as LotRow, uid) };
        }
      } catch {
        // вью нет — фолбэк ниже
      }
      try {
        const fromTable = await withAuthRetry(() =>
          sb.from('lots').select(TABLE_COLUMNS).eq('slug', slug).maybeSingle()
        );
        if (!fromTable.error && fromTable.data) {
          return { ok: true, state: toLotState(fromTable.data as unknown as LotRow, uid) };
        }
        if (!fromTable.error) return { ok: true, state: null };
        return { ok: false, state: null };
      } catch {
        return { ok: false, state: null };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Транспорт Realtime: реестр каналов ядра, канал на «таблица+событие+
// фильтр», реф-каунт долей.
// ---------------------------------------------------------------------------

/** Живой транспорт поверх Supabase Realtime (postgres_changes). */
function supabaseTransport(): LiveTransport {
  return {
    open(sub, onPayload) {
      try {
        const sb = getSupabase();
        if (!sb) return null;
        const topic = `alysque:live:${sub.table}:${sub.event}:${sub.filter ?? 'all'}`;
        const filter = {
          event: sub.event,
          schema: 'public',
          table: sub.table,
          ...(sub.filter ? { filter: sub.filter } : {}),
        };
        const channel = sb
          .channel(topic, { config: { broadcast: { self: false } } })
          .on('postgres_changes', filter, (payload) => onPayload(payload as LivePayload))
          .subscribe();
        return () => {
          try {
            void sb.removeChannel(channel);
          } catch {
            // отписка — best effort
          }
        };
      } catch {
        // хранилище не настроено или канал не открылся — вызывающий повторит
        return null;
      }
    },
  };
}

const registry = createLiveRegistry(supabaseTransport());
const store = createLiveStore(supabaseReaders());

/** Баланс из payload профиля: строка видна только своя (RLS) — без чтения. */
function balanceFromPayload(payload: LivePayload): number | null {
  const row = (payload.new ?? {}) as Record<string, unknown>;
  return normalizeBalance(row['balance']);
}

let wired = false;

/** Поднять модуль: каналы, слушатели сессии и триггеры. Повторный вызов — noop. */
function ensureWired(): void {
  if (wired) return;
  wired = true;

  // Своя строка профиля: канал с фильтром по uid; при смене сессии — переоткрыть.
  let profileUnsub: (() => void) | null = null;
  const openProfile = (uid: string | null): void => {
    profileUnsub?.();
    profileUnsub = null;
    if (!uid) return;
    profileUnsub = registry.subscribe(
      { table: 'profiles', event: '*', filter: `user_id=eq.${uid}` },
      (payload) => {
        const value = balanceFromPayload(payload);
        if (value !== null) store.reportBalance(value);
      }
    );
  };
  store.subscribe((change) => {
    if (change.kind === 'uid') openProfile(change.uid);
  });

  // Тик лотов — каталог и цены (вью в Realtime-публикацию не входит, поэтому
  // по событию перечитываем); payload нужен окну витрины для новых лотов.
  registry.subscribe({ table: 'lots', event: '*' }, (payload) => {
    void store.reportLotsTick(payload);
  });
  registry.subscribe(
    { table: 'purchases', event: 'INSERT' },
    (payload) => void store.reportDeal(payload)
  );

  // Триггеры перезапроса — у модуля: возврат на вкладку и фокус — один синк.
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) void store.sync();
    });
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('focus', () => void store.sync());
  }

  // Смена сессии: uid снапшота, «мой» флаг каталога пересобирается без сети,
  // баланс перечитывается (смена uid — не сделка, каталог не перечитываем).
  getSupabase()?.auth.onAuthStateChange((_event, session) => {
    store.applyUid(session?.user.id ?? null);
  });

  // Первое чтение — после DOMContentLoaded: к этому моменту все стартовые
  // скрипты страницы подписались и увидят события снапшота (иначе uid/баланс
  // успевают прийти между модулями, и поверхность ждёт следующего события).
  // Если страница уже догрузилась (скрипт поднялся позже) — читаем сразу.
  if (typeof document !== 'undefined' && document.readyState !== 'complete') {
    document.addEventListener('DOMContentLoaded', () => void store.start(), { once: true });
  } else {
    void store.start();
  }
}

/** Снапшот и подписка: поверхности читают синхронно, слушают изменения. */
export const live = {
  uid: (): string | null => store.uid(),
  balance: (): number | null => store.balance(),
  balanceKnown: (): boolean => store.balanceKnown(),
  catalog: (): ReadonlyMap<string, LotState> => store.catalog(),
  catalogWindow: (): readonly LotState[] => store.catalogWindow(),
  catalogHasMore: (): boolean => store.catalogHasMore(),
  lot: (slug: string): LotState | null => store.lot(slug),
  catalogKnown: (): boolean => store.catalogKnown(),
  catalogOk: (): boolean => store.catalogOk(),
  myLots: (): readonly LotState[] => store.myLots(),
  myLotsKnown: (): boolean => store.myLotsKnown(),

  /**
   * Витрина листается страницами: до первого чтения. Вызывать на /lots/
   * до подписки — главная и страница лота читают каталог целиком, как раньше.
   */
  useCatalogPages(pageSize?: number): void {
    // Режим — до ensureWired: иначе первое чтение может стартовать полным.
    store.useCatalogPages(pageSize);
    ensureWired();
  },

  /** Догрузить следующую страницу витрины (общая дорожка на всех вызывающих). */
  loadCatalogPage(): Promise<CatalogMoreResult> {
    ensureWired();
    return store.loadCatalogPage();
  },

  /** Дочитать страницы, пока лот не окажется в окне (возврат к покупке). */
  ensureCatalogLot(slug: string): Promise<LotState | null> {
    ensureWired();
    return store.ensureCatalogLot(slug);
  },

  /** «Мои приветы» полным списком владельца — включает отдельный запрос. */
  trackMyLots(): void {
    store.trackMyLots();
    ensureWired();
  },

  subscribe(cb: (change: LiveChange) => void): () => void {
    ensureWired();
    return store.subscribe(cb);
  },

  /** Явная свежесть баланса для денежных гейтов: свежее число или null. */
  refreshBalance(): Promise<number | null> {
    ensureWired();
    return store.refreshBalance();
  },

  /** Явная свежесть одного Лота (перед покупкой и в модалке). */
  refreshLot(slug: string): Promise<LotState | null> {
    ensureWired();
    return store.refreshLot(slug);
  },

  /**
   * Придержать баланс под церемонию (гамба): оба источника (серверный ответ
   * и тик профиля) копятся, снапшот и чип раскрываются на release. Возвращает
   * идемпотентный release — конец крутки, закрытие окна или ошибка.
   */
  deferBalance(): () => void {
    ensureWired();
    return store.deferBalance();
  },

  /** Серверный баланс (гамба, ежедневный вход): точное значение — в снапшот. */
  reportBalance(value: number): void {
    ensureWired();
    store.reportBalance(value);
  },

  /** Своя покупка (из buyLot): событие и перечитка каталога с балансом. */
  reportPurchase(purchase: LivePurchase): Promise<void> {
    ensureWired();
    return store.reportPurchase(purchase);
  },
};
