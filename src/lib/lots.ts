import { createClient } from '@supabase/supabase-js';

import { getSupabase, subscribeSharedLots } from './supabase';

/**
 * Лот каталога: выставленный на бирже привет с видео.
 *
 * Каталог живёт в БД (таблица public.lots), статики больше нет.
 * `id` = slug из БД.
 */
export interface Lot {
  id: string;
  title: string;
  owner: string | null;
  price: number;
  video_url?: string | null;
}

/**
 * Живое состояние Лота: каталог + прайс-фид + флаг «мой» за один запрос.
 *
 * Раньше понятие было разорвано на три шва: SSG-каталог здесь же,
 * shared-состояния в supabase.ts и живые цены в prices.ts — витрина делала
 * два запроса и сшивала карты вручную. Теперь один запрос к вью
 * `lots_with_next_price` (N считает БД тем же выражением, что и
 * BEFORE-триггер, клиент формулы не знает и не хранит).
 *
 * nextPrice null — N неизвестна (вью отсутствует, читаем таблицу lots):
 * показ рисует «…», а не price. mine — owner_uid == uid сессии
 * (uid передаёт caller, модуль сессию не читает).
 */
export interface LotState {
  slug: string;
  title: string;
  video_url: string | null;
  price: number;
  nextPrice: number | null;
  owner_login: string | null;
  owner_uid: string | null;
  mine: boolean;
}

function buildEnv(): { url: string; key: string } {
  const url = import.meta.env.PUBLIC_SUPABASE_URL as string | undefined;
  const key = import.meta.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY as string | undefined;
  if (!url || !key) {
    throw new Error(
      'SSG каталога требует PUBLIC_SUPABASE_URL и PUBLIC_SUPABASE_PUBLISHABLE_KEY ' +
        '(тикет 09): каталог — из БД, статического фолбэка нет.'
    );
  }
  return { url, key };
}

type LotRow = Record<string, unknown>;

function str(row: LotRow, key: string): string | null {
  const value = row[key];
  return typeof value === 'string' ? value : null;
}

function toLot(row: LotRow): Lot | null {
  const slug = row['slug'];
  const title = row['title'];
  const price = Number(row['price']);
  if (typeof slug !== 'string' || typeof title !== 'string' || !Number.isFinite(price)) {
    return null;
  }
  return {
    id: slug,
    title,
    owner: str(row, 'owner_login'),
    price,
    video_url: str(row, 'video_url'),
  };
}

function toLotState(row: LotRow, uid: string | null): LotState | null {
  const slug = row['slug'];
  const price = Number(row['price']);
  if (typeof slug !== 'string' || !Number.isFinite(price)) return null;
  const nextRaw = Number(row['next_price']);
  const owner_uid = str(row, 'owner_uid');
  return {
    slug,
    title: str(row, 'title') ?? slug,
    video_url: str(row, 'video_url'),
    price,
    nextPrice: Number.isFinite(nextRaw) && nextRaw > 0 ? nextRaw : null,
    owner_login: str(row, 'owner_login'),
    owner_uid,
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

const VIEW = 'lots_with_next_price';
const VIEW_COLUMNS = 'slug,title,video_url,price,owner_login,owner_uid,next_price';
const TABLE_COLUMNS = 'slug,title,video_url,price,owner_login,owner_uid';

/**
 * Каталог для SSG на билде — только из БД через PUBLIC_SUPABASE_*.
 * Без env кидает явно (статического фолбэка нет).
 */
export async function fetchCatalogLots(): Promise<Lot[]> {
  const { url, key } = buildEnv();
  const sb = createClient(url, key);
  // Таймаут на случай stall сети: билд должен падать явно, а не висеть.
  // NB: postgrest-js игнорирует `signal` в опциях .select() — рабочий API
  // только .abortSignal() (тикет 11, drive-by: иначе SSG виснет навсегда).
  const signal = AbortSignal.timeout(20000);
  const full = await sb
    .from('lots')
    .select('slug,title,video_url,price,owner_login,owner_uid,updated_at')
    .abortSignal(signal);
  if (full.error || !Array.isArray(full.data)) {
    throw new Error(
      `SSG каталога: не смог прочитать таблицу lots из БД: ${full.error?.message ?? 'unknown'}`
    );
  }
  const lots = (full.data as unknown as LotRow[]).flatMap((row) => {
    const lot = toLot(row);
    return lot ? [lot] : [];
  });
  // Витрина по умолчанию — от дешёвых к дорогим (ребаланс: новичок первым
  // делом видит доступные лоты). Живой ресорт поверх Realtime не делаем —
  // порядок первого экрана задаёт SSG.
  return lots.sort((a, b) => a.price - b.price);
}

/**
 * Весь живой каталог одним запросом (витрина, колокол, уведомления).
 * Вью отсутствует (миграция ещё не применена) — фолбэк на таблицу `lots`
 * с nextPrice null (клиентской формулы нет и не будет).
 * Ошибка или ненастроенное хранилище → пустая карта. Секретов здесь нет:
 * только publishable-ключ через getSupabase().
 */
export async function fetchLotCatalog(uid: string | null): Promise<Map<string, LotState>> {
  const empty = new Map<string, LotState>();
  const sb = getSupabase();
  if (!sb) return empty;
  try {
    const fromView = await sb.from(VIEW).select(VIEW_COLUMNS);
    if (!fromView.error && Array.isArray(fromView.data)) {
      return fillCatalog(fromView.data, uid);
    }
  } catch {
    // вью нет — фолбэк ниже
  }
  try {
    const fromTable = await sb.from('lots').select(TABLE_COLUMNS);
    if (fromTable.error || !Array.isArray(fromTable.data)) return empty;
    return fillCatalog(fromTable.data, uid);
  } catch {
    return empty;
  }
}

/**
 * Живое состояние одного Лота (проекция модалки, свежая N перед записью).
 * null — строки нет, вью и таблица недоступны или хранилище не настроено.
 */
export async function fetchLotState(slug: string, uid: string | null): Promise<LotState | null> {
  const sb = getSupabase();
  if (!sb) return null;
  try {
    const fromView = await sb.from(VIEW).select(VIEW_COLUMNS).eq('slug', slug).single();
    if (!fromView.error && fromView.data) {
      return toLotState(fromView.data as unknown as LotRow, uid);
    }
  } catch {
    // вью нет — фолбэк ниже
  }
  try {
    const fromTable = await sb.from('lots').select(TABLE_COLUMNS).eq('slug', slug).single();
    if (fromTable.error || !fromTable.data) return null;
    return toLotState(fromTable.data as unknown as LotRow, uid);
  } catch {
    return null;
  }
}

/**
 * Живая подписка на смену Лотов: тик таблицы `lots` (вью в Realtime-публикацию
 * не входит, поэтому по событию caller перечитывает каталог — см.
 * fetchLotCatalog). Без настроенного хранилища — noop-отписка.
 * Возвращает функцию отписки.
 */
export function subscribeLots(onChange: () => void, slug?: string): () => void {
  return subscribeSharedLots(onChange, slug);
}
