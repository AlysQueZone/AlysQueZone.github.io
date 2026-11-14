-- Старт 3 500: новый счёт получает 3 500, а существующие счета разово
-- догоняются по капиталу (баланс + лоты по текущей цене) до 3 500.
-- Лоты — тоже деньги: потративший всё на приветы не считается бедным.
-- Догон — одна миграция, не правило; повторно не платится (guard по
-- ledger.source = 'capital_topup'). Применить: мёрж в main применит сам;
-- руками на прод НЕ накатывать.
--
-- Старт — одна функция public.start_balance(); счёт открывает
-- public.ensure_profile() (профиль + seed_opening). start_balance() зовут
-- ensure_profile(), дефолт profiles.balance и текст ошибки spin_gamba.
-- Число живёт только в start_balance().

-- 1. Старт — одной функцией: число живёт здесь, а не в четырёх объектах.
create or replace function public.start_balance()
returns bigint
language sql
immutable
as $$ select 3500::bigint $$;
revoke execute on function public.start_balance() from public;
grant execute on function public.start_balance() to service_role;
-- execute только service_role: функция внутренняя, клиент её не зовёт;
-- ensure_profile и дефолт идут от владельца, service_role — прямой INSERT.

-- 2. Открытие счёта — одна функция: профиль + seed_opening.
create or replace function public.ensure_profile(p_uid uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id, balance)
  values (p_uid, public.start_balance())
  on conflict (user_id) do nothing;
  if found then
    insert into public.ledger (user_id, amount, source)
    values (p_uid, public.start_balance(), 'seed_opening');
  end if;
end;
$$;
revoke execute on function public.ensure_profile(uuid) from public, anon, authenticated;

-- 3. Дефолт таблицы — тот же старт, что и триггер (страховка для прямых INSERT).
alter table public.profiles alter column balance set default public.start_balance();

-- 4. Триггер нового счёта: открытие счёта — в ensure_profile.
create or replace function public.handle_new_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.ensure_profile(NEW.id);
  return NEW;
end;
$$;
revoke execute on function public.handle_new_profile() from public, anon, authenticated;

-- 5. Fallback продавца без счёта — тот же ensure_profile (редкий кейс: счёт
-- удалён, а лот остался; без профиля выручку некуда зачислить).
create or replace function public.apply_purchase()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seller uuid;
  v_author uuid;
  v_buys bigint;
  v_fee bigint;
  v_royalty bigint := 0;
begin
  -- Продавец и автор привета — до обновления (строка лота залочена BEFORE).
  select l.owner_uid, l.suggested_by_uid, l.purchase_count
    into v_seller, v_author, v_buys
    from public.lots as l where l.id = NEW.lot_id;

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
    perform public.ensure_profile(v_seller);
    update public.profiles set
      balance = balance + NEW.price_paid,
      updated_at = now()
    where user_id = v_seller;
    insert into public.ledger (user_id, amount, source, purchase_id)
    values (v_seller, NEW.price_paid, 'purchase_credit', NEW.id);

    -- Комиссия биржи по единой ставке (см. commission_rate).
    v_fee := greatest(ceil(NEW.price_paid * public.commission_rate())::bigint, 1);
    update public.profiles set
      balance = balance - v_fee,
      updated_at = now()
    where user_id = v_seller;
    insert into public.ledger (user_id, amount, source, purchase_id)
    values (v_seller, -v_fee, 'commission_burn', NEW.id);

    -- Роялти автору привета: первые три перекупа и есть счёт.
    if v_author is not null
       and v_buys is not null and v_buys between 1 and 3
       and exists (
         select 1 from public.profiles as p where p.user_id = v_author
       ) then
      v_royalty := least(
        greatest(ceil(NEW.price_paid * public.royalty_rate())::bigint, 1),
        v_fee);
      update public.profiles set
        balance = balance + v_royalty,
        updated_at = now()
      where user_id = v_author;
      insert into public.ledger (user_id, amount, source, purchase_id)
      values (v_author, v_royalty, 'royalty_credit', NEW.id);
    end if;
  end if;

  update public.lots set
    price = NEW.price_paid,
    owner_uid = NEW.buyer_uid,
    owner_twitch_id = NEW.buyer_twitch_id,
    owner_login = NEW.buyer_login,
    purchase_count = purchase_count + 1,
    updated_at = now()
  where id = NEW.lot_id;

  return NEW;
end;
$$;
revoke execute on function public.apply_purchase() from public, anon, authenticated;

