-- Артефакт research-тикети «Защита записи залогиненных без своего сервера»
-- (scratch/shared-state/issues/05-anon-write-protection.md).
-- Идея: клиент делает только INSERT purchases; цену/владельца/кулдаун/ЛУК/хвост считает БД.
-- Вставлять в Supabase Dashboard > SQL. После применения прогнать Database > Advisors.
-- ВНИМАНИЕ: ключи JWT-claims (provider_id/user_name/sub) сверить рантаймом через getUser()-лог
-- и зафиксировать контракт; ниже — кандидатные пути из доков, не проверенные на живом проекте.

-- 0. Таблицы
create table public.lots (
  id bigint generated always as identity primary key,
  slug text not null unique,
  title text not null,
  price bigint not null check (price > 0),
  owner_uid uuid null,
  owner_twitch_id text null,
  owner_login text null,
  is_locked boolean not null default false,  -- ЛУК = true
  updated_at timestamptz not null default now()
);
create index lots_slug_idx on public.lots (slug);

create table public.purchases (
  id bigint generated always as identity primary key,
  lot_id bigint not null references public.lots (id) on delete cascade,
  buyer_uid uuid not null,
  buyer_twitch_id text not null,
  buyer_login text not null,
  price_paid bigint not null check (price_paid > 0),
  created_at timestamptz not null default now()
);
create index purchases_lot_time_idx on public.purchases (lot_id, created_at desc);
create index purchases_buyer_time_idx on public.purchases (buyer_uid, created_at desc);

-- 1. RLS + GRANT
alter table public.lots enable row level security;
alter table public.purchases enable row level security;

revoke all on public.lots from anon, authenticated;
revoke all on public.purchases from anon, authenticated;
grant select on public.lots to anon, authenticated;
grant select on public.purchases to anon, authenticated;
grant insert on public.purchases to authenticated;

create policy lots_select_public on public.lots
  for select to anon, authenticated using (true);

create policy purchases_select_public on public.purchases
  for select to anon, authenticated using (true);

create policy purchases_insert_own on public.purchases
  for insert to authenticated
  with check ((select auth.uid()) = buyer_uid);

-- 2. BEFORE INSERT: валидация + server-side цена +10% + кулдаун + кап окна + блок ЛУКа
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
  v_locked boolean;
  c_cooldown interval := interval '90 seconds';
  c_max_per_window int := 10;
  c_window interval := interval '10 minutes';
  c_max_price bigint := 1000000000;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  select l.price, l.is_locked into v_price, v_locked
    from public.lots as l where l.id = NEW.lot_id for update;
  if not found then raise exception 'lot % not found', NEW.lot_id; end if;
  if v_locked then raise exception 'lot % is not for sale (LUK)', NEW.lot_id; end if;

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

  NEW.price_paid := ceil(v_price * 1.1)::bigint;
  if NEW.price_paid <= v_price then NEW.price_paid := v_price + 1; end if;
  if NEW.price_paid > c_max_price then raise exception 'price cap reached'; end if;

  if exists (select 1 from public.purchases
             where buyer_uid = v_uid and created_at > now() - c_cooldown) then
    raise exception 'cooldown: wait %', c_cooldown;
  end if;
  if (select count(*) from public.purchases
      where buyer_uid = v_uid and created_at > now() - c_window) >= c_max_per_window then
    raise exception 'rate limit: max % per %', c_max_per_window, c_window;
  end if;

  return NEW;
end;
$$;
revoke execute on function public.enforce_purchase_rules() from public, anon, authenticated;

create trigger trg_purchases_before_insert
  before insert on public.purchases
  for each row execute function public.enforce_purchase_rules();

-- 3. AFTER INSERT: применить владельца/цену + обрезать хвост до 50
create or replace function public.apply_purchase()
returns trigger language plpgsql
security definer set search_path = ''
as $$
begin
  update public.lots set
    price = NEW.price_paid,
    owner_uid = NEW.buyer_uid,
    owner_twitch_id = NEW.buyer_twitch_id,
    owner_login = NEW.buyer_login,
    updated_at = now()
  where id = NEW.lot_id;

  delete from public.purchases as p
  where p.lot_id = NEW.lot_id
    and p.id not in (select id from public.purchases
                     where lot_id = NEW.lot_id
                     order by created_at desc, id desc limit 50);
  return NEW;
end;
$$;
revoke execute on function public.apply_purchase() from public, anon, authenticated;

create trigger trg_purchases_after_insert
  after insert on public.purchases
  for each row execute function public.apply_purchase();

-- 4. Откат вандальной покупки (только человек в дашборде, service_role; в браузер никогда)
-- select id, lot_id, buyer_login, price_paid, created_at
--   from public.purchases where lot_id = :lot order by created_at desc limit 5;
-- delete from public.purchases where id = :vandal_id;
-- update public.lots as l set
--   price = coalesce((select price_paid from public.purchases
--                     where lot_id = l.id order by created_at desc, id desc limit 1),
--                    :seed_price),
--   owner_uid = (select buyer_uid from public.purchases
--                where lot_id = l.id order by created_at desc, id desc limit 1),
--   owner_twitch_id = (select buyer_twitch_id from public.purchases
--                where lot_id = l.id order by created_at desc, id desc limit 1),
--   owner_login = (select buyer_login from public.purchases
--                where lot_id = l.id order by created_at desc, id desc limit 1),
--   updated_at = now()
-- where l.id = :lot;
-- Опционально заморозить: update public.lots set is_locked = true where id = :lot;
