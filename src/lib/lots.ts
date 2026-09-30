import { getSupabase, buyLotShared } from './supabase';
import { live } from './live';
import { errorText, isNoAuthError, isOfflineError } from './errors';

/**
 * Перекуп: выполнение покупки за одним швом.
 *
 * Контракт с БД (см. supabase/migrations/*_shared_lots.sql): клиент
 * делает один INSERT в purchases только с lot_id + buyer_uid. Цену,
 * identity, паузу, кап и гейт денег считает BEFORE-триггер — клиентские
 * значения игнорируются, итог — всегда price_paid сервера.
 *
 * Живые чтения (каталог, лот, баланс, uid) и события — в lib/live.ts
 * (docs/adr/0003): здесь только запись и маппинг её ошибок.
 */

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
  const raw = errorText(err);
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
  if (isNoAuthError(err)) {
    return { kind: 'unauthenticated', raw };
  }
  if (low.includes('not found')) {
    return { kind: 'missing-lot', raw };
  }
  if (low.includes('price cap')) {
    return { kind: 'price-cap', raw };
  }
  // Деньги покупки — серверный гейт (BEFORE-триггер):
  // счёта нет или баланса не хватило на серверную цену.
  if (low.includes('insufficient funds') || low.includes('insufficient_funds')) {
    return { kind: 'insufficient-funds', raw };
  }
  if (isOfflineError(err)) {
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
 * Покупка объявляется модулю живых данных (`live.reportPurchase`): событие
 * для поверхностей + перечитка каталога и баланса.
 * Доменные исходы не бросает — возвращает BuyResult; бросает только
 * при ненастроенном хранилище (caller guards через getSupabase).
 */
export async function buyLot(slug: string): Promise<BuyResult> {
  const sb = getSupabase();
  if (!sb) throw new Error('supabase not configured');
  try {
    const st = await live.refreshLot(slug);
    const staged = st?.nextPrice ?? null;
    const done = await buyLotShared(slug);
    const paid =
      Number.isFinite(done.price_paid) && done.price_paid > 0 ? done.price_paid : (staged ?? 0);
    void live.reportPurchase({ slug, price: paid });
    return { status: 'ok', paid, buyer: done.buyer_login };
  } catch (err) {
    const info = mapBuyError(err);
    return { status: 'blocked', kind: info.kind, retryAfterSec: info.retryAfterSec, raw: info.raw };
  }
}
