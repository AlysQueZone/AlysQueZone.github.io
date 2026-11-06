import { describe, expect, it } from 'vitest';
import type { GambaOutcome } from './gamba';
import {
  SEGMENTS,
  SPIN_MS,
  WHEEL_PATTERN,
  assertWheelPattern,
  createGambaCeremony,
  outcomePool,
  targetSegment,
  type GambaCeremonyEffect,
  type GambaCeremonyEvent,
  type GambaStage,
} from './gamba-ceremony';

function makeCeremony(start = 0) {
  let now = start;
  const ceremony = createGambaCeremony({ now: () => now });
  return {
    advance(ms: number) {
      now += ms;
    },
    dispatch(event: GambaCeremonyEvent): GambaCeremonyEffect[] {
      return ceremony.dispatch(event);
    },
    state() {
      return ceremony.state();
    },
    stage(): GambaStage {
      return ceremony.state().stage;
    },
  };
}

function spin(outcome: GambaOutcome, start = 0) {
  const harness = makeCeremony(start);
  harness.dispatch({ type: 'start' });
  harness.dispatch({ type: 'result', outcome });
  return harness;
}

describe('переходы церемонии', () => {
  it('start → requesting и придерживает баланс', () => {
    const { dispatch, state } = makeCeremony();
    expect(dispatch({ type: 'start' })).toEqual([{ type: 'holdBalance' }]);
    expect(state()).toMatchObject({
      stage: 'requesting',
      outcome: null,
      spunAt: null,
      endedAt: null,
    });
  });

  it('повторный start не захватывает баланс дважды', () => {
    const { dispatch, stage } = makeCeremony();
    dispatch({ type: 'start' });
    expect(dispatch({ type: 'start' })).toEqual([]);
    expect(stage()).toBe('requesting');
  });

  it('result → spinning и animate с исходом', () => {
    const harness = makeCeremony(100);
    harness.dispatch({ type: 'start' });
    harness.advance(250);
    expect(harness.dispatch({ type: 'result', outcome: 'big' })).toEqual([
      { type: 'animate', outcome: 'big' },
    ]);
    expect(harness.state()).toMatchObject({
      stage: 'spinning',
      outcome: 'big',
      spunAt: 350,
      endedAt: null,
    });
  });

  it('result в idle игнорируется — крутить нечего', () => {
    const { dispatch, stage } = makeCeremony();
    expect(dispatch({ type: 'result', outcome: 'small' })).toEqual([]);
    expect(stage()).toBe('idle');
  });

  it('finish → revealed: исход, пул и раскрытие баланса одним моментом', () => {
    const harness = spin('big');
    harness.advance(SPIN_MS);
    expect(harness.dispatch({ type: 'finish' })).toEqual([
      { type: 'reveal', outcome: 'big' },
      { type: 'playPool', pool: 'win' },
      { type: 'releaseBalance' },
    ]);
    expect(harness.state()).toMatchObject({ stage: 'revealed', endedAt: SPIN_MS });
  });

  it('finish без крутки игнорируется', () => {
    const { dispatch, stage } = makeCeremony();
    dispatch({ type: 'start' });
    expect(dispatch({ type: 'finish' })).toEqual([]);
    expect(stage()).toBe('requesting');
  });

  it('abort в requesting → aborted и раскрытие баланса ровно один раз', () => {
    const { dispatch, stage } = makeCeremony();
    dispatch({ type: 'start' });
    expect(dispatch({ type: 'abort' })).toEqual([{ type: 'releaseBalance' }]);
    expect(stage()).toBe('aborted');
    expect(dispatch({ type: 'abort' })).toEqual([]);
  });

  it('abort в idle закрывает гонку «окно закрыли до старта RPC»', () => {
    const { dispatch, stage } = makeCeremony();
    expect(dispatch({ type: 'abort' })).toEqual([]);
    expect(stage()).toBe('aborted');
    expect(dispatch({ type: 'start' })).toEqual([]);
    expect(dispatch({ type: 'result', outcome: 'big' })).toEqual([]);
    expect(stage()).toBe('aborted');
  });

  it('после reset закрытая до старта церемония снова стартует', () => {
    const { dispatch, stage } = makeCeremony();
    dispatch({ type: 'abort' });
    dispatch({ type: 'reset' });
    expect(dispatch({ type: 'start' })).toEqual([{ type: 'holdBalance' }]);
    expect(stage()).toBe('requesting');
  });

  it('abort в spinning → aborted и раскрытие баланса ровно один раз', () => {
    const harness = spin('return');
    expect(harness.dispatch({ type: 'abort' })).toEqual([{ type: 'releaseBalance' }]);
    expect(harness.stage()).toBe('aborted');
    expect(harness.dispatch({ type: 'abort' })).toEqual([]);
  });

  it('result после abort не меняет состояние и не крутит', () => {
    const { dispatch, state } = makeCeremony();
    dispatch({ type: 'start' });
    dispatch({ type: 'abort' });
    const aborted = state();
    expect(dispatch({ type: 'result', outcome: 'jackpot' })).toEqual([]);
    expect(state()).toEqual(aborted);
  });

  it('finish после revealed не раскрывает баланс повторно', () => {
    const harness = spin('small');
    harness.dispatch({ type: 'finish' });
    expect(harness.dispatch({ type: 'finish' })).toEqual([]);
    expect(harness.dispatch({ type: 'abort' })).toEqual([]);
    expect(harness.stage()).toBe('revealed');
  });

  it('reset после ошибки возвращает idle, раскрывает баланс и разрешает повтор', () => {
    const released = makeCeremony();
    released.dispatch({ type: 'start' });
    expect(released.dispatch({ type: 'reset' })).toEqual([{ type: 'releaseBalance' }]);
    expect(released.stage()).toBe('idle');
    expect(released.dispatch({ type: 'start' })).toEqual([{ type: 'holdBalance' }]);

    const aborted = makeCeremony();
    aborted.dispatch({ type: 'start' });
    aborted.dispatch({ type: 'abort' });
    expect(aborted.dispatch({ type: 'reset' })).toEqual([]);
    expect(aborted.stage()).toBe('idle');
  });
});

