/**
 * Гамба на сервере (тикет 09, pivkoiny-backend).
 *
 * Исход считает RPC `spin_gamba` (RNG + дебет 100 + кредит выигрыша +
 * возврат исхода в одной транзакции). Клиент исходу не доверяет: шансов
 * сам не считает, грантов локально не делает — лишь рисует присланное.
 * Локальный кошелёк удалён в тикете 11 — денег в клиенте нет вовсе.
 *
 * Таблица выплат I — кран под прибором (ребаланс, тикет 08, seed-конфиг
 * в БД, `public.gamba_payouts`, ставка 100, кэп 20 спинов/сутки): минимум —
 * возврат 75% → 100 (при своих, net 0; мимо нет вовсе), мелочь 17% → 150
 * (+50), крупно 7% → 250 (+150), джекпот x10 1% → 1000 (EV ~128, было ~97.5
 * у H; доля «в плюсе» 25%). Печать worst-case ~59k ≈ стокам при кэпе 5
 * (при 20 — кратно выше, принято).
 * Секретов здесь нет: только publishable-ключ через getSupabase().
 */

import { getSupabase } from './supabase';

/** Фиксированная ставка Гамбы — display-mirror, source of truth — DB (c_stake в spin_gamba). */
// display-mirror, source of truth — DB
export const GAMBA_STAKE = 100;

/** Дневной лимит спинов — display-mirror, source of truth — DB (c_daily_limit в spin_gamba). */
// display-mirror, source of truth — DB
export const GAMBA_DAILY_LIMIT = 20;

/**
 * Звуковые пулы гамбы — единый источник правды (имена файлов в бакете
 * media/sounds; URL собирает s3Sound() / GambaModal).
 *
 * Спин (кручение, случайный one-shot поверх щелчков) — свой пул ниже.
 * Нюансы имён: `gamba-win-taktak.mp3` исторически с префиксом win, по смыслу —
 * фраза кручения «тактактакуе»; `gamba-bg.mp3` — one-shot вариант спина, не луп.
 * Выигрыш small/big, джекпот, проигрыш — свои пулы; возврат церемониально
 * равен проигрышу (худший исход таблицы I, мимо нет) и звучит lose-пулом.
 */
export const GAMBA_SPIN_SOUNDS = [
  'gamba-spin-sova.mp3',
  'gamba-spin-maknagens.mp3',
  'gamba-spin-toptop.mp3',
  'gamba-spin-sapogi.mp3',
  'gamba-spin-trtrtrtr.mp3',
  'gamba-spin-tutututu.mp3',
  'gamba-spin-kazu-tatata.mp3',
  'gamba-spin-tratatatata.mp3',
  'gamba-spin-maknaggetskue.mp3',
  'gamba-spin-otvinta.mp3',
  'gamba-bg.mp3',
  'gamba-win-taktak.mp3',
] as const;

export const GAMBA_WIN_SOUNDS = [
  'gamba-win1k.mp3',
  'gamba-win-ideal.mp3',
  'gamba-win-oooo.mp3',
  'gamba-win-pivo.mp3',
] as const;

export const GAMBA_JACKPOT_SOUNDS = [
  'gamba-win100k.mp3',
  'gamba-super-vanna.mp3',
  'gamba-super-snow.mp3',
  'gamba-super-ebaaaat.mp3',
] as const;

export const GAMBA_LOSE_SOUNDS = [
  'm4-scum.mp3',
  'gamba-lose-higan.mp3',
  'gamba-lose-pivka.mp3',
  'gamba-lose-proigrala-zhopu.mp3',
] as const;

export type GambaOutcome = 'miss' | 'return' | 'small' | 'big' | 'jackpot';

export interface GambaPayRow {
  outcome: GambaOutcome;
  payout: number;
  chance: string;
  label: string;
}

/** Плакат до спина: ставка, таблица и шансы — display-mirror, source of truth — DB
 *  (`public.gamba_payouts`, см. fetchGambaPaytable); константа ниже — лишь фолбэк
 *  показа, если конфиг из БД не прочитался. */
// display-mirror, source of truth — DB
export const GAMBA_PAYTABLE: GambaPayRow[] = [
  { outcome: 'return', payout: 100, chance: '75%', label: 'возврат 100' },
  { outcome: 'small', payout: 150, chance: '17%', label: '+50' },
  { outcome: 'big', payout: 250, chance: '7%', label: '+150' },
  { outcome: 'jackpot', payout: 1000, chance: '1%', label: 'джекпот x10' },
];

export interface GambaSpinResult {
  outcome: GambaOutcome;
  payout: number;
  balance: number | null;
}

export type GambaErrorKind =
  | 'unauthenticated'
  | 'insufficient-funds'
  | 'rate-limit'
  | 'daily-limit'
  | 'offline'
  | 'write-error';

export interface GambaErrorInfo {
  kind: GambaErrorKind;
  raw: string;
}

function gambaErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null && 'message' in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}

