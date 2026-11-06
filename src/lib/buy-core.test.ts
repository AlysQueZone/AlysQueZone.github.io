import { describe, expect, it } from 'vitest';
import type { BuyIntent } from './buy-intent';
import {
  createBuyCore,
  mapBuyError,
  pauseRemainingSec,
  type BuyEffect,
  type BuyEvent,
  type BuyState,
} from './buy-core';

const intent: BuyIntent = {
  slug: 'lot-privet-bradhi',
  title: 'Привет Брадхи',
  price: 120,
  owner: 'alysque',
  video: null,
};

function makeCore(start = 0) {
  let now = start;
  const core = createBuyCore({ now: () => now });
  return {
    core,
    advance(sec: number) {
      now += sec * 1000;
    },
    dispatch(event: BuyEvent): BuyEffect[] {
      return core.dispatch(event);
    },
    state(): BuyState {
      return core.state();
    },
  };
}

describe('intent / close', () => {
  it('гость входит в guest, намерение сохраняется', () => {
    const { dispatch, state } = makeCore();
    expect(dispatch({ type: 'intent', intent, guest: true })).toEqual([]);
    expect(state()).toMatchObject({ phase: 'guest', intent, pauseLeft: 0 });
  });

  it('залогиненный входит в confirm', () => {
    const { dispatch, state } = makeCore();
    dispatch({ type: 'intent', intent, guest: false });
    expect(state().phase).toBe('confirm');
  });

  it('close сбрасывает фазу и намерение', () => {
    const { dispatch, state } = makeCore();
    dispatch({ type: 'intent', intent, guest: false });
    dispatch({ type: 'close' });
    expect(state()).toEqual({ phase: 'idle', intent: null, balance: null, pauseLeft: 0 });
  });
});

describe('refreshed', () => {
  it('обновляет баланс, цену и владельца', () => {
    const { dispatch, state } = makeCore();
    dispatch({ type: 'intent', intent, guest: false });
    dispatch({ type: 'refreshed', balance: 500, price: 150, owner: 'bradhi' });
    expect(state()).toMatchObject({
      phase: 'confirm',
      balance: 500,
      intent: { ...intent, price: 150, owner: 'bradhi' },
    });
  });

  it.each(['pause', 'limit', 'busy'] as const)('не затирает фазу %s', (phase) => {
    const { dispatch, state } = makeCore();
    dispatch({ type: 'intent', intent, guest: false });
    if (phase === 'pause') {
      dispatch({
        type: 'result',
        result: { status: 'blocked', kind: 'cooldown', retryAfterSec: 10, raw: '' },
      });
    } else if (phase === 'limit') {
      dispatch({ type: 'result', result: { status: 'blocked', kind: 'rate-limit', raw: '' } });
    } else {
      dispatch({ type: 'busy' });
    }
    dispatch({ type: 'refreshed', balance: 99, price: 130, owner: 'bradhi' });
    expect(state().phase).toBe(phase);
    expect(state().balance).toBe(99);
    expect(state().intent).toMatchObject({ price: 130, owner: 'bradhi' });
  });

  it('null-цена законна: цена неизвестна', () => {
    const { dispatch, state } = makeCore();
    dispatch({ type: 'intent', intent, guest: false });
    dispatch({ type: 'refreshed', price: null, balance: null });
    expect(state().intent?.price).toBeNull();
    expect(state().balance).toBeNull();
  });
});

