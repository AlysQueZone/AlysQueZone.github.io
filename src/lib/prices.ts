/**
 * Прайс-фид «лот + следующая цена» (тикет 11, pivkoiny-backend).
 *
 * N считает БД (вью `lots_with_next_price` — зеркало формулы BEFORE-триггера
 * `enforce_purchase_rules`), клиент только читает и перечитывает:
 * - список — для кнопок «Забрать за N» (витрина, колокол, уведомления);
 * - одну строку — свежий select перед записью покупки и live-проекция цены
 *   в открытой модалке (см. BuyModal).
 * Итог покупки всегда — `price_paid` сервера, не staged N.
 *
 * Живой тик даёт таблица `lots` (уже в realtime-публикации): вью в публикацию
 * не входит, поэтому подписка — через `subscribeSharedLots`, по событию
 * клиент перечитывает вью. Отдельного ретрая нет — обновление бесшовное.
 *
 * Деградация: вью отсутствует (миграция ещё не применена) — фолбэк на таблицу
 * `lots` с `nextPrice = null` (клиентской формулы нет и не будет): показ рисует
 * прочерк/«…» вместо текущей цены как N — показ не врёт на шаг; сервер
 * при записи всё равно подтвердит настоящую цену.
 * Секретов здесь нет: только publishable-ключ через getSupabase().
 */

import { getSupabase, subscribeSharedLots } from './supabase.ts';

/**
 * Живая цена лота: текущая + следующая (та, что уйдёт серверу).
 * nextPrice null — N неизвестна (вью отсутствует): показывать «…», не price.
 */
export interface LotPrice {
  slug: string;
  price: number;
  nextPrice: number | null;
  owner_login: string | null;
  owner_uid: string | null;
}

const VIEW = 'lots_with_next_price';

type PriceRow = Record<string, unknown>;

function toLotPrice(row: PriceRow): LotPrice | null {
  const slug = row['slug'];
  const price = Number(row['price']);
  const nextPrice = Number(row['next_price']);
  if (typeof slug !== 'string' || !Number.isFinite(price)) return null;
  return {
    slug,
    price,
    nextPrice: Number.isFinite(nextPrice) && nextPrice > 0 ? nextPrice : null,
    owner_login: typeof row['owner_login'] === 'string' ? (row['owner_login'] as string) : null,
    owner_uid: typeof row['owner_uid'] === 'string' ? (row['owner_uid'] as string) : null,
  };
}

/** Все живые цены одним запросом (витрина, колокол). Ошибка → пустая карта. */
export async function fetchLotPrices(): Promise<Map<string, LotPrice>> {
  const empty = new Map<string, LotPrice>();
  const sb = getSupabase();
  if (!sb) return empty;
  try {
    const fromView = await sb
      .from(VIEW)
      .select('slug,price,next_price,owner_login,owner_uid');
    if (!fromView.error && Array.isArray(fromView.data)) {
      const map = new Map<string, LotPrice>();
      for (const row of fromView.data as unknown as PriceRow[]) {
        const state = toLotPrice(row);
        if (state) map.set(state.slug, state);
      }
      return map;
    }
  } catch {
    // вью нет — фолбэк ниже
  }
  try {
    const legacy = await sb.from('lots').select('slug,price,owner_login,owner_uid');
    if (legacy.error || !Array.isArray(legacy.data)) return empty;
    const map = new Map<string, LotPrice>();
    for (const row of legacy.data as unknown as PriceRow[]) {
      const slug = row['slug'];
      const price = Number(row['price']);
      if (typeof slug !== 'string' || !Number.isFinite(price)) continue;
      map.set(slug, {
        slug,
        price,
        nextPrice: null,
        owner_login: typeof row['owner_login'] === 'string' ? (row['owner_login'] as string) : null,
        owner_uid: typeof row['owner_uid'] === 'string' ? (row['owner_uid'] as string) : null,
      });
    }
    return map;
  } catch {
    return empty;
  }
}

/** Свежая строка цены одного лота (перед записью / проекция модалки). */
export async function fetchLotPrice(slug: string): Promise<LotPrice | null> {
  const sb = getSupabase();
  if (!sb) return null;
  try {
    const fromView = await sb
      .from(VIEW)
      .select('slug,price,next_price,owner_login,owner_uid')
      .eq('slug', slug)
      .single();
    if (!fromView.error && fromView.data) {
      return toLotPrice(fromView.data as unknown as PriceRow);
    }
  } catch {
    // вью нет — фолбэк ниже
  }
  try {
    const legacy = await sb
      .from('lots')
      .select('slug,price,owner_login,owner_uid')
      .eq('slug', slug)
      .single();
    if (legacy.error || !legacy.data) return null;
    const row = legacy.data as unknown as PriceRow;
    const price = Number(row['price']);
    if (typeof row['slug'] !== 'string' || !Number.isFinite(price)) return null;
    return {
      slug: row['slug'] as string,
      price,
      nextPrice: null,
      owner_login: typeof row['owner_login'] === 'string' ? (row['owner_login'] as string) : null,
      owner_uid: typeof row['owner_uid'] === 'string' ? (row['owner_uid'] as string) : null,
    };
  } catch {
    return null;
  }
}

/** Свежая N одного лота (перед записью). null — N неизвестна (вью нет) или перечитать не вышло, пишем по staged. */
export async function fetchNextPrice(slug: string): Promise<number | null> {
  const row = await fetchLotPrice(slug);
  if (!row || typeof row.nextPrice !== 'number' || !Number.isFinite(row.nextPrice) || row.nextPrice <= 0) return null;
  return row.nextPrice;
}

/**
 * Комиссия биржи — display-mirror серверной формулы (тикет 01, ставка одним
 * числом в public.commission_rate(), review-fix US-17): ceil(7%), минимум 1,
 * платит продавец из выручки. Только для показа «получено N − комиссия»
 * в уведомлениях и правилах, деньги считает только БД.
 */
export const COMMISSION_RATE = 0.07;

export function commissionFor(pricePaid: number): number {
  if (!Number.isFinite(pricePaid) || pricePaid <= 0) return 0;
  return Math.max(1, Math.ceil(pricePaid * COMMISSION_RATE));
}

/**
 * Живая подписка на цены: тик таблицы `lots` → перечитать вью.
 * Без настроенного хранилища — noop-отписка. Возвращает функцию отписки.
 */
export function subscribeLotPrices(onChange: () => void, slug?: string): () => void {
  return subscribeSharedLots(onChange, slug);
}
