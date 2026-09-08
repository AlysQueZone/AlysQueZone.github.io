-- Пивкойны в БД, review-fixes (п.2): потолок цены во вью next_price.
-- Вью считала N без потолка 1e9, а BEFORE-триггер enforce_purchase_rules цену
-- выше потолка отклоняет (`price cap reached`) — у потолка витрина показывала N,
-- которую сервер отклонит. Формула ниже — зеркало серверной с капом:
-- LEAST(greatest(ceil(price*1.1), price+1), 1000000000).
-- Права/публикация — как в исходной миграции 20260908260000 (вью публична,
-- security_invoker, чтение anon/authenticated, realtime-тиком остаётся lots).
-- Применить: мёрж в main применит сам; руками на прод НЕ накатывать.

create or replace view public.lots_with_next_price as
select
  l.slug,
  l.title,
  l.rarity,
  l.meme_text,
  l.video_url,
  l.price,
  l.owner_login,
  l.owner_uid,
  l.updated_at,
  least(greatest(ceil(l.price * 1.1)::bigint, l.price + 1), 1000000000) as next_price
from public.lots as l;

alter view public.lots_with_next_price set (security_invoker = true);

revoke all on public.lots_with_next_price from anon, authenticated;
grant select on public.lots_with_next_price to anon, authenticated;
