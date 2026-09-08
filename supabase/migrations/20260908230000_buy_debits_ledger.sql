-- Пивкойны в БД, тикет 08: покупка списывает Пивкойны со счёта в БД.
-- Расширяет существующие BEFORE/AFTER-триггеры покупок (не переписывает):
-- BEFORE проверяет баланс (SELECT ... FOR UPDATE, `insufficient funds`),
-- AFTER пишет дебет покупателю + кредит продавцу + строки леджера.
-- Пауза 30с per-(user,lot), кап 10 покупок/10мин, цена ceil+10%, кап цены,
-- guard своего лота, блокировки FOR UPDATE — без изменений.
-- Леджер — минимальная append-only таблица движений в этой же миграции:
-- источник истины и аудит, баланс profiles — серверный кэш, пишется только
-- сервером в той же транзакции. Записей денег клиенту нет вовсе.
-- Применить: мёрж в main применит сам; руками на прод НЕ накатывать.

-- 0. Леджер: append-only движения. amount > 0 — кредит, < 0 — дебет.
-- source — телеметрия источника с первого дня (signup/покупки; гамба/вход — позже).
-- purchase_id — связь с покупкой; старые покупки AFTER-триггер режет до 50,
-- поэтому ON DELETE SET NULL: леджер переживает чистку хвоста, инвариант
-- «баланс = сумма движений» не ломается.
create table public.ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  amount bigint not null check (amount <> 0),
  source text not null check (source <> ''),
  purchase_id bigint null references public.purchases (id) on delete set null,
  created_at timestamptz not null default now()
);
create index ledger_user_time_idx on public.ledger (user_id, created_at desc);
create index ledger_purchase_idx on public.ledger (purchase_id);

-- 1. RLS: свой леджер виден только себе; гостю деньги не отдаются.
-- Записей клиенту нет вовсе: ни insert/update/delete-политик —
-- движения пишет только сервер (триггеры ниже).
alter table public.ledger enable row level security;

revoke all on public.ledger from anon, authenticated;
grant select on public.ledger to authenticated;

create policy ledger_select_own on public.ledger
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- 2. Бэкфилл открытия: у счетов из тикета 07 движений ещё нет —
-- стартовый баланс кладу в леджер, чтобы инвариант сошёлся с первого дня.
-- Идемпотентно: только тем, у кого движений нет вообще.
insert into public.ledger (user_id, amount, source)
select p.user_id, p.balance, 'seed_opening'
from public.profiles as p
where p.balance <> 0
  and not exists (select 1 from public.ledger as l where l.user_id = p.user_id);

-- 3. Стартовые 1000 новичка — тоже в леджер (рядом со счётом, та же транзакция).
-- Повторный вызов безопасен (on conflict do nothing; леджер — только новому счёту).
create or replace function public.handle_new_profile()
returns trigger language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (user_id, balance)
  values (NEW.id, 1000)
  on conflict (user_id) do nothing;
  if found then
    insert into public.ledger (user_id, amount, source)
    values (NEW.id, 1000, 'seed_opening');
  end if;
  return NEW;
end;
$$;
revoke execute on function public.handle_new_profile() from public, anon, authenticated;

-- 4. BEFORE: всё как в .../20260908180000_self_purchase_guard.sql
-- (auth, лот FOR UPDATE, guard своего лота, identity из JWT, цена ceil+10%,
-- кап цены, пауза per-(user,lot) 30с, кап 10/10мин) плюс гейт денег:
-- строка покупателя лочится FOR UPDATE до конца транзакции от двойной траты,
-- без счёта или с балансом ниже цены сервера — `insufficient funds`.
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
  v_buyer_balance bigint;
  c_cooldown interval := interval '30 seconds';
  c_max_per_window int := 10;
  c_window interval := interval '10 minutes';
  c_max_price bigint := 1000000000;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  select l.price, l.owner_uid into v_price, v_owner_uid
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

  NEW.price_paid := ceil(v_price * 1.1)::bigint;
  if NEW.price_paid <= v_price then NEW.price_paid := v_price + 1; end if;
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

-- 5. AFTER: деньги покупки + всё как раньше (владелец/цена, хвост до 50).
-- Дебет покупателя и кредит продавцу (перекуп; первой покупке кредитовать
-- некого — owner NULL) пишутся в той же транзакции, что и запись покупки.
-- Продавец без счёта (владелец раньше счетов): счёт + открытие, затем кредит —
-- инвариант «баланс = сумма движений» держится и там.
create or replace function public.apply_purchase()
returns trigger language plpgsql
security definer set search_path = ''
as $$
declare
  v_seller uuid;
begin
  -- Продавец — владелец до обновления (строка лота залочена BEFORE до коммита).
  select l.owner_uid into v_seller from public.lots as l where l.id = NEW.lot_id;

  -- Дебет покупателя (наличие и хватание проверены BEFORE под локом).
  update public.profiles set
    balance = balance - NEW.price_paid,
    updated_at = now()
  where user_id = NEW.buyer_uid;
  if not found then raise exception 'insufficient funds: no account'; end if;

  insert into public.ledger (user_id, amount, source, purchase_id)
  values (NEW.buyer_uid, -NEW.price_paid, 'purchase_debit', NEW.id);

  -- Кредит продавцу при перекупе (свой лот отсечён BEFORE — seller <> buyer).
  if v_seller is not null and v_seller <> NEW.buyer_uid then
    insert into public.profiles (user_id, balance)
    values (v_seller, 1000)
    on conflict (user_id) do nothing;
    if found then
      insert into public.ledger (user_id, amount, source)
      values (v_seller, 1000, 'seed_opening');
    end if;
    update public.profiles set
      balance = balance + NEW.price_paid,
      updated_at = now()
    where user_id = v_seller;
    insert into public.ledger (user_id, amount, source, purchase_id)
    values (v_seller, NEW.price_paid, 'purchase_credit', NEW.id);
  end if;

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
