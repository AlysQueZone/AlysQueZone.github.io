/**
 * Гамба на сервере (тикет 09, pivkoiny-backend).
 *
 * Исход считает RPC `spin_gamba` (RNG + дебет 100 + кредит выигрыша +
 * возврат исхода в одной транзакции). Клиент исходу не доверяет: шансов
 * сам не считает, грантов локально не делает — лишь рисует присланное.
 * Локальный кошелёк удалён в тикете 11 — денег в клиенте нет вовсе.
 *
 * Таблица выплат (seed-конфиг в БД, `public.gamba_payouts`, ставка 100):
 * мимо 50% → 0, возврат 40% → 100, джекпот 10% → 500 (RTP 90%).
 * Секретов здесь нет: только publishable-ключ через getSupabase().
 */

import { getSupabase } from './supabase.ts';

/** Фиксированная ставка Гамбы — зеркало серверной константы (c_stake). */
export const GAMBA_STAKE = 100;

export type GambaOutcome = 'miss' | 'return' | 'jackpot';

export interface GambaPayRow {
  outcome: GambaOutcome;
  payout: number;
  chance: string;
  label: string;
}

/** Плакат до спина: ставка, таблица и шансы — клиенту их присылать не надо. */
export const GAMBA_PAYTABLE: GambaPayRow[] = [
  { outcome: 'miss', payout: 0, chance: '50%', label: 'мимо' },
  { outcome: 'return', payout: 100, chance: '40%', label: 'возврат 100' },
  { outcome: 'jackpot', payout: 500, chance: '10%', label: 'джекпот 500' },
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

function asOutcome(value: unknown): GambaOutcome | null {
  return value === 'miss' || value === 'return' || value === 'jackpot' ? value : null;
}

/**
 * Серверный спин одним вызовом: idempotencyKey — uuid на спин, повтор
 * с тем же ключом движений не дублирует (сервер вернёт первый исход).
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
