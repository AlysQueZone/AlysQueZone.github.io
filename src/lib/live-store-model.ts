/**
 * Словарь снапшота живых данных: типы и чистые правила трёх владельцев.
 *
 * Здесь нет состояния, DOM и сети — только форма Лота, ответы читателей,
 * доменные события и общие правила сравнения/слияния. Публичные типы фасада
 * реэкспортируются из `live-store.ts`; решение — docs/adr/0003, срез каталога —
 * docs/adr/0012.
 */

import type { CatalogCursor } from './catalog-page';

export interface LotState {
  slug: string;
  title: string;
  video_url: string | null;
  price: number;
  nextPrice: number | null;
  owner_login: string | null;
  owner_uid: string | null;
  /** Ник автора принятой заявки — только подробности лота, в списках не показываем. */
  suggested_by_login: string | null;
}

/** Ответ чтения каталога: ok — «ответ от БД получен», пустой каталог ≠ ошибка. */
export interface CatalogRead {
  ok: boolean;
  states: Map<string, LotState>;
}

/** Ответ чтения страницы витрины: строки в порядке показа (цена, slug). */
export interface CatalogPageRead {
  ok: boolean;
  states: LotState[];
  /** За последней строкой есть ещё (читатель берёт на одну строку больше). */
  hasMore: boolean;
}

/** Ответ случайной выборки: строки в том порядке, в каком их отдала БД. */
export interface CatalogListRead {
  ok: boolean;
  states: LotState[];
}

/** Итог подгрузки страницы витрины: ок — дописана, end — больше нет, error — БД/сеть. */
export type CatalogMoreResult = 'ok' | 'end' | 'error';

/** Ответ чтения одного Лота: нет строки ≠ БД недоступна. */
export interface LotStateRead {
  ok: boolean;
  state: LotState | null;
}

/** Читатели, которыми владеет live.ts (Supabase); ядро только зовёт их. */
export interface LiveReaders {
  /** uid текущей сессии; null — гость / хранилище не настроено. */
  readUid(): Promise<string | null>;
  /** Свой баланс; null — не прочитался / строки нет / гость. */
  readBalance(uid: string): Promise<number | null>;
  /** Случайная выборка для главной: строки в порядке, в каком их отдала БД. */
  readRandomLots(limit: number): Promise<CatalogListRead>;
  /**
   * Одна страница витрины после курсора (null — первая), порядок — цена, slug.
   * `hasMore` считает читатель: строк запрашивается на одну больше.
   */
  readCatalogPage(cursor: CatalogCursor | null, limit: number): Promise<CatalogPageRead>;
  /** Строки каталога по slug — обновить известные лоты (окно, история
   *  колокола); отсутствие строки = лота нет в БД. */
  readCatalogBySlugs(slugs: readonly string[]): Promise<CatalogRead>;
  /** Полный список моих лотов (владелец — uid); не окно витрины. */
  readMyLots(uid: string): Promise<CatalogRead>;
  readLot(slug: string): Promise<LotStateRead>;
}

/** Доменное событие «мой лот перекупили»: факт, разрешённый из снапшота. */
export interface LiveOutbid {
  slug: string;
  title: string;
  by: string;
  price: number;
  at: number;
  video: string | null;
}

/** Своя покупка: какой Лот и за сколько ушёл серверу. */
export interface LivePurchase {
  slug: string;
  price: number;
}

/** Тик `lots` без формы Realtime: какие slug'и родились этим событием. */
export interface LotsTick {
  insertedSlugs: readonly string[];
}

/** Сделка `purchases` без формы Realtime: продавец, если строка его несёт. */
export interface DealEvent {
  sellerUid?: string | null;
}

/** Состояние сессии: «ещё не знаю», гость или залогиненный чатерс. */
export type SessionState = 'unknown' | 'guest' | 'user';

/** Изменение живых данных; поверхности читают снапшот, вид события — что обновлять. */
export type LiveChange =
  | { kind: 'uid'; uid: string | null }
  | { kind: 'balance'; balance: number | null; fresh: boolean }
  | { kind: 'catalog'; changed: ReadonlySet<string>; fresh: boolean }
  | { kind: 'myLots'; changed: ReadonlySet<string> }
  | { kind: 'purchase'; purchase: LivePurchase }
  | { kind: 'outbid'; event: LiveOutbid }
  | { kind: 'deals' }
  | { kind: 'sync' };

/** Одинаковые ли два состояния Лота: ссылка сохраняется, если менять нечего. */
export function sameLot(a: LotState, b: LotState): boolean {
  return (
    a.slug === b.slug &&
    a.title === b.title &&
    a.video_url === b.video_url &&
    a.price === b.price &&
    a.nextPrice === b.nextPrice &&
    a.owner_login === b.owner_login &&
    a.owner_uid === b.owner_uid &&
    a.suggested_by_login === b.suggested_by_login
  );
}

/**
 * Слить строку с прежней картой, переиспользуя ссылку неизменившегося объекта.
 * `changed` — строка появилась или отличается; удалением владеет вызывающий.
 */
export function mergeLotState(
  target: Map<string, LotState>,
  raw: LotState
): { state: LotState; changed: boolean } {
  const old = target.get(raw.slug);
  if (old && sameLot(old, raw)) return { state: old, changed: false };
  target.set(raw.slug, raw);
  return { state: raw, changed: true };
}

/** Событие перекупа из свежей строки: один строитель на все диффы. */
export function outbidFrom(st: LotState): LiveOutbid {
  return {
    slug: st.slug,
    title: st.title,
    by: st.owner_login ?? 'Чатерс',
    price: st.price,
    at: Date.now(),
    video: st.video_url,
  };
}