describe('pause / tick', () => {
  it('входит в Паузу и уменьшает остаток по инъектированным часам', () => {
    const clock = makeCore(1_000);
    clock.dispatch({ type: 'intent', intent, guest: false });
    expect(
      clock.dispatch({
        type: 'result',
        result: { status: 'blocked', kind: 'cooldown', retryAfterSec: 10, raw: '' },
      })
    ).toEqual([{ type: 'pauseTimer', seconds: 10 }]);
    expect(clock.state()).toMatchObject({ phase: 'pause', pauseLeft: 10 });

    clock.advance(3);
    expect(clock.dispatch({ type: 'tick' })).toEqual([]);
    expect(clock.state()).toMatchObject({ phase: 'pause', pauseLeft: 7 });
  });

  it('на нуле — confirm и обновление цены', () => {
    const clock = makeCore(0);
    clock.dispatch({ type: 'intent', intent, guest: false });
    clock.dispatch({
      type: 'result',
      result: { status: 'blocked', kind: 'cooldown', retryAfterSec: 5, raw: '' },
    });
    clock.advance(5);
    expect(clock.dispatch({ type: 'tick' })).toEqual([{ type: 'refreshPrice', slug: intent.slug }]);
    expect(clock.state()).toMatchObject({ phase: 'confirm', pauseLeft: 0 });
  });

  it('tick вне Паузы ничего не делает', () => {
    const { dispatch, state } = makeCore();
    dispatch({ type: 'intent', intent, guest: false });
    expect(dispatch({ type: 'tick' })).toEqual([]);
    expect(state().phase).toBe('confirm');
  });

  it('проекция Паузы входит в pause и отдаёт таймер', () => {
    const clock = makeCore(0);
    clock.dispatch({ type: 'intent', intent, guest: false });
    expect(clock.dispatch({ type: 'pause', seconds: 12 })).toEqual([
      { type: 'pauseTimer', seconds: 12 },
    ]);
    expect(clock.state()).toMatchObject({ phase: 'pause', pauseLeft: 12 });
  });
});

describe('busy', () => {
  it('ставится перед сетью и снимается результатом', () => {
    const { dispatch, state } = makeCore();
    dispatch({ type: 'intent', intent, guest: false });
    expect(dispatch({ type: 'busy' })).toEqual([]);
    expect(state().phase).toBe('busy');
    dispatch({ type: 'result', result: { status: 'blocked', kind: 'write-error', raw: '' } });
    expect(state().phase).toBe('confirm');
  });

  it('без намерения — noop', () => {
    const { dispatch, state } = makeCore();
    expect(dispatch({ type: 'busy' })).toEqual([]);
    expect(state().phase).toBe('idle');
  });
});

describe('result', () => {
  it('ok — celebrate(paid) и close', () => {
    const { dispatch, state } = makeCore();
    dispatch({ type: 'intent', intent, guest: false });
    dispatch({ type: 'busy' });
    expect(
      dispatch({ type: 'result', result: { status: 'ok', paid: 120, buyer: 'zare' } })
    ).toEqual([{ type: 'celebrate', paid: 120 }, { type: 'close' }]);
    expect(state().phase).toBe('idle');
  });

  it('cooldown с retryAfterSec входит в Паузу с этим остатком', () => {
    const { dispatch, state } = makeCore();
    dispatch({ type: 'intent', intent, guest: false });
    expect(
      dispatch({
        type: 'result',
        result: { status: 'blocked', kind: 'cooldown', retryAfterSec: 42, raw: '' },
      })
    ).toEqual([{ type: 'pauseTimer', seconds: 42 }]);
    expect(state()).toMatchObject({ phase: 'pause', pauseLeft: 42 });
  });

  it('cooldown без retryAfterSec — запасные 30 секунд', () => {
    const { dispatch, state } = makeCore();
    dispatch({ type: 'intent', intent, guest: false });
    expect(
      dispatch({ type: 'result', result: { status: 'blocked', kind: 'cooldown', raw: '' } })
    ).toEqual([{ type: 'pauseTimer', seconds: 30 }]);
    expect(state()).toMatchObject({ phase: 'pause', pauseLeft: 30 });
  });

  it('rate-limit — лимит окна', () => {
    const { dispatch, state } = makeCore();
    dispatch({ type: 'intent', intent, guest: false });
    expect(
      dispatch({ type: 'result', result: { status: 'blocked', kind: 'rate-limit', raw: '' } })
    ).toEqual([{ type: 'limit' }]);
    expect(state()).toMatchObject({ phase: 'limit', pauseLeft: 0 });
  });

  it('insufficient-funds — закрыть окно и уведомить', () => {
    const { dispatch, state } = makeCore();
    dispatch({ type: 'intent', intent, guest: false });
    expect(
      dispatch({
        type: 'result',
        result: { status: 'blocked', kind: 'insufficient-funds', raw: '' },
      })
    ).toEqual([{ type: 'close' }, { type: 'notice', kind: 'insufficient-funds' }]);
    expect(state().phase).toBe('idle');
  });

  it('unauthenticated — гостевой режим без редиректа', () => {
    const { dispatch, state } = makeCore();
    dispatch({ type: 'intent', intent, guest: false });
    expect(
      dispatch({ type: 'result', result: { status: 'blocked', kind: 'unauthenticated', raw: '' } })
    ).toEqual([]);
    expect(state().phase).toBe('guest');
  });

  it.each(['own-lot', 'missing-lot', 'price-cap', 'offline', 'write-error'] as const)(
    '%s — остаётся confirm и показывает уведомление',
    (kind) => {
      const { dispatch, state } = makeCore();
      dispatch({ type: 'intent', intent, guest: false });
      expect(dispatch({ type: 'result', result: { status: 'blocked', kind, raw: '' } })).toEqual([
        { type: 'notice', kind },
      ]);
      expect(state()).toMatchObject({ phase: 'confirm', pauseLeft: 0 });
    }
  );
});

