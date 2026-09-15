import { getSupabase, subscribeSharedLots, buyLotShared } from './supabase';

/**
 * Живое состояние Лота: каталог + прайс-фид + флаг «мой» за один запрос.
 *
 * Раньше понятие было разорвано на три шва: SSG-каталог, shared-состояния
 * в supabase.ts и живые цены в prices.ts — витрина делала два запроса и сшивала
 * карты вручную. Теперь один запрос к вью `lots_with_next_price` (N считает БД
 * тем же выражением, что и BEFORE-триггер, клиент формулы не знает и не хранит).
 *
 * nextPrice null — N неизвестна (вью отсутствует, читаем таблицу lots):
 * показ рисует «…», а не price. mine — owner_uid == uid сессии
 * (uid передаёт caller, модуль сессию не читает).
 * Витрина и страница лота целиком рисуются из этой карты клиентом (см.
 * docs/adr/0002); запечённого на билде каталога нет.
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

type LotRow = Record<string, unknown>;

function str(row: LotRow, key: string): string | null {
  const value = row[key];
  return typeof value === 'string' ? value : null;
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

/** Каталог + признак «ответ от БД получен»: пустой каталог ≠ ошибка. */
export interface CatalogResult {
  ok: boolean;
  states: Map<string, LotState>;
}

/**
 * Весь живой каталог одним запросом (витрина, колокол, уведомления).
 * Вью отсутствует (миграция ещё не применена) — фолбэк на таблицу `lots`
 * с nextPrice null (клиентской формулы нет и не будет).
 * Ошибка или ненастроенное хранилище → `ok: false` с пустой картой (витрина
 * отличает «пусто» от «не загрузилось»). Секретов здесь нет: только
 * publishable-ключ через getSupabase().
 */
export async function fetchLotCatalogResult(uid: string | null): Promise<CatalogResult> {
  const empty = new Map<string, LotState>();
  const sb = getSupabase();
  if (!sb) return { ok: false, states: empty };
  try {
    const fromView = await sb.from(VIEW).select(VIEW_COLUMNS);
    if (!fromView.error && Array.isArray(fromView.data)) {
      return { ok: true, states: fillCatalog(fromView.data, uid) };
    }
  } catch {
    // вью нет — фолбэк ниже
  }
  try {
    const fromTable = await sb.from('lots').select(TABLE_COLUMNS);
    if (fromTable.error || !Array.isArray(fromTable.data)) return { ok: false, states: empty };
    return { ok: true, states: fillCatalog(fromTable.data, uid) };
  } catch {
    return { ok: false, states: empty };
  }
}

/** Живой каталог; ошибка/ненастроенное хранилище → пустая карта. */
export async function fetchLotCatalog(uid: string | null): Promise<Map<string, LotState>> {
  return (await fetchLotCatalogResult(uid)).states;
}

/** Один Лот + признак «ответ от БД получен»: нет строки ≠ БД недоступна. */
export interface LotStateResult {
  ok: boolean;
  state: LotState | null;
}

/** PostgREST-код «строки нет» — это отсутствие Лота, а не сбой запроса. */
function isNoRow(err: { code?: string } | null | undefined): boolean {
  return err?.code === 'PGRST116';
}

/**
 * Живое состояние одного Лота (проекция модалки, свежая N перед записью).
 * Пробуем вью, затем таблицу. `state: null` при `ok: true` — строки нет;
 * `ok: false` — вью и таблица недоступны или хранилище не настроено.
 */
export async function fetchLotStateResult(
  slug: string,
  uid: string | null
): Promise<LotStateResult> {
  const sb = getSupabase();
  if (!sb) return { ok: false, state: null };
  try {
    const fromView = await sb.from(VIEW).select(VIEW_COLUMNS).eq('slug', slug).single();
    if (!fromView.error && fromView.data) {
      return { ok: true, state: toLotState(fromView.data as unknown as LotRow, uid) };
    }
  } catch {
    // вью нет — фолбэк ниже
  }
  try {
    const fromTable = await sb.from('lots').select(TABLE_COLUMNS).eq('slug', slug).single();
    if (!fromTable.error && fromTable.data) {
      return { ok: true, state: toLotState(fromTable.data as unknown as LotRow, uid) };
    }
    if (isNoRow(fromTable.error)) return { ok: true, state: null };
    return { ok: false, state: null };
  } catch {
    return { ok: false, state: null };
  }
}

