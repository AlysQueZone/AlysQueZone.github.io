/**
 * Баланс Пивкойнов из БД (тикет 07, pivkoiny-backend).
 *
 * Expand-сторона рядом с локальным кошельком `src/lib/wallet.ts`:
 * новый источник истины (таблица `public.profiles`, RLS — только свой
 * баланс), старый локальный кошелёк пока жив и умрёт в тикете 11.
 *
 * - Гость без сессии: деньги не читаются → null, витрина видна и так.
 * - Без настроенных PUBLIC_SUPABASE_* → null (честная деградация).
 * - Секретов здесь нет: только publishable-ключ через getSupabase().
 */

import { getSupabase } from './supabase.ts';

/** Стартовый баланс — зеркало серверного дефолта (триггер handle_new_profile). */
export const DB_START_BALANCE = 1000;

export interface MyBalance {
  uid: string;
  balance: number;
}

/** uid текущей сессии; null — гость или хранилище не настроено. */
export async function getBalanceUid(): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return null;
  try {
    const { data } = await sb.auth.getSession();
    return data.session?.user.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Свой баланс из БД. Возвращает число или null (гость / не настроено /
 * счёт ещё не создан триггером / офлайн — деньги целы, это не 0).
 */
export async function fetchMyBalance(): Promise<number | null> {
  const sb = getSupabase();
  if (!sb) return null;
  try {
    const { data: sessionData } = await sb.auth.getSession();
    const uid = sessionData.session?.user.id;
    if (!uid) return null;
    const { data, error } = await sb
      .from('profiles')
      .select('balance')
      .eq('user_id', uid)
      .single();
    if (error || !data) return null;
    const balance = Number((data as unknown as { balance: unknown }).balance);
    return Number.isFinite(balance) && balance >= 0 ? balance : null;
  } catch {
    return null;
  }
}

/**
 * Живая подписка на свой баланс (postgres_changes по public.profiles).
 * Без настроенного хранилища или uid — noop-отписка.
 */
export function subscribeMyBalance(
  uid: string,
  onBalance: (balance: number) => void,
): () => void {
  const sb = getSupabase();
  if (!sb || !uid) return () => {};
  try {
    const channel = sb.channel(`alysque:balance:${uid}`, {
      config: { broadcast: { self: false } },
    });
    channel
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'profiles',
          filter: `user_id=eq.${uid}`,
        },
        (payload) => {
          const row = (payload.new ?? {}) as Record<string, unknown>;
          const balance = Number(row['balance']);
          if (Number.isFinite(balance) && balance >= 0) onBalance(balance);
        },
      )
      .subscribe();
    return () => {
      try {
        void sb.removeChannel(channel);
      } catch {
        // отписка — best effort
      }
    };
  } catch {
    return () => {};
  }
}
