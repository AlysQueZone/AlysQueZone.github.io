/**
 * Звуки гамбы: пулы фраз по стадиям церемонии.
 *
 * Источник правды — манифест `content/sounds.toml`, рантайм-проекция — БД
 * (`public.gamba_sounds`, синк `just sounds-sync`); сборка печёт из манифеста
 * фолбэк `gamba-sounds.gen.ts`, который звучит, пока список не приехал из БД
 * (docs/adr/0011).
 *
 * Живых подписок здесь нет: список меняется синком, а не жизнью пользователя,
 * поэтому владелец живых данных (`lib/live.ts`) не при чём — это чтение
 * конфига, как плакат выплат.
 */
import { GAMBA_SOUND_POOLS_FALLBACK } from './gamba-sounds.gen';
import { s3Sound } from './media';
import { getSupabase } from './supabase';

/** Стадии церемонии; каждой соответствует свой пул (check в public.gamba_sounds). */
export const POOL_NAMES = ['spin', 'win', 'jackpot', 'lose'] as const;

export type SoundPool = (typeof POOL_NAMES)[number];

/** Пул -> имена файлов в бакете. */
export type SoundPools = Record<SoundPool, string[]>;

/** Фолбэк сборки: пулы манифеста на момент билда. */
export function fallbackSoundPools(): SoundPools {
  return {
    spin: [...GAMBA_SOUND_POOLS_FALLBACK.spin],
    win: [...GAMBA_SOUND_POOLS_FALLBACK.win],
    jackpot: [...GAMBA_SOUND_POOLS_FALLBACK.jackpot],
    lose: [...GAMBA_SOUND_POOLS_FALLBACK.lose],
  };
}

/** Значение data-атрибута пула: абсолютные S3-URL через запятую. */
export function poolAttribute(files: readonly string[]): string {
  return files.map((file) => s3Sound(file)).join(',');
}

function isSoundPool(value: unknown): value is SoundPool {
  return typeof value === 'string' && (POOL_NAMES as readonly string[]).includes(value);
}

/**
 * Строки `gamba_sounds` -> пулы. null — список неполный или мусорный: неполный
 * список — брак синка, а фолбэк сборки лучше тишины на стадии церемонии.
 */
export function parseSoundPools(rows: readonly Record<string, unknown>[]): SoundPools | null {
  const pools: SoundPools = { spin: [], win: [], jackpot: [], lose: [] };
  for (const row of rows) {
    const pool = row['pool'];
    const file = row['file'];
    if (!isSoundPool(pool) || typeof file !== 'string' || file === '') continue;
    pools[pool].push(file);
  }
  if (POOL_NAMES.some((pool) => pools[pool].length === 0)) return null;
  return pools;
}

/** Пулы из БД; null — не ответила или список неполный (тогда играет фолбэк). */
export async function fetchSoundPools(): Promise<SoundPools | null> {
  const sb = getSupabase();
  if (!sb) return null;
  try {
    const res = await sb.from('gamba_sounds').select('pool,file');
    if (res.error || !Array.isArray(res.data)) return null;
    return parseSoundPools(res.data as unknown as Record<string, unknown>[]);
  } catch {
    return null;
  }
}
