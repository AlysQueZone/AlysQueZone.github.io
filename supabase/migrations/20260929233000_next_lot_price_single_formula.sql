-- Одна формула роста цены (архитектурное ревью, кандидат G): BEFORE-триггер
-- покупки и вью lots_with_next_price больше не переписывают правило руками —
-- оба зовут public.next_lot_price(price, purchase_count). Вью пересоздавали
-- целиком пять раз, и каждое изменение трогало объект с той же формулой рядом.
-- Потолок цены — public.lot_price_cap() (одним числом, как ставки
-- commission_rate/royalty_rate): триггер выше него отказывает
-- ('price cap reached'), вью им же ограничивает показ N.
-- Поведение не меняется: порог 15, ceil(+10%), минимум +1, потолок 1e9 — как были.
-- Применить: мёрж в main применит сам; руками на прод НЕ накатывать.

-- 1. Формула роста: до 15 покупок — ceil(+10%), минимум +1; дальше — ровно +1.
create or replace function public.next_lot_price(p_price bigint, p_purchase_count bigint)
returns bigint language sql immutable
as $$
  select case
    when coalesce(p_purchase_count, 0) < 15
      then greatest(ceil(p_price * 1.1)::bigint, p_price + 1)
    else p_price + 1
  end;
$$;
-- Вью — security_invoker: execute проверяется у спрашивающего (anon в том числе).
revoke execute on function public.next_lot_price(bigint, bigint) from public;
grant execute on function public.next_lot_price(bigint, bigint)
  to anon, authenticated, service_role;

-- 2. Потолок цены — одна константа на триггер и вью.
create or replace function public.lot_price_cap()
returns bigint language sql immutable
as $$ select 1000000000::bigint $$;
revoke execute on function public.lot_price_cap() from public;
grant execute on function public.lot_price_cap() to anon, authenticated, service_role;

-- 3. BEFORE-триггер покупки: цена — из функций выше; guard своего лота,
--    identity, пауза, кап покупок и гейт денег — без изменений.
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

  -- Цена: рост — из одной формулы, потолок — из одной константы (см. выше).
  NEW.price_paid := public.next_lot_price(v_price, v_buys);
  if NEW.price_paid > public.lot_price_cap() then
    raise exception 'price cap reached';
  end if;

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

-- 4. Вью — проекция таблицы, формула и потолок — из функций; состав колонок
--    прежний (смена состава — только DROP + CREATE, docs/agents/supabase.md).
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
  l.suggested_by_login,
  least(
    public.next_lot_price(l.price, l.purchase_count),
    public.lot_price_cap()
  ) as next_price
from public.lots as l;

alter view public.lots_with_next_price set (security_invoker = true);

revoke all on public.lots_with_next_price from anon, authenticated;
grant select on public.lots_with_next_price to anon, authenticated;
-- DROP VIEW теряет грант service_role из 20260924120000_explicit_grants.sql:
-- выдаём его здесь явно, иначе новая вью останется без гранта для сервиса.
grant select on public.lots_with_next_price to service_role;