/** Состояние одного Лота; нет строки/ошибка/не настроено → null. */
export async function fetchLotState(slug: string, uid: string | null): Promise<LotState | null> {
  return (await fetchLotStateResult(slug, uid)).state;
}

/**
 * Заполнить кнопку покупки данными Лота — контракт с BuyModal (`data-buy-lot*`).
 * Одно место на витрину и страницу лота: правка формы тут меняет оба экрана.
 */
export function fillBuyButton(btn: Element | null, st: LotState): void {
  if (!(btn instanceof HTMLButtonElement)) return;
  btn.dataset.buyLot = st.slug;
  btn.dataset.lotTitle = st.title;
  // Staged-цена — живая N из каталога; N неизвестна — «…», сервер посчитает сам.
  btn.dataset.lotPrice = String(st.nextPrice ?? st.price);
  btn.dataset.lotOwner = st.owner_login ?? '—';
  if (st.video_url) btn.dataset.lotVideo = st.video_url;
  else delete btn.dataset.lotVideo;
  // Свой лот купить нельзя (перекуп у себя бессмыслен): кнопка гаснет.
  btn.disabled = st.mine;
  btn.textContent = st.mine
    ? 'Твой привет'
    : st.nextPrice !== null
      ? `Забрать за ${st.nextPrice} 🍺`
      : 'Забрать за … 🍺';
  btn.classList.toggle('opacity-50', st.mine);
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

// ---------------------------------------------------------------------------
// Перекуп: выполнение покупки за одним швом.
//
// Контракт с БД (тикет 10, см. supabase/migrations/*_shared_lots.sql): клиент
// делает один INSERT в purchases только с lot_id + buyer_uid. Цену,
// identity, паузу, кап и гейт денег считает BEFORE-триггер — клиентские
// значения игнорируются, итог — всегда price_paid сервера.
// ---------------------------------------------------------------------------

export type BuyErrorKind =
  | 'cooldown'
  | 'rate-limit'
  | 'own-lot'
  | 'insufficient-funds'
  | 'unauthenticated'
  | 'missing-lot'
  | 'price-cap'
  | 'offline'
  | 'write-error';

interface BuyErrorInfo {
  kind: BuyErrorKind;
  /** Для паузы — сколько секунд ждать (парсится из текста триггера). */
  retryAfterSec?: number;
  raw: string;
}

/** Запасная пауза, если текст триггера не распарсился (в миграции — 30с). */
const BUY_COOLDOWN_FALLBACK_SEC = 30;

function buyErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null && 'message' in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}

function parseCooldownSec(msg: string): number {
  const hms = msg.match(/(\d+):(\d{2}):(\d{2})/);
  if (hms) {
    const sec = Number(hms[1]) * 3600 + Number(hms[2]) * 60 + Number(hms[3]);
    if (Number.isFinite(sec) && sec > 0 && sec <= 3600) return sec;
  }
  const sec = msg.match(/(\d+)\s*(?:s|sec|сек)/i);
  if (sec) {
    const n = Number(sec[1]);
    if (Number.isFinite(n) && n > 0 && n <= 3600) return n;
  }
  return BUY_COOLDOWN_FALLBACK_SEC;
}

/**
 * Маппинг ошибок Postgres/триггера на честные виды.
 * Матчится по коду/сообщению триггера: cooldown / rate limit /
 * not authenticated (см. enforce_purchase_rules в миграциях).
 */