describe('Пул звуков исхода', () => {
  it.each([
    ['return', 'lose'],
    ['miss', 'lose'],
    ['small', 'win'],
    ['big', 'win'],
    ['jackpot', 'jackpot'],
  ] as const)('исход %s звучит пулом %s', (outcome, pool) => {
    const harness = spin(outcome);
    expect(harness.dispatch({ type: 'finish' })).toContainEqual({ type: 'playPool', pool });
  });

  it('неизвестный исход — lose', () => {
    expect(outcomePool('svetofor')).toBe('lose');
    expect(outcomePool('')).toBe('lose');
  });
});

describe('колесо', () => {
  it('WHEEL_PATTERN проходит валидацию: 12 сегментов 9/1/1/1', () => {
    expect(() => assertWheelPattern(WHEEL_PATTERN)).not.toThrow();
    expect(SEGMENTS).toHaveLength(12);
    const counts = SEGMENTS.reduce<Record<string, number>>((acc, segment) => {
      acc[segment.outcome] = (acc[segment.outcome] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts).toEqual({ return: 9, small: 1, big: 1, jackpot: 1 });
  });

  it.each([
    ['короткий', 'RSRRBRRJRRR'],
    ['длинный', 'RSRRBRRJRRRRR'],
    ['чужой символ', 'XSRRBRRJRRRR'],
    ['не тот счёт', 'SSRRBRRJRRRR'],
  ])('битый паттерн падает: %s', (_name, pattern) => {
    expect(() => assertWheelPattern(pattern)).toThrow(/WHEEL_PATTERN/);
  });

  it('targetSegment выбирает сегмент исхода, random инъектируется', () => {
    expect(targetSegment('return', () => 0)).toBe(0);
    expect(targetSegment('small', () => 0)).toBe(1);
    expect(targetSegment('big', () => 0)).toBe(4);
    expect(targetSegment('jackpot', () => 0)).toBe(7);
    expect(targetSegment('return', () => 0.999)).toBe(11);
    expect(SEGMENTS[targetSegment('jackpot', () => 0.999)]?.outcome).toBe('jackpot');
  });

  it('legacy miss — любой сегмент колеса', () => {
    expect(targetSegment('miss', () => 0)).toBe(0);
    expect(targetSegment('miss', () => 0.999)).toBe(11);
  });

  it('SPIN_MS — длительность церемонии', () => {
    expect(SPIN_MS).toBe(4200);
  });
});
