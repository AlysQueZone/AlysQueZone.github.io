/**
 * Запись покупки: сырой INSERT в `purchases`.
 *
 * Контракт с БД (см. supabase/migrations/*_shared_lots.sql): клиент шлёт только
 * lot_id + buyer_uid. Цену (ceil +10%), identity (twitch_id/login из JWT),
 * паузу 30с per-(user,lot), кап 10 покупок/10мин и гейт денег
 * (`insufficient funds`) считает BEFORE-триггер — клиентские значения
 * цены/identity игнорируются. Успех — только после confirm сервера (ответ без
 * error).
 *
 * Не знает о чтениях и их типах: исход покупки для человека собирает
 * `buyLot` из `lots.ts`, клиент и ретрай — `session`. Живые данные —
 * `live.ts` (docs/adr/0003).
 */
import { getSupabase } from './session';

/** Лоты в БД живут по slug: он же ключ страницы лота (`/lot/?id=<slug>`). */
export interface SharedPurchase {
  price_paid: number;
  buyer_login: string;
}

/**
 * Сырой примитив shared-покупки: resolve slug → bigint id, затем INSERT
 * { lot_id, buyer_uid } и ожидание confirm. Бросает исходную ошибку —
 * доменный итог собирает buyLot из lib/lots.ts (свежая N + маппинг ошибок).
 */
export async function buyLotShared(slug: string): Promise<SharedPurchase> {
  const sb = getSupabase();
  if (!sb) throw new Error('supabase not configured');
  const { data: sessionData } = await sb.auth.getSession();
  const uid = sessionData.session?.user.id;
  if (!uid) throw new Error('not authenticated');
  const { data: lot, error: lotError } = await sb
    .from('lots')
    .select('id')
    .eq('slug', slug)
    .single();
  if (lotError || !lot) throw new Error(`lot ${slug} not found`);
  const lotId = (lot as unknown as { id: number }).id;
  const { data, error } = await sb
    .from('purchases')
    .insert({ lot_id: lotId, buyer_uid: uid })
    .select('price_paid,buyer_login')
    .single();
  if (error) throw error;
  const row = data as unknown as { price_paid: number; buyer_login: string };
  return { price_paid: Number(row.price_paid), buyer_login: String(row.buyer_login) };
}