-- 6. Текст ошибки гамбы: старт берётся из public.start_balance() (два места —
-- повтор с тем же ключом и отсутствие счёта). Формулы, лимиты и исходы не меняются.
create or replace function public.spin_gamba(p_idempotency_key uuid)
returns table (spin_outcome text, spin_payout bigint, spin_balance bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_balance bigint;
  v_outcome text;
  v_payout bigint;
  v_total int;
  v_roll double precision;
  r record;
  c_stake bigint := 100;
  c_daily_limit int := 20;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if p_idempotency_key is null then raise exception 'idempotency key required'; end if;

  -- Идемпотентность: повтор с тем же ключом — тот же исход, движений нет.
  select s.outcome, s.payout into v_outcome, v_payout
    from public.gamba_spins as s
    where s.user_id = v_uid and s.idempotency_key = p_idempotency_key;
  if found then
    select p.balance into v_balance from public.profiles as p where p.user_id = v_uid;
    if v_balance is null then raise exception 'insufficient funds: no account (счёта нет — напиши в чат, выдадим стартовые %)', public.start_balance(); end if;
    spin_outcome := v_outcome; spin_payout := v_payout; spin_balance := v_balance;
    return next;
    return;
  end if;

  -- Антибот rate-limit — ПЕРЕД игровым кэпом: в окне антибота отказ приходит
  -- как rate-limit, а не как «кэп дня». Отказы — HTTP 429 (PT429), не 400/P0001.
  -- (Сам флуд после кэпа эти проверки не гасят: они видят только успешные
  -- спины; от флуда защищает клиентский лок в GambaModal.astro.)
  if exists (select 1 from public.gamba_spins
             where user_id = v_uid and created_at > now() - interval '2 seconds') then
    raise sqlstate 'PT429' using message = 'rate limit: slow down, пойжем помедленнее';
  end if;
  if (select count(*) from public.gamba_spins
      where user_id = v_uid and created_at > now() - interval '1 minute') >= 20 then
    raise sqlstate 'PT429' using message = 'rate limit: max 20 per minute';
  end if;

  -- Игровой прибор: не больше 20 спинов в UTC-сутки. Повторные
  -- попытки тем же ключом выше уже вернулись и лимит не тратят.
  if (select count(*) from public.gamba_spins
      where user_id = v_uid and created_at >= date_trunc('day', now())) >= c_daily_limit then
    raise sqlstate 'PT429' using message = 'daily limit: счастливых спинов на сегодня больше нет (20 в день) — возвращайся завтра';
  end if;

  -- Гейт денег: строка счёта лочится до конца транзакции от двойной траты.
  select p.balance into v_balance from public.profiles as p
    where p.user_id = v_uid for update;
  if not found then raise exception 'insufficient funds: no account (счёта нет — напиши в чат, выдадим стартовые %)', public.start_balance(); end if;
  if v_balance < c_stake then
    raise exception 'insufficient funds: need %, have %', c_stake, v_balance;
  end if;

  -- Взвешенный исход по конфигу из public.gamba_payouts (порядок — по выплате).
  select sum(g.weight)::int into v_total from public.gamba_payouts as g;
  if v_total is null or v_total <= 0 then raise exception 'gamba payouts not configured'; end if;
  v_roll := random() * v_total;
  v_outcome := null;
  for r in select g.outcome, g.payout, g.weight
           from public.gamba_payouts as g order by g.payout asc loop
    if v_roll < r.weight then
      v_outcome := r.outcome;
      v_payout := r.payout;
      exit;
    end if;
    v_roll := v_roll - r.weight;
  end loop;
  if v_outcome is null then
    select g.outcome, g.payout into v_outcome, v_payout
      from public.gamba_payouts as g order by g.payout desc limit 1;
  end if;

  -- Дебет ставки + леджер.
  update public.profiles set
    balance = balance - c_stake,
    updated_at = now()
  where user_id = v_uid;
  insert into public.ledger (user_id, amount, source)
  values (v_uid, -c_stake, 'gamba_stake');

  -- Кредит выигрыша + леджер (в таблице I минимум — возврат, мимо нет).
  if v_payout > 0 then
    update public.profiles set
      balance = balance + v_payout,
      updated_at = now()
    where user_id = v_uid;
    insert into public.ledger (user_id, amount, source)
    values (v_uid, v_payout, 'gamba_win');
  end if;

  -- Спин пишется последним; гонка с тем же ключом — вернуть первый исход.
  begin
    insert into public.gamba_spins (user_id, idempotency_key, stake, payout, outcome)
    values (v_uid, p_idempotency_key, c_stake, v_payout, v_outcome);
  exception when unique_violation then
    select s.outcome, s.payout into v_outcome, v_payout
      from public.gamba_spins as s
      where s.user_id = v_uid and s.idempotency_key = p_idempotency_key;
  end;

  select p.balance into v_balance from public.profiles as p where p.user_id = v_uid;
  spin_outcome := v_outcome; spin_payout := v_payout; spin_balance := v_balance;
  return next;
  return;
end;
$$;
revoke all on function public.spin_gamba(uuid) from public, anon, authenticated;
grant execute on function public.spin_gamba(uuid) to authenticated;

-- 7. Разовый догон по капиталу. Лот оценивается по последней сделке
-- (lots.price): он ликвиден — его можно купить в любой момент. Guard
-- делает повторный запуск безопасным: уже получившие capital_topup
-- второй раз не получают.
with capital as (
  select p.user_id,
         p.balance,
         coalesce(sum(l.price), 0) as lots_value
  from public.profiles as p
  left join public.lots as l on l.owner_uid = p.user_id
  group by p.user_id, p.balance
),
need as (
  select c.user_id, (public.start_balance() - (c.balance + c.lots_value))::bigint as delta
  from capital as c
  where c.balance + c.lots_value < public.start_balance()
    and not exists (
      select 1 from public.ledger as l
      where l.user_id = c.user_id and l.source = 'capital_topup'
    )
),
upd as (
  update public.profiles as p
  set balance = p.balance + n.delta,
      updated_at = now()
  from need as n
  where p.user_id = n.user_id
  returning p.user_id, n.delta
)
insert into public.ledger (user_id, amount, source)
select user_id, delta, 'capital_topup' from upd;
