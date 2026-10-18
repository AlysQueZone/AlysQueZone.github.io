import { describe, expect, it } from 'vitest';
import { POOL_NAMES, parseSoundPools, type SoundPool } from './gamba-sounds';

/** Полный набор строк: по одному файлу на каждый пул. */
function rows(overrides: Partial<Record<SoundPool, number>> = {}): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const pool of POOL_NAMES) {
    const count = overrides[pool] ?? 1;
    for (let i = 0; i < count; i++) out.push({ pool, file: `${pool}-${i}.mp3` });
  }
  return out;
}

describe('parseSoundPools', () => {
  it('раскладывает строки по пулам', () => {
    const pools = parseSoundPools([...rows(), { pool: 'spin', file: 'gamba-bg.mp3' }]);
    expect(pools).not.toBeNull();
    expect(pools?.['spin']).toEqual(['spin-0.mp3', 'gamba-bg.mp3']);
    expect(pools?.['lose']).toEqual(['lose-0.mp3']);
  });

  it('пустой пул — брак: лучше фолбэк, чем тишина на стадии', () => {
    expect(parseSoundPools(rows({ jackpot: 0 }))).toBeNull();
    expect(parseSoundPools([])).toBeNull();
  });

  it('мусорные строки пропускает, но пустым из-за них не сдаётся', () => {
    const pools = parseSoundPools([
      ...rows(),
      { pool: 'svetofor', file: 'krasny.mp3' },
      { pool: 'win', file: '' },
      { pool: 'win' },
      { pool: 'win', file: 42 },
    ]);
    expect(pools?.['win']).toEqual(['win-0.mp3']);
  });
});
