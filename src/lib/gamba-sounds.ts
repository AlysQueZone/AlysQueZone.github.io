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
import { getSupabase } from './supabase';

/** Стадии церемонии; каждой соответствует свой пул (check в public.gamba_sounds). */
export const SOUND_POOLS = ['spin', 'win', 'jackpot', 'lose'] as const;

export type SoundPool = (typeof SOUND_POOLS)[number];

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

function isSoundPool(value: unknown): value is SoundPool {
  return typeof value === 'string' && (SOUND_POOLS as readonly string[]).includes(value);
}

/**
 * Пулы из БД. null — не ответила или список неполный: играет фолбэк сборки.
 * Неполный список — брак синка, а не повод крутить молча.
 */
export async function fetchSoundPools(): Promise<SoundPools | null> {
  const sb = getSupabase();
  if (!sb) return null;
  try {
    const res = await sb.from('gamba_sounds').select('pool,file');
    if (res.error || !Array.isArray(res.data)) return null;
    const pools: SoundPools = { spin: [], win: [], jackpot: [], lose: [] };
    for (const row of res.data as unknown as Record<string, unknown>[]) {
      const pool = row['pool'];
      const file = row['file'];
      if (!isSoundPool(pool) || typeof file !== 'string' || file === '') continue;
      pools[pool].push(file);
    }
    if (SOUND_POOLS.some((pool) => pools[pool].length === 0)) return null;
    return pools;
  } catch {
    return null;
  }
}
