/**
 * Ядро живых подписок: реестр каналов без DOM, сети и Supabase.
 *
 * Этап 1 архитектурного ревью (кандидат B). Живой транспорт Supabase и
 * единственный вход для страницы — в src/lib/live.ts; здесь только механика:
 *
 * - ключ подписки — «таблица + событие + фильтр»: одинаковые ключи делят один
 *   канал на страницу, сколько бы вызывающих ни подписалось;
 * - каждая подписка — своя доля: отписка снимает только её, канал закрывается
 *   с уходом последней (реф-каунт);
 * - исключение слушателя не глушит доставку остальным; отказ транспорта —
 *   null, повторная подписка попробует снова.
 *
 * Тесты — src/lib/live-core.test.ts с fake-транспортом.
 */

/** Куда подписываемся: таблица Realtime-публикации, событие и (необязательно) фильтр PostgREST. */
export interface LiveSubscription {
  table: 'lots' | 'profiles' | 'purchases';
  event: 'INSERT' | 'UPDATE' | 'DELETE' | '*';
  filter?: string;
}

/** Полезная нагрузка postgres_changes: new/old — как их отдаёт Supabase. */
export interface LivePayload {
  new?: Record<string, unknown>;
  old?: Record<string, unknown>;
}

/** Транспорт живых подписок: открыть канал. null — открыть не удалось. */
export interface LiveTransport {
  open(sub: LiveSubscription, onPayload: (payload: LivePayload) => void): (() => void) | null;
}

export interface LiveRegistry {
  /** Функция отписки; null — канал не открылся (повторный вызов попробует снова). */
  subscribe(sub: LiveSubscription, onPayload: (payload: LivePayload) => void): (() => void) | null;
}

/** Одна доля подписки: запись-объект, чтобы одинаковые колбэки не склеивались. */
interface LiveListener {
  fn: (payload: LivePayload) => void;
}

/** Ключ подписки: одинаковые ключи делят один канал. */
function subscriptionKey(sub: LiveSubscription): string {
  return `${sub.table}|${sub.event}|${sub.filter ?? ''}`;
}

/** Реестр каналов: реф-каунт по ключу подписки и веер payload'ов долям. */
export function createLiveRegistry(transport: LiveTransport): LiveRegistry {
  const entries = new Map<string, { listeners: LiveListener[]; close: () => void }>();

  return {
    subscribe(sub, onPayload) {
      const key = subscriptionKey(sub);
      let entry = entries.get(key);
      if (!entry) {
        const listeners: LiveListener[] = [];
        let close: (() => void) | null;
        try {
          close = transport.open(sub, (payload) => {
            // Слушатель-A не должен глушить доставку остальным: исключение гасим.
            for (const listener of [...listeners]) {
              try {
                listener.fn(payload);
              } catch {
                // best effort: канал общий, один сломанный подписчик других не задевает
              }
            }
          });
        } catch {
          close = null;
        }
        if (typeof close !== 'function') return null;
        entry = { listeners, close };
        entries.set(key, entry);
      }
      const listener: LiveListener = { fn: onPayload };
      entry.listeners.push(listener);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        const at = entry.listeners.indexOf(listener);
        if (at >= 0) entry.listeners.splice(at, 1);
        if (entry.listeners.length > 0) return;
        entries.delete(key);
        try {
          entry.close();
        } catch {
          // отписка — best effort
        }
      };
    },
  };
}
