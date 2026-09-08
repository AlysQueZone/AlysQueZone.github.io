/**
 * Ежедневный вход (тикет 10, pivkoiny-backend).
 *
 * Награду дня streak начисляет RPC `claim_daily` (первый клик дня — кредит +
 * леджер `daily_login`, повторный — возврат уже выданного без дубля). Клиент
 * сумм сам не считает: календарь ниже — лишь зеркало серверного для показа,
 * позиция дня — ((streak - 1) % 7) + 1, как в миграции. Пропуск дня streak
 * не сбрасывает (streak — счётчик дней с клеймами), 8-й день = снова день 1.
 * Локальный кошелёк удалён в тикете 11 — денег в клиенте нет вовсе.
 *
 * Секретов здесь нет: только publishable-ключ через getSupabase().
 */

import { getSupabase } from './supabase.ts';

/** Календарь наград по позиции дня 1..7 (циклический) — зеркало серверного CASE. */
export const DAILY_CALENDAR = [100, 100, 150, 150, 200, 250, 500] as const;

/** Ключ отложенного входа: открыть модалку после возврата из логина. */
export const PENDING_DAILY_KEY = 'alysque:pending-daily';

/** Позиция дня в недельном цикле по номеру streak (8-й = снова 1-й). */
export function dayNumForStreak(streak: number): number {
  const n = Math.floor(streak);
  if (!Number.isFinite(n) || n < 1) return 1;
  return ((n - 1) % 7) + 1;
}

/** Награда позиции дня 1..7 по календарю (для показа до клейма). */
export function amountForDay(dayNum: number): number {
  const idx = Math.floor(dayNum) - 1;
  if (idx < 0 || idx >= DAILY_CALENDAR.length) return DAILY_CALENDAR[0];
  return DAILY_CALENDAR[idx];
}

export interface DailyClaimResult {
  claimDay: string;
  streak: number;
  amount: number;
  balance: number | null;
  /** true — повторный клейм: награда уже выдана сегодня, дубля нет. */
  already: boolean;
}

export interface DailyStatus {
  claimedToday: boolean;
  todayAmount: number | null;
  todayStreak: number | null;
  /** Номер streak следующего (ещё не забранного) клейма. */
  nextStreak: number;
}

export type DailyErrorKind = 'unauthenticated' | 'offline' | 'write-error';

export interface DailyErrorInfo {
  kind: DailyErrorKind;
  raw: string;
}

function dailyErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null && 'message' in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}

/** Маппинг ошибок RPC/транспорта на честные виды (матч по тексту сервера). */
export function mapDailyError(err: unknown): DailyErrorInfo {
  const raw = dailyErrorMessage(err);
  const low = raw.toLowerCase();
  if (
    low.includes('not authenticated') ||
    low.includes('row-level security') ||
    low.includes('jwt')
  ) {
    return { kind: 'unauthenticated', raw };
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

function asClaimRow(data: unknown): Record<string, unknown> | null {
  const row = (Array.isArray(data) ? data[0] : data) as unknown as
    | Record<string, unknown>
    | null;
  return row && typeof row === 'object' ? row : null;
}

/**
 * Серверный клейм одним вызовом. Повтор в тот же день движений не дублирует
 * (сервер вернёт уже выданное с already = true).
 * Бросает исходную ошибку — маппить через mapDailyError на стороне UI.
 */
export async function claimDaily(): Promise<DailyClaimResult> {
  const sb = getSupabase();
  if (!sb) throw new Error('supabase not configured');
  const { data: sessionData } = await sb.auth.getSession();
  if (!sessionData.session) throw new Error('not authenticated');
  const { data, error } = await sb.rpc('claim_daily');
  if (error) throw error;
  const row = asClaimRow(data);
  const streak = Number(row?.['claim_streak']);
  const amount = Number(row?.['claim_amount']);
  if (!row || !Number.isFinite(streak) || streak < 1 || !Number.isFinite(amount) || amount <= 0) {
    throw new Error('bad claim response');
  }
  const balanceRaw = Number(row?.['claim_balance']);
  return {
    claimDay: typeof row['claim_day'] === 'string' ? (row['claim_day'] as string) : '',
    streak: Math.floor(streak),
    amount: Math.floor(amount),
    balance: Number.isFinite(balanceRaw) && balanceRaw >= 0 ? balanceRaw : null,
    already: row['claim_already'] === true,
  };
}

/**
 * Живой статус для календаря: забран ли вход сегодня (свой ряд, RLS — только
 * свой) и номер следующего streak. null — гость / не настроено / офлайн
 * (деньги целы, это не «не забрано»).
 */
export async function fetchDailyStatus(): Promise<DailyStatus | null> {
  const sb = getSupabase();
  if (!sb) return null;
  try {
    const { data: sessionData } = await sb.auth.getSession();
    const uid = sessionData.session?.user.id;
    if (!uid) return null;
    // День суток — UTC-дата, как claim_day на сервере.
    const today = new Date().toISOString().slice(0, 10);
    const { data: todayRow, error: todayError } = await sb
      .from('daily_claims')
      .select('streak,amount')
      .eq('user_id', uid)
      .eq('claim_day', today)
      .maybeSingle();
    if (todayError) return null;
    if (todayRow) {
      const row = todayRow as unknown as { streak: unknown; amount: unknown };
      const streak = Number(row.streak);
      const amount = Number(row.amount);
      return {
        claimedToday: true,
        todayAmount: Number.isFinite(amount) && amount > 0 ? Math.floor(amount) : null,
        todayStreak: Number.isFinite(streak) && streak >= 1 ? Math.floor(streak) : null,
        nextStreak: Number.isFinite(streak) && streak >= 1 ? Math.floor(streak) + 1 : 1,
      };
    }
    const { count, error: countError } = await sb
      .from('daily_claims')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', uid);
    if (countError || count === null || !Number.isFinite(count)) return null;
    return { claimedToday: false, todayAmount: null, todayStreak: null, nextStreak: count + 1 };
  } catch {
    return null;
  }
}

/** Запомнить, что после логина надо переоткрыть Ежедневный вход. */
export function stashPendingDaily(): void {
  try {
    sessionStorage.setItem(PENDING_DAILY_KEY, '1');
  } catch {
    // приватный режим — возврат сработает через ?daily= в URL
  }
}

/** Забрать и стереть запомненный вход (одноразово). */
export function takePendingDaily(): boolean {
  let fromStorage = false;
  try {
    fromStorage = sessionStorage.getItem(PENDING_DAILY_KEY) === '1';
    sessionStorage.removeItem(PENDING_DAILY_KEY);
  } catch {
    fromStorage = false;
  }
  if (typeof window === 'undefined') return fromStorage;
  const url = new URL(window.location.href);
  const fromUrl = url.searchParams.get('daily') === '1';
  if (fromUrl) {
    url.searchParams.delete('daily');
    window.history.replaceState(null, '', url.toString());
  }
  return fromStorage || fromUrl;
}

/** URL возврата после логина: текущий адрес + ?daily=1. */
export function returnUrlForDaily(): string {
  const url = new URL(window.location.href);
  url.searchParams.set('daily', '1');
  return url.toString().split('#')[0];
}
