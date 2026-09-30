/**
 * Тесты ядра живых подписок (docs/adr/0003): реф-каунт каналов,
 * веер payload'ов, честный null при отказе транспорта.
 *
 * Гоняются с fake-транспортом — без сети, DOM и Supabase; проверяют ровно те
 * баги, из-за которых реестр появился: общий канал на одинаковые подписки и
 * отписку, которая не должна трогать чужие доли.
 */
import { describe, expect, it } from 'vitest';
import {
  createLiveRegistry,
  type LivePayload,
  type LiveSubscription,
  type LiveTransport,
} from './live-core';

interface FakeChannel {
  spec: LiveSubscription;
  emit: (payload: LivePayload) => void;
  closed: boolean;
}

/** Транспорт-двойник: записывает открытия/закрытия и умеет отказывать. */
function fakeTransport(): {
  transport: LiveTransport;
  channels: FakeChannel[];
  refuse: { on: boolean };
} {
  const channels: FakeChannel[] = [];
  const refuse = { on: false };
  const transport: LiveTransport = {
    open(spec, onPayload) {
      if (refuse.on) return null;
      const channel: FakeChannel = { spec, emit: onPayload, closed: false };
      channels.push(channel);
      return () => {
        channel.closed = true;
      };
    },
  };
  return { transport, channels, refuse };
}

const LOTS: LiveSubscription = { table: 'lots', event: '*' };

describe('createLiveRegistry', () => {
  it('одинаковые подписки делят один канал и слышат обе', () => {
    const { transport, channels } = fakeTransport();
    const registry = createLiveRegistry(transport);
    const heardA: LivePayload[] = [];
    const heardB: LivePayload[] = [];

    registry.subscribe(LOTS, (p) => heardA.push(p));
    registry.subscribe(LOTS, (p) => heardB.push(p));

    expect(channels).toHaveLength(1);
    channels[0].emit({ new: { slug: 'lot-a' } });
    expect(heardA).toHaveLength(1);
    expect(heardB).toHaveLength(1);
  });

  it('разные фильтры — разные каналы', () => {
    const { transport, channels } = fakeTransport();
    const registry = createLiveRegistry(transport);

    registry.subscribe({ ...LOTS, filter: 'slug=eq.a' }, () => {});
    registry.subscribe({ ...LOTS, filter: 'slug=eq.a' }, () => {});
    registry.subscribe({ ...LOTS, filter: 'slug=eq.b' }, () => {});

    expect(channels).toHaveLength(2);
    expect(channels.map((c) => c.spec.filter)).toEqual(['slug=eq.a', 'slug=eq.b']);
  });

  it('канал держится, пока есть подписчики, и закрывается на последнем', () => {
    const { transport, channels } = fakeTransport();
    const registry = createLiveRegistry(transport);
    const unsubscribeA = registry.subscribe(LOTS, () => {});
    const unsubscribeB = registry.subscribe(LOTS, () => {});

    expect(unsubscribeA).not.toBeNull();
    expect(unsubscribeB).not.toBeNull();
    unsubscribeA?.();
    expect(channels[0].closed).toBe(false);
    unsubscribeB?.();
    expect(channels[0].closed).toBe(true);
  });

  it('один и тот же колбэк дважды — две доли: отписка одной не закрывает канал', () => {
    const { transport, channels } = fakeTransport();
    const registry = createLiveRegistry(transport);
    let calls = 0;
    const cb = (): void => {
      calls += 1;
    };

    const unsubscribeA = registry.subscribe(LOTS, cb);
    const unsubscribeB = registry.subscribe(LOTS, cb);
    channels[0].emit({ new: { slug: 'lot-a' } });
    expect(calls).toBe(2);

    unsubscribeA?.();
    expect(channels[0].closed).toBe(false);
    channels[0].emit({ new: { slug: 'lot-a' } });
    expect(calls).toBe(3);

    unsubscribeB?.();
    expect(channels[0].closed).toBe(true);
  });

  it('отписка идемпотентна: повторный вызов канал не закрывает дважды', () => {
    const { transport, channels } = fakeTransport();
    const registry = createLiveRegistry(transport);
    const unsubscribe = registry.subscribe(LOTS, () => {});

    unsubscribe?.();
    unsubscribe?.();
    expect(channels[0].closed).toBe(true);
    expect(channels).toHaveLength(1);
  });

  it('после закрытия подписка того же ключа открывает канал заново', () => {
    const { transport, channels } = fakeTransport();
    const registry = createLiveRegistry(transport);

    registry.subscribe(LOTS, () => {})?.();
    registry.subscribe(LOTS, () => {});
    expect(channels).toHaveLength(2);
  });

  it('отказ транспорта — null, и повторная подписка пробует снова', () => {
    const { transport, channels, refuse } = fakeTransport();
    const registry = createLiveRegistry(transport);

    refuse.on = true;
    expect(registry.subscribe(LOTS, () => {})).toBeNull();
    expect(channels).toHaveLength(0);

    refuse.on = false;
    expect(registry.subscribe(LOTS, () => {})).not.toBeNull();
    expect(channels).toHaveLength(1);
  });

  it('бросающий транспорт — null, а не исключение наружу', () => {
    const throwing: LiveTransport = {
      open() {
        throw new Error('транспорт сломан');
      },
    };
    const registry = createLiveRegistry(throwing);

    expect(() => registry.subscribe(LOTS, () => {})).not.toThrow();
    expect(registry.subscribe(LOTS, () => {})).toBeNull();
  });

  it('исключение в слушателе не глушит доставку остальным', () => {
    const { transport, channels } = fakeTransport();
    const registry = createLiveRegistry(transport);
    const heard: LivePayload[] = [];

    registry.subscribe(LOTS, () => {
      throw new Error('сломанный подписчик');
    });
    registry.subscribe(LOTS, (p) => heard.push(p));

    expect(() => channels[0].emit({ new: { slug: 'lot-a' } })).not.toThrow();
    expect(heard).toHaveLength(1);
  });
});
