import { createClient } from '@supabase/supabase-js';

/**
 * Лот каталога: выставленный на бирже привет с видео.
 *
 * Каталог живёт в БД (таблица public.lots), статики больше нет.
 * `id` = slug из БД.
 */
export interface Lot {
  id: string;
  title: string;
  owner: string | null;
  price: number;
  video_url?: string | null;
}

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
  return {
    id: slug,
    title,
    owner: typeof row['owner_login'] === 'string' ? (row['owner_login'] as string) : null,
    price,
    video_url: typeof row['video_url'] === 'string' ? (row['video_url'] as string) : null,
  };
}

/**
 * Каталог для SSG на билде — только из БД через PUBLIC_SUPABASE_*.
 * Без env кидает явно (статического фолбэка нет).
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
    .select('slug,title,video_url,price,owner_login,owner_uid,updated_at')
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
  return lots.sort((a, b) => b.price - a.price);
}
