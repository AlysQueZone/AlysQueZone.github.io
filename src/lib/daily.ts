/**
 * Ежедневный вход (pivkoiny-backend, тикет 13: автовыдача без кнопок).
 *
 * Награду начисляет RPC `claim_daily` (первый клейм дня — кредит +
 * леджер `daily_login`, повторный — возврат уже выданного без дубля, noop).
 * Клиент сам вызывает клейм один раз в день при первом заходе залогиненного
 * Чатерса (см. src/components/DailyLogin.astro): сначала сверка со статусом
 * дня, лишних вызовов нет. Сумм клиент не считает: день M — позиция в цикле
 * ((streak - 1) % 7) + 1, как в миграции; пропуск дня streak не сбрасывает.
 * Локальный кошелёк удалён в тикете 11 — денег в клиенте нет вовсе.
 *
 * Секретов здесь нет: только publishable-ключ через getSupabase().
 */

import { getSupabase } from './supabase.ts';

/** Календарь наград по позиции дня 1..7 (циклический) — display-mirror, source of truth — DB (CASE в claim_daily). */
// display-mirror, source of truth — DB
export const DAILY_CALENDAR = [100, 100, 150, 150, 200, 250, 500] as const;

/** Ключ локальной метки «автоклейм в этот UTC-день уже отработал». */
export const AUTO_DAILY_KEY = 'alysque:daily-auto-day';

/** Позиция дня в недельном цикле по номеру streak (8-й = снова 1-й). */
export function dayNumForStreak(streak: number): number {
  const n = Math.floor(streak);
  if (!Number.isFinite(n) || n < 1) return 1;
  return ((n - 1) % 7) + 1;
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

/** UTC-дата сегодня — тот же день, что claim_day на сервере. */
export function todayUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Метка дня, в который автоклейм уже отработал (null — ещё нет). */
export function readAutoDailyDay(): string | null {
  try {
    const raw = localStorage.getItem(AUTO_DAILY_KEY);
    return raw && raw.length > 0 ? raw : null;
  } catch {
    // приватный режим — без локальной метки, сверка только со статусом
    return null;
  }
}

/** Запомнить, что автоклейм в этот UTC-день уже отработал. */
export function markAutoDailyDay(day: string = todayUtcDate()): void {
  try {
    localStorage.setItem(AUTO_DAILY_KEY, day);
  } catch {
    // приватный режим — без метки, завтра сверимся со статусом заново
  }
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
 * Бросает исходную ошибку — на автофлоу тихая тишина (деньги целы).
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
 * Живой статус: забран ли вход сегодня (свой ряд, RLS — только
 * свой). null — гость / не настроено / офлайн (деньги целы,
 * это не «не забрано»).
 */
export async function fetchDailyStatus(): Promise<DailyStatus | null> {
  const sb = getSupabase();
  if (!sb) return null;
  try {
    const { data: sessionData } = await sb.auth.getSession();
    const uid = sessionData.session?.user.id;
    if (!uid) return null;
    // День суток — UTC-дата, как claim_day на сервере.
    const today = todayUtcDate();
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
