import { createClient } from '@supabase/supabase-js';

export type Rarity = 'common' | 'rare' | 'legendary';

/**
 * Лот каталога (тикет 09, карта video-s3).
 *
 * Каталог живёт в БД (таблица public.lots), статики больше нет:
 * audio/poster/forSale/clipUrl/history удалены, `meme` переименовано
 * в `meme_text` (читается из shared). `id` = slug из БД (маппинг
 * lot.id → эмоут в emotes.ts не трогаем).
 */
export interface Lot {
  id: string;
  title: string;
  owner: string | null;
  price: number;
  rarity: Rarity;
  meme_text?: string | null;
  video_url?: string | null;
}

const rarityRank: Record<Rarity, number> = { legendary: 0, rare: 1, common: 2 };

function buildEnv(): { url: string; key: string } {
  const url = import.meta.env.PUBLIC_SUPABASE_URL as string | undefined;
  const key = import.meta.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY as string | undefined;
  if (!url || !key) {
    throw new Error(
      'SSG каталога требует PUBLIC_SUPABASE_URL и PUBLIC_SUPABASE_PUBLISHABLE_KEY ' +
        '(тикет 09): каталог — из БД, статического фолбэка нет.',
    );
  }
  return { url, key };
}

type LotRow = Record<string, unknown>;

function toLot(row: LotRow): Lot | null {
  const slug = row['slug'];
  const title = row['title'];
  const price = Number(row['price']);
  if (typeof slug !== 'string' || typeof title !== 'string' || !Number.isFinite(price)) {
    return null;
  }
  const rawRarity = row['rarity'];
  const rarity: Rarity =
    rawRarity === 'legendary' || rawRarity === 'rare' || rawRarity === 'common'
      ? rawRarity
      : 'common';
  return {
    id: slug,
    title,
    owner: typeof row['owner_login'] === 'string' ? (row['owner_login'] as string) : null,
    price,
    rarity,
    meme_text: typeof row['meme_text'] === 'string' ? (row['meme_text'] as string) : null,
    video_url: typeof row['video_url'] === 'string' ? (row['video_url'] as string) : null,
  };
}

/**
 * Каталог для SSG на билде — только из БД через PUBLIC_SUPABASE_*.
 * Без env кидает явно (статического фолбэка нет).
 *
 * До миграции 07 (§1 спеки) колонок rarity/meme_text/video_url в БД нет —
 * тогда откатываемся на legacy-набор, а новые поля отдаём null
 * (клиентский shared-слой в supabase.ts делает так же).
 */
export async function fetchCatalogLots(): Promise<Lot[]> {
  const { url, key } = buildEnv();
  const sb = createClient(url, key);
  // Таймаут на случай stall сети: билд должен падать явно, а не висеть.
  // NB: postgrest-js игнорирует `signal` в опциях .select() — рабочий API
  // только .abortSignal() (тикет 11, drive-by: иначе SSG виснет навсегда).
  const signal = AbortSignal.timeout(20000);
  let rows: LotRow[] | null = null;
  const full = await sb
    .from('lots')
    .select('slug,title,rarity,meme_text,video_url,price,owner_login,owner_uid,updated_at')
    .abortSignal(signal);
  if (!full.error && Array.isArray(full.data)) {
    rows = full.data as unknown as LotRow[];
  } else {
    const legacy = await sb.from('lots').select('slug,title,price,owner_login').abortSignal(signal);
    if (legacy.error || !Array.isArray(legacy.data)) {
      throw new Error(
        `SSG каталога: не смог прочитать таблицу lots из БД: ${legacy.error?.message ?? full.error?.message ?? 'unknown'}`,
      );
    }
    rows = legacy.data as unknown as LotRow[];
  }
  const lots = (rows ?? []).flatMap((row) => {
    const lot = toLot(row);
    return lot ? [lot] : [];
  });
  return lots.sort((a, b) => rarityRank[a.rarity] - rarityRank[b.rarity] || b.price - a.price);
}
