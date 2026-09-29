/**
 * Живые данные: единственный владелец живых подписок страницы.
 *
 * Этап 1 архитектурного ревью (кандидат B): реестр каналов. Снапшот состояния
 * и доменные события — следующие этапы, интерфейс не расширяем заранее.
 *
 * Правило: канал Realtime открывает только этот модуль. На одинаковые подписки
 * (таблица + событие + фильтр) — один канал на страницу, сколько бы вызывающих
 * ни подписалось; канал закрывается, когда уходит последний подписчик.
 * Раньше каждый вызывающий звал `sb.channel()` сам: на странице лота жили два
 * канала с одним topic (`alysque:lot:<slug>`), а отписки витрины и колокола
 * никто не держал.
 *
 * Транспорт (Supabase) инъектируется: ядро реестра чистое, тесты гоняют его
 * с fake-транспортом (src/lib/live.test.ts) — без сети, DOM и Supabase.
 */
import { getSupabase } from './supabase';

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

/** Ключ подписки: одинаковые ключи делят один канал. */
function subscriptionKey(sub: LiveSubscription): string {
  return `${sub.table}|${sub.event}|${sub.filter ?? ''}`;
}

/**
 * Реестр каналов: реф-каунт по ключу подписки и веер payload'ов подписчикам.
 * Открытие/закрытие канала — за транспортом; ошибки транспорта не бросаем
 * наружу: вызывающий отличает «не открылось» по null и может повторить.
 */
export function createLiveRegistry(transport: LiveTransport): LiveRegistry {
  const entries = new Map<
    string,
    { listeners: Set<(payload: LivePayload) => void>; close: () => void }
  >();

  return {
    subscribe(sub, onPayload) {
      const key = subscriptionKey(sub);
      let entry = entries.get(key);
      if (!entry) {
        const listeners = new Set<(payload: LivePayload) => void>();
        const close = transport.open(sub, (payload) => {
          // Слушатель-A не должен глушить доставку остальным: исключение гасим.
          for (const listener of [...listeners]) {
            try {
              listener(payload);
            } catch {
              // best effort: канал общий, один сломанный подписчик других не задевает
            }
          }
        });
        if (typeof close !== 'function') return null;
        entry = { listeners, close };
        entries.set(key, entry);
      }
      entry.listeners.add(onPayload);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        entry.listeners.delete(onPayload);
        if (entry.listeners.size > 0) return;
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

/** Живой транспорт поверх Supabase Realtime (postgres_changes). */
function supabaseTransport(): LiveTransport {
  return {
    open(sub, onPayload) {
      const sb = getSupabase();
      if (!sb) return null;
      const topic = `alysque:live:${sub.table}:${sub.event}:${sub.filter ?? 'all'}`;
      try {
        const filter = {
          event: sub.event,
          schema: 'public',
          table: sub.table,
          ...(sub.filter ? { filter: sub.filter } : {}),
        };
        const channel = sb
          .channel(topic, { config: { broadcast: { self: false } } })
          .on('postgres_changes', filter, (payload) => onPayload(payload as LivePayload))
          .subscribe();
        return () => {
          try {
            void sb.removeChannel(channel);
          } catch {
            // отписка — best effort
          }
        };
      } catch {
        return null;
      }
    },
  };
}

const registry = createLiveRegistry(supabaseTransport());

/**
 * Единственный вход для живых подписок страницы (правило — в шапке модуля).
 * Возвращает отписку или null, если хранилище не настроено / канал не открылся.
 */
export function subscribeLive(
  sub: LiveSubscription,
  onPayload: (payload: LivePayload) => void
): (() => void) | null {
  return registry.subscribe(sub, onPayload);
}