function mapBuyError(err: unknown): BuyErrorInfo {
  const raw = buyErrorMessage(err);
  const low = raw.toLowerCase();
  if (low.includes('cooldown')) {
    return { kind: 'cooldown', retryAfterSec: parseCooldownSec(raw), raw };
  }
  if (low.includes('rate limit') || low.includes('max ') || low.includes('too many')) {
    return { kind: 'rate-limit', raw };
  }
  if (low.includes('already yours')) {
    return { kind: 'own-lot', raw };
  }
  if (
    low.includes('not authenticated') ||
    low.includes('row-level security') ||
    low.includes('jwt') ||
    low.includes('no twitch identity')
  ) {
    return { kind: 'unauthenticated', raw };
  }
  if (low.includes('not found')) {
    return { kind: 'missing-lot', raw };
  }
  if (low.includes('price cap')) {
    return { kind: 'price-cap', raw };
  }
  // Деньги покупки — серверный гейт (тикет 08, BEFORE-триггер):
  // счёта нет или баланса не хватило на серверную цену.
  if (low.includes('insufficient funds') || low.includes('insufficient_funds')) {
    return { kind: 'insufficient-funds', raw };
  }
  if (
    low.includes('failed to fetch') ||
    low.includes('networkerror') ||
    low.includes('network error') ||
    low.includes('load failed') ||
    low.includes('offline') ||
    err instanceof TypeError
  ) {
    return { kind: 'offline', raw };
  }
  return { kind: 'write-error', raw };
}

/**
 * Итог перекупа: успех с фактически уплаченной серверной ценой
 * либо блокировка с видом и сырым текстом сервера (raw — для отладки,
 * показ пользуется kind).
 */
export type BuyResult =
  | { status: 'ok'; paid: number; buyer: string }
  | { status: 'blocked'; kind: BuyErrorKind; retryAfterSec?: number; raw: string };

/**
 * Перекуп одним вызовом: свежая N перед записью (проекция для показа —
 * итог всё равно посчитает сервер), затем INSERT с ожиданием confirm.
 * Доменные исходы не бросает — возвращает BuyResult; бросает только
 * при ненастроенном хранилище (caller guards через isSupabaseConfigured).
 */
export async function buyLot(slug: string): Promise<BuyResult> {
  const sb = getSupabase();
  if (!sb) throw new Error('supabase not configured');
  try {
    const st = await fetchLotState(slug, null);
    const staged = st?.nextPrice ?? null;
    const done = await buyLotShared(slug);
    const paid =
      Number.isFinite(done.price_paid) && done.price_paid > 0 ? done.price_paid : (staged ?? 0);
    return { status: 'ok', paid, buyer: done.buyer_login };
  } catch (err) {
    const info = mapBuyError(err);
    return { status: 'blocked', kind: info.kind, retryAfterSec: info.retryAfterSec, raw: info.raw };
  }
}

// ---------------------------------------------------------------------------
// Событие «лот куплен»: кидает модалка после успеха, слушают витрина,
// страница лота и колокол перекупов. Payload типизирован здесь —
// рассинхрон комментария и кода (кейс 2026-09-11) больше не молчит.
// ---------------------------------------------------------------------------

/** Payload события «лот куплен»: какой лот и за сколько ушёл серверу. */
export interface BoughtDetail {
  id: string;
  price: number;
}

/** Объявить покупку (из модалки после успеха). */
export function announceBought(detail: BoughtDetail): void {
  window.dispatchEvent(new CustomEvent('alysque:bought', { detail }));
}

/**
 * Подписаться на покупки: чужая форма detail отбрасывается guard'ом.
 * Возвращает функцию отписки.
 */
export function onBought(cb: (detail: BoughtDetail) => void): () => void {
  const handler = (e: Event): void => {
    const detail = (e as CustomEvent<unknown>).detail;
    if (typeof detail !== 'object' || detail === null) return;
    const { id, price } = detail as Record<string, unknown>;
    if (typeof id !== 'string' || typeof price !== 'number') return;
    cb({ id, price });
  };
  window.addEventListener('alysque:bought', handler);
  return () => window.removeEventListener('alysque:bought', handler);
}