/** Маппинг ошибок RPC/транспорта на честные виды (матч по тексту сервера). */
export function mapGambaError(err: unknown): GambaErrorInfo {
  const raw = gambaErrorMessage(err);
  const low = raw.toLowerCase();
  if (
    low.includes('not authenticated') ||
    low.includes('row-level security') ||
    low.includes('jwt')
  ) {
    return { kind: 'unauthenticated', raw };
  }
  if (low.includes('insufficient funds') || low.includes('insufficient_funds')) {
    return { kind: 'insufficient-funds', raw };
  }
  if (low.includes('rate limit') || low.includes('too many') || low.includes('slow down')) {
    return { kind: 'rate-limit', raw };
  }
  if (low.includes('daily limit')) {
    return { kind: 'daily-limit', raw };
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
 * Нормализация исхода из БД/RPC. Исход 'small' (мелкий выигрыш +50) —
 * штатный исход таблицы H; история эпохи F рисуется тем же текстом.
 */
function asOutcome(value: unknown): GambaOutcome | null {
  return value === 'miss' ||
    value === 'return' ||
    value === 'small' ||
    value === 'big' ||
    value === 'jackpot'
    ? (value as GambaOutcome)
    : null;
}

/**
 * Ключ попытки спина: генерируется на спин и живёт до показанного исхода —
 * ретрай/офлайн-повтор той же попытки шлёт ТОТ ЖЕ ключ (сервер идемпотентен:
 * unique (user_id, idempotency_key), повтор вернёт первый исход без дублей).
 */
export function newGambaAttemptKey(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // fallback ниже
  }
  return `gamba-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

export interface GambaRetryOptions {
  /** Сколько раз повторить тем же ключом при transport/офлайн-ошибке. */
  retries?: number;
}

/**
 * Спин с повтором тем же ключом: transport/офлайн-ошибка (исход неизвестен) —
 * ещё попытка с ТЕМ ЖЕ ключом (сервер вернёт уже записанное либо запишет
 * заново без дубля). Бизнес-ошибки (insufficient-funds/rate-limit/
 * unauthenticated) не ретраятся — бросаются сразу.
 */
export async function spinGambaWithRetry(
  idempotencyKey: string,
  opts?: GambaRetryOptions
): Promise<GambaSpinResult> {
  const retries = Math.max(0, opts?.retries ?? 1);
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await spinGamba(idempotencyKey);
    } catch (err) {
      lastErr = err;
      const info = mapGambaError(err);
      if (info.kind !== 'offline' && info.kind !== 'write-error') throw err;
      if (attempt >= retries) throw err;
    }
  }
  throw lastErr;
}

/**
 * Живой плакат из БД (`public.gamba_payouts` публична: шансы видны до спина).
 * Шансы — доля weight от суммы (формат как в фолбэке: «50%»). null — БД
 * не ответила, показывать GAMBA_PAYTABLE-фолбэк.
 */
export async function fetchGambaPaytable(): Promise<GambaPayRow[] | null> {
  const sb = getSupabase();
  if (!sb) return null;
  try {
    const res = await sb
      .from('gamba_payouts')
      .select('outcome,payout,weight,label')
      .order('payout', { ascending: true });
    if (res.error || !Array.isArray(res.data)) return null;
    const rows = res.data as unknown as Record<string, unknown>[];
    const parsed = rows.flatMap((row) => {
      const outcome = asOutcome(row['outcome']);
      const payout = Number(row['payout']);
      const weight = Number(row['weight']);
      const label = row['label'];
      if (!outcome || !Number.isFinite(payout) || payout < 0) return [];
      if (!Number.isFinite(weight) || weight <= 0) return [];
      if (typeof label !== 'string' || label.length === 0) return [];
      return [{ outcome, payout, weight, label }];
    });
    if (parsed.length === 0) return null;
    const total = parsed.reduce((sum, r) => sum + r.weight, 0);
    if (!Number.isFinite(total) || total <= 0) return null;
    return parsed.map((r) => ({
      outcome: r.outcome,
      payout: r.payout,
      chance: `${Math.round((r.weight / total) * 100)}%`,
      label: r.label,
    }));
  } catch {
    return null;
  }
}

/**
 * Серверный спин одним вызовом: idempotencyKey — ключ попытки (см.
 * newGambaAttemptKey: генерируется на спин, переиспользуется при ретрае той же
 * попытки, истекает после показанного исхода), повтор с тем же ключом движений
 * не дублирует (сервер вернёт первый исход).
 * Бросает исходную ошибку — маппить через mapGambaError на стороне UI.
 */
export async function spinGamba(idempotencyKey: string): Promise<GambaSpinResult> {
  const sb = getSupabase();
  if (!sb) throw new Error('supabase not configured');
  const { data: sessionData } = await sb.auth.getSession();
  if (!sessionData.session) throw new Error('not authenticated');
  const { data, error } = await sb.rpc('spin_gamba', {
    p_idempotency_key: idempotencyKey,
  });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as unknown as Record<string, unknown> | null;
  const outcome = asOutcome(row?.['spin_outcome']);
  if (!outcome) throw new Error('bad spin response');
  const payout = Number(row?.['spin_payout']);
  const balanceRaw = Number(row?.['spin_balance']);
  return {
    outcome,
    payout: Number.isFinite(payout) && payout >= 0 ? payout : 0,
    balance: Number.isFinite(balanceRaw) && balanceRaw >= 0 ? balanceRaw : null,
  };
}
