/**
 * Баланс Пивкойнов из БД (тикеты 07–11, pivkoiny-backend).
 *
 * Единственный источник истины — таблица `public.profiles` (RLS — только свой
 * баланс). Локальный кошелёк удалён в тикете 11: без сессии деньги не читаются
 * (гость видит прочерк), межвкладочный `storage`-синк убран — тик даёт Realtime.
 *
 * - Гость без сессии: деньги не читаются → null, витрина видна и так.
 * - Без настроенных PUBLIC_SUPABASE_* → null (честная деградация).
 * - Секретов здесь нет: только publishable-ключ через getSupabase().
 */

import { getSupabase } from './supabase';

/** Отразить баланс во всех чипах шапки (`data-wallet-balance`). */
export function paintBalance(balance: number): void {
  document.querySelectorAll('[data-wallet-balance]').forEach((el) => {
    el.textContent = String(balance);
  });
  announceBalance(balance);
}

/** Общий поток баланса: единственная подписка BaseLayout транслирует значение
 *  остальным (витрина/страница лота/модалка), чтобы не плодить Supabase-каналы
 *  на один topic. Баланс — зеркало гейта, истина всё равно на сервере. */
export function announceBalance(balance: number): void {
  window.dispatchEvent(new CustomEvent('alysque:balance', { detail: balance }));
}

/** Подписка на живой баланс (событие `announceBalance`). Возвращает отписку. */
export function onBalance(cb: (balance: number) => void): () => void {
  const handler = (e: Event): void => {
    const value = (e as CustomEvent<unknown>).detail;
    if (typeof value === 'number' && Number.isFinite(value)) cb(value);
  };
  window.addEventListener('alysque:balance', handler);
  return () => window.removeEventListener('alysque:balance', handler);
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
    const { data, error } = await sb.from('profiles').select('balance').eq('user_id', uid).single();
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
export function subscribeMyBalance(uid: string, onBalance: (balance: number) => void): () => void {
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
          if (Number.isFinite(balance) && balance >= 0) {
            onBalance(balance);
            announceBalance(balance);
          }
        }
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
