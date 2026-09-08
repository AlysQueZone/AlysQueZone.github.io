-- Пивкойны в БД, тикет 09: Гамба крутится на сервере со ставкой 100.
-- Таблица спинов с ключом идемпотентности + RPC spin_gamba (RNG + дебет
-- ставки + кредит выигрыша + возврат исхода в одной транзакции).
-- Движения — в public.ledger (источники gamba_stake/gamba_win).
-- Таблица выплат — seed-конфиг в БД (ставка 100: 50%→0, 40%→100, 10%→500,
-- RTP 90%). Кулдаунов и дневных капов нет, в RPC только технический
-- антибот rate-limit. Повтор с тем же ключом — без дублей (возврат исхода).
-- Применить: мёрж в main применит сам; руками на прод НЕ накатывать.

-- 0. Конфиг выплат в БД (публичен: шансы/таблица/ставка видны до спина).
create table public.gamba_payouts (
  outcome text primary key check (outcome in ('miss', 'return', 'jackpot')),
  payout bigint not null check (payout >= 0),
  weight int not null check (weight > 0),
  label text not null check (label <> '')
);
insert into public.gamba_payouts (outcome, payout, weight, label) values
  ('miss', 0, 50, 'мимо'),
  ('return', 100, 40, 'возврат 100'),
  ('jackpot', 500, 10, 'джекпот 500');

alter table public.gamba_payouts enable row level security;

revoke all on public.gamba_payouts from anon, authenticated;
grant select on public.gamba_payouts to anon, authenticated;

create policy gamba_payouts_public on public.gamba_payouts
  for select to anon, authenticated
  using (true);

-- 1. Спины: один ряд на спин, ключ идемпотентности в паре с пользователем.
create table public.gamba_spins (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  idempotency_key uuid not null,
  stake bigint not null default 100 check (stake = 100),
  payout bigint not null check (payout in (0, 100, 500)),
  outcome text not null check (outcome in ('miss', 'return', 'jackpot')),
  created_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);
create index gamba_spins_user_time_idx on public.gamba_spins (user_id, created_at desc);

alter table public.gamba_spins enable row level security;

revoke all on public.gamba_spins from anon, authenticated;
grant select on public.gamba_spins to authenticated;

create policy gamba_spins_select_own on public.gamba_spins
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- 2. RPC: исход считает сервер, клиент лишь рисует присланное.
-- Возврат — OUT-параметры с префиксом spin_ (без конфликта имён колонок).
create or replace function public.spin_gamba(p_idempotency_key uuid)
returns table (spin_outcome text, spin_payout bigint, spin_balance bigint)
language plpgsql
security definer set search_path = ''
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
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if p_idempotency_key is null then raise exception 'idempotency key required'; end if;

  -- Идемпотентность: повтор с тем же ключом — тот же исход, движений нет.
  select s.outcome, s.payout into v_outcome, v_payout
    from public.gamba_spins as s
    where s.user_id = v_uid and s.idempotency_key = p_idempotency_key;
  if found then
    select p.balance into v_balance from public.profiles as p where p.user_id = v_uid;
    spin_outcome := v_outcome; spin_payout := v_payout; spin_balance := v_balance;
    return next;
    return;
  end if;

  -- Технический антибот rate-limit (игровых лимитов нет):
  -- не чаще 1 спина в 2 секунды, не больше 20 в минуту.
  if exists (select 1 from public.gamba_spins
             where user_id = v_uid and created_at > now() - interval '2 seconds') then
    raise exception 'rate limit: slow down, пойжем помедленнее';
  end if;
  if (select count(*) from public.gamba_spins
      where user_id = v_uid and created_at > now() - interval '1 minute') >= 20 then
    raise exception 'rate limit: max 20 per minute';
  end if;

  -- Гейт денег: строка счёта лочится до конца транзакции от двойной траты.
  select p.balance into v_balance from public.profiles as p
    where p.user_id = v_uid for update;
  if not found then raise exception 'insufficient funds: no account'; end if;
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

  -- Кредит выигрыша + леджер (мимо — только ставка).
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
