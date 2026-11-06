import { getSupabase } from './session';
import { buyLotShared } from './purchase-write';
import { live } from './live';
import { mapBuyError, type BuyResult } from './buy-core';

/**
 * Перекуп: выполнение покупки за одним швом.
 *
 * Контракт с БД (см. supabase/migrations/*_shared_lots.sql): клиент
 * делает один INSERT в purchases только с lot_id + buyer_uid. Цену,
 * identity, паузу, кап и гейт денег считает BEFORE-триггер — клиентские
 * значения игнорируются, итог — всегда price_paid сервера.
 *
 * Живые чтения (каталог, лот, баланс, uid) и события — в lib/live.ts
 * (docs/adr/0003): здесь только запись и маппинг её ошибок в BuyResult
 * (фазы и классификация — lib/buy-core.ts).
 */

/**
 * Перекуп одним вызовом: свежая N перед записью (проекция для показа —
 * итог всё равно посчитает сервер), затем INSERT с ожиданием confirm.
 * Покупка объявляется модулю живых данных (`live.reportPurchase`): событие
 * для поверхностей + перечитка каталога и баланса.
 * Доменные исходы не бросает — возвращает BuyResult; бросает только
 * при ненастроенном хранилище (caller guards через getSupabase).
 */
export async function buyLot(slug: string): Promise<BuyResult> {
  const sb = getSupabase();
  if (!sb) throw new Error('supabase not configured');
  try {
    const st = await live.refreshLot(slug);
    const staged = st?.nextPrice ?? null;
    const done = await buyLotShared(slug);
    const paid =
      Number.isFinite(done.price_paid) && done.price_paid > 0 ? done.price_paid : (staged ?? 0);
    void live.reportPurchase({ slug, price: paid });
    return { status: 'ok', paid, buyer: done.buyer_login };
  } catch (err) {
    const info = mapBuyError(err);
    return { status: 'blocked', kind: info.kind, retryAfterSec: info.retryAfterSec, raw: info.raw };
  }
}