describe('pauseRemainingSec', () => {
  it('считает остаток вверх до целой секунды', () => {
    expect(pauseRemainingSec(1_000, 1_000)).toBe(30);
    expect(pauseRemainingSec(1_000, 1_000 + 10_500)).toBe(20);
    expect(pauseRemainingSec(1_000, 1_000 + 500)).toBe(30);
  });

  it('после Паузы — ноль, не отрицательное', () => {
    expect(pauseRemainingSec(0, 31_000)).toBe(0);
    expect(pauseRemainingSec(0, 30_000)).toBe(0);
  });

  it('битая дата — ноль', () => {
    expect(pauseRemainingSec(Number.NaN, 1_000)).toBe(0);
    expect(pauseRemainingSec(1_000, Number.NaN)).toBe(0);
  });
});

describe('mapBuyError', () => {
  it.each([
    [new Error('cooldown 00:01:42'), 'cooldown'],
    [new Error('cooldown: 42s'), 'cooldown'],
    [new Error('rate limit reached'), 'rate-limit'],
    [new Error('max 10 purchases'), 'rate-limit'],
    [new Error('too many requests'), 'rate-limit'],
    [new Error('this lot is already yours'), 'own-lot'],
    [new Error('not authenticated'), 'unauthenticated'],
    [new Error('lot not found'), 'missing-lot'],
    [new Error('price cap reached'), 'price-cap'],
    [new Error('insufficient funds'), 'insufficient-funds'],
    [new Error('insufficient_funds'), 'insufficient-funds'],
    [new TypeError('Failed to fetch'), 'offline'],
    [new Error('boom'), 'write-error'],
  ] as const)('%s → %s', (error, kind) => {
    expect(mapBuyError(error).kind).toBe(kind);
  });

  it('парсит cooldown из hms, секунд и падает на запасные 30', () => {
    expect(mapBuyError(new Error('cooldown 00:00:42')).retryAfterSec).toBe(42);
    expect(mapBuyError(new Error('cooldown 42s')).retryAfterSec).toBe(42);
    expect(mapBuyError(new Error('cooldown 42 сек')).retryAfterSec).toBe(42);
    expect(mapBuyError(new Error('cooldown')).retryAfterSec).toBe(30);
  });

  it('сырой текст сохраняется для отладки', () => {
    expect(mapBuyError(new Error('boom')).raw).toBe('boom');
  });
});
