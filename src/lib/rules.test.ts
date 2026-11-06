import { describe, expect, it } from 'vitest';
import {
  COMMISSION_RATE,
  DAILY_REWARDS,
  GAMBA_DAILY_LIMIT,
  GAMBA_STAKE,
  GROWTH_PURCHASES,
  GROWTH_STEP_PCT,
  ROYALTY_PURCHASES,
  ROYALTY_RATE,
  START_BALANCE,
  SUBMISSION_BONUS,
  commissionFor,
  commissionLine,
  commissionSplit,
  dailyCycleLine,
  dailyShortLine,
  gambaLine,
  growthLine,
  rewardLine,
  startBalanceLine,
} from './rules';

describe('DAILY_REWARDS', () => {
  it('семь дней канонического цикла', () => {
    expect(DAILY_REWARDS).toHaveLength(7);
    expect([...DAILY_REWARDS]).toEqual([200, 200, 250, 150, 200, 250, 500]);
  });
});

describe('commissionSplit', () => {
  it('7% = 4% сгорает + 3% автору', () => {
    expect(commissionSplit()).toEqual({ commissionPct: 7, burnPct: 4, royaltyPct: 3 });
  });
});

describe('commissionFor', () => {
  it('ceil(7%), минимум 1', () => {
    expect(commissionFor(99)).toBe(7);
    expect(commissionFor(120)).toBe(9);
    expect(commissionFor(1)).toBe(1);
  });

  it('ноль, отрицательное и не-число — без комиссии', () => {
    expect(commissionFor(0)).toBe(0);
    expect(commissionFor(-5)).toBe(0);
    expect(commissionFor(Number.NaN)).toBe(0);
    expect(commissionFor(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('строки правил', () => {
  it('commissionLine собирается из констант', () => {
    const line = commissionLine();
    expect(line).toContain(`${Math.round(COMMISSION_RATE * 100)}%`);
    expect(line).toContain(`${Math.round(ROYALTY_RATE * 100)}%`);
    expect(line).toContain(`${Math.round((COMMISSION_RATE - ROYALTY_RATE) * 100)}%`);
    expect(line).toContain(`${ROYALTY_PURCHASES} перекупа`);
  });

  it('rewardLine собирается из констант', () => {
    expect(rewardLine()).toBe(
      `+${SUBMISSION_BONUS} сразу и ${Math.round(ROYALTY_RATE * 100)}% с первых ${ROYALTY_PURCHASES} перекупов`
    );
  });

  it('growthLine содержит шаг, число покупок и минимум', () => {
    const line = growthLine();
    expect(line).toContain(`${GROWTH_STEP_PCT}%`);
    expect(line).toContain(`${GROWTH_PURCHASES}`);
    expect(line).toContain('+1');
  });

  it('dailyCycleLine содержит весь цикл и старт', () => {
    const line = dailyCycleLine();
    for (const reward of DAILY_REWARDS) expect(line).toContain(String(reward));
    expect(line).toContain(startBalanceLine());
  });

  it('dailyShortLine — первые три дня цикла', () => {
    const line = dailyShortLine();
    expect(line).toContain(DAILY_REWARDS.slice(0, 3).join(' / '));
    expect(line).not.toContain(String(DAILY_REWARDS[3]));
  });

  it('startBalanceLine и gambaLine собираются из констант', () => {
    expect(startBalanceLine()).toBe(`Старт — ${START_BALANCE}`);
    expect(gambaLine()).toBe(`ставка ${GAMBA_STAKE} · ${GAMBA_DAILY_LIMIT} спинов в день`);
  });
});
