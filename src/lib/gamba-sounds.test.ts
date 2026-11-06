import { describe, expect, it } from 'vitest';
import { s3Sound } from './media';
import {
  POOL_KEYS,
  POOL_NAMES,
  decodePool,
  encodePools,
  parseSoundPools,
  poolDataKey,
  readPools,
  type SoundPool,
  type SoundPools,
} from './gamba-sounds';

/** Полный набор строк: по одному файлу на каждый пул. */
function rows(overrides: Partial<Record<SoundPool, number>> = {}): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const pool of POOL_NAMES) {
    const count = overrides[pool] ?? 1;
    for (let i = 0; i < count; i++) out.push({ pool, file: `${pool}-${i}.mp3` });
  }
  return out;
}

function makePools(files: Partial<Record<SoundPool, string[]>> = {}): SoundPools {
  return {
    spin: files.spin ?? ['spin-0.mp3', 'spin-1.mp3'],
    win: files.win ?? ['win-0.mp3'],
    jackpot: files.jackpot ?? ['jackpot-0.mp3'],
    lose: files.lose ?? ['lose-0.mp3'],
  };
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

describe('кодек пулов', () => {
  it('encode → readPools: те же пулы в виде абсолютных S3-URL', () => {
    const source = makePools();
    const encoded = encodePools(source);
    expect(encoded).toEqual({
      spinPool: source.spin.map(s3Sound).join(','),
      winPool: source.win.map(s3Sound).join(','),
      jackpotPool: source.jackpot.map(s3Sound).join(','),
      losePool: source.lose.map(s3Sound).join(','),
    });
    expect(readPools(encoded)).toEqual({
      spin: source.spin.map(s3Sound),
      win: source.win.map(s3Sound),
      jackpot: source.jackpot.map(s3Sound),
      lose: source.lose.map(s3Sound),
    });
  });

  it('decodePool: пусто и мусор — [], пробелы режутся', () => {
    expect(decodePool('')).toEqual([]);
    expect(decodePool('   ')).toEqual([]);
    expect(decodePool(null)).toEqual([]);
    expect(decodePool(undefined)).toEqual([]);
    expect(decodePool(' , ,,')).toEqual([]);
    expect(decodePool(' a.mp3 ,, b.mp3 ,')).toEqual(['a.mp3', 'b.mp3']);
  });

  it('readPools: отсутствующие атрибуты — пустые пулы', () => {
    expect(readPools({})).toEqual({ spin: [], win: [], jackpot: [], lose: [] });
    expect(readPools({ spinPool: 'a.mp3' }).spin).toEqual(['a.mp3']);
  });

  it('имена пулов и data-ключи — из одного источника', () => {
    expect(Object.keys(POOL_KEYS).sort()).toEqual([...POOL_NAMES].sort());
    for (const pool of POOL_NAMES) {
      expect(poolDataKey(pool)).toBe(`${pool}Pool`);
      expect(POOL_KEYS[pool]).toBe(poolDataKey(pool));
    }
  });
});
