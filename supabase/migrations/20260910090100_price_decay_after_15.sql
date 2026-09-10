-- Ребаланс пивкойнов, тикет 02: затухание роста цены после 15 перекупов.
-- Первые 15 покупок лота поднимают цену как раньше (ceil +10%, минимум +1),
-- начиная с 16-й — ровно на +1 (порог — персистентный lots.purchase_count
-- из тикета 01; count(*) истории ненадёжен — хвост режется до 50).
-- Вью lots_with_next_price считает ту же формулу (одна формула в двух местах:
-- BEFORE-триггер покупки и вью цен) — витрина показывает точную сумму кнопки.
-- Потолок 1e9, guard своего лота, пауза, кап, гейт денег — без изменений.
-- Применить: мёрж в main применит сам; руками на прод НЕ накатывать.

create or replace function public.enforce_purchase_rules()
returns trigger language plpgsql
security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_jwt jsonb := auth.jwt();
  v_twitch_id text;
  v_login text;
  v_price bigint;
  v_owner_uid uuid;
  v_buys bigint;
  v_buyer_balance bigint;
  c_cooldown interval := interval '30 seconds';
  c_max_per_window int := 10;
  c_window interval := interval '10 minutes';
  c_max_price bigint := 1000000000;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  select l.price, l.owner_uid, l.purchase_count
    into v_price, v_owner_uid, v_buys
    from public.lots as l where l.id = NEW.lot_id for update;
  if not found then raise exception 'lot % not found', NEW.lot_id; end if;

  -- Свой лот перекупать нечего (клиент гасит кнопку, это — страховка в БД).
  if v_owner_uid is not null and v_owner_uid = v_uid then
    raise exception 'already yours';
  end if;

  v_twitch_id := coalesce(
    v_jwt -> 'user_metadata' ->> 'provider_id',
    v_jwt -> 'user_metadata' ->> 'sub');
  v_login := coalesce(
    v_jwt -> 'user_metadata' ->> 'user_name',
    v_jwt -> 'user_metadata' ->> 'preferred_username',
    v_jwt -> 'user_metadata' ->> 'name',
    v_jwt ->> 'email');
  if v_twitch_id is null then raise exception 'no twitch identity in jwt'; end if;
  NEW.buyer_uid := v_uid;
  NEW.buyer_twitch_id := v_twitch_id;
  NEW.buyer_login := coalesce(v_login, v_uid::text);

  -- Затухание: первые 15 покупок — азарт разгона (+10%), дальше — пологий +1.
  if coalesce(v_buys, 0) < 15 then
    NEW.price_paid := ceil(v_price * 1.1)::bigint;
    if NEW.price_paid <= v_price then NEW.price_paid := v_price + 1; end if;
  else
    NEW.price_paid := v_price + 1;
  end if;
  if NEW.price_paid > c_max_price then raise exception 'price cap reached'; end if;

  -- Пауза per-(user,lot): только моя последняя покупка ЭТОГО лота.
  if exists (select 1 from public.purchases
             where buyer_uid = v_uid and lot_id = NEW.lot_id
               and created_at > now() - c_cooldown) then
    raise exception 'cooldown: wait %', c_cooldown;
  end if;
  if (select count(*) from public.purchases
      where buyer_uid = v_uid and created_at > now() - c_window) >= c_max_per_window then
    raise exception 'rate limit: max % per %', c_max_per_window, c_window;
  end if;

  -- Деньги (тикет 08): хватает ли серверной цены. Строка покупателя лочится
  -- до конца транзакции — вторая покупка в гонке ждёт и видит новый баланс.
  select p.balance into v_buyer_balance from public.profiles as p
    where p.user_id = v_uid for update;
  if not found then raise exception 'insufficient funds: no account'; end if;
  if v_buyer_balance < NEW.price_paid then
    raise exception 'insufficient funds: need %, have %', NEW.price_paid, v_buyer_balance;
  end if;

  return NEW;
end;
$$;
revoke execute on function public.enforce_purchase_rules() from public, anon, authenticated;

-- Вью — зеркало серверной формулы с капом (см. 20260908270000): до 15 покупок
-- +10%, дальше +1. purchase_count в селекте — для прозрачности порога.
-- ВАЖНО: только через DROP+CREATE: CREATE OR REPLACE не умеет вставлять
-- колонку в середину (падает 42P16 «cannot change name of view column» —
-- словили на проде 2026-09-10, очередь миграций встала).
drop view if exists public.lots_with_next_price;
create view public.lots_with_next_price as
select
  l.slug,
  l.title,
  l.video_url,
  l.price,
  l.owner_login,
  l.owner_uid,
  l.purchase_count,
  l.updated_at,
  least(
    case
      when coalesce(l.purchase_count, 0) < 15
        then greatest(ceil(l.price * 1.1)::bigint, l.price + 1)
      else l.price + 1
    end,
    1000000000
  ) as next_price
from public.lots as l;

alter view public.lots_with_next_price set (security_invoker = true);

revoke all on public.lots_with_next_price from anon, authenticated;
grant select on public.lots_with_next_price to anon, authenticated;
