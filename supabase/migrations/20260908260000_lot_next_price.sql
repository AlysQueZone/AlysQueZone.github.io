-- Пивкойны в БД, тикет 11: живая цена перекупа из БД.
-- Вью «лот + следующая цена»: N считает база тем же выражением, что и
-- BEFORE-триггер enforce_purchase_rules (ceil(price*1.1), минимум price+1),
-- клиент формулы не знает — только читает N из подписки (src/lib/prices.ts),
-- итог покупки всегда — price_paid сервера.
-- Права вызывающего (security_invoker): RLS таблицы lots применяется как есть,
-- витрина и цены публичны (гость видит цены без сессии — спека, US-15).
-- Чтение вью — anon/authenticated, записей клиенту нет (вью read-only).
-- Realtime: вью в публикацию не входит (реплицируются только таблицы) —
-- живой тик даёт таблица lots (в supabase_realtime с 20260906211834);
-- клиент перечитывает вью по каждому событию lots. Ниже — идемпотентная
-- страховка, если lots из публикации выпал.
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
  greatest(ceil(l.price * 1.1)::bigint, l.price + 1) as next_price
from public.lots as l;

alter view public.lots_with_next_price set (security_invoker = true);

revoke all on public.lots_with_next_price from anon, authenticated;
grant select on public.lots_with_next_price to anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'lots'
  ) then
    alter publication supabase_realtime add table public.lots;
  end if;
end
$$;
