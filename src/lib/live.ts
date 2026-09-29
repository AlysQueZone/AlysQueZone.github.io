/**
 * Живой транспорт страницы: подписки Supabase Realtime через реестр ядра.
 *
 * Единственный вход для живых подписок (правило: `sb.channel()` вне этого
 * модуля не зовём — docs/adr/0003). Ядро реестра — src/lib/live-core.ts,
 * транспорт (Supabase) инъектируется: тесты гоняют ядро с fake-транспортом.
 */
import { getSupabase } from './supabase';
import {
  createLiveRegistry,
  type LivePayload,
  type LiveSubscription,
  type LiveTransport,
} from './live-core';

/** Живой транспорт поверх Supabase Realtime (postgres_changes). */
function supabaseTransport(): LiveTransport {
  return {
    open(sub, onPayload) {
      try {
        const sb = getSupabase();
        if (!sb) return null;
        const topic = `alysque:live:${sub.table}:${sub.event}:${sub.filter ?? 'all'}`;
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
        // хранилище не настроено или канал не открылся — вызывающий повторит
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
