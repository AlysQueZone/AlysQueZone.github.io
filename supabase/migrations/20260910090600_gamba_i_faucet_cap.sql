-- Ребаланс пивкойнов, тикет 08: Гамба I — всегда в плюсе, кран под прибором.
-- Диагноз: H честна (EV 97.5), но выигрыши не накапливаются — bleed −2.5/спин
-- съедает даже джекпот за минуты; мелочь +50 не регистрируется как победа.
-- Гриллинг 2026-09-10 (Q8–Q15, вариант K-A): пол выплаты 100 (мимо нет),
-- x10 жив, EV 128, дневной лимит 10 спинов/сутки.
-- Таблица I: возврат 75% → 100 (при своих, net 0), мелочь 17% → 150 (+50),
-- крупно 7% → 250 (+150), джекпот 1% → 1000 (x10 жив, но редок: при кэпе 5
-- занос в среднем раз в ~20 активных дней — лотерейный билет, зафиксировано).
-- EV = (75*100 + 17*150 + 7*250 + 1*1000)/100 = 12800/100 = 128.
-- Доля «в плюсе» 25%. Печать worst-case: 28*5*30*14 ≈ 59k ≈ стокам
-- (комиссия ~36k + первые покупки ~18k); сходимость — по месячным метрикам.
-- RPC spin_gamba НЕ переписывается с нуля — только добавлен игровой лимит
-- (раньше был лишь технический антибот: 1/2с, 20/мин, «игровых лимитов нет»).
-- Сутки — UTC-день (date_trunc); подпись в UI — «в день», без таймзоны.
-- Номиналы 100/150/250/1000 и исходы return/small/big/jackpot уже валидны
-- в CHECK (история, включая miss, валидна) — ALTER не нужен.
-- Применить: мёрж в main применит сам; руками на прод НЕ накатывать.

-- 1. Индекс под кэп (и под будущий счётчик остатка).
create index if not exists gamba_spins_user_day_idx
  on public.gamba_spins (user_id, created_at);

-- 2. Seed таблицы I (старые строки не UPDATE — только DELETE+INSERT).
delete from public.gamba_payouts
where outcome in ('miss', 'small', 'big', 'jackpot', 'return');

insert into public.gamba_payouts (outcome, payout, weight, label) values
  ('return', 100, 75, 'возврат 100'),
  ('small', 150, 17, '+50'),
  ('big', 250, 7, '+150'),
  ('jackpot', 1000, 1, 'джекпот x10');

-- 3. Дневной лимит 10 спинов/сутки (игровой прибор; остальное — как было).
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
  c_daily_limit int := 10;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if p_idempotency_key is null then raise exception 'idempotency key required'; end if;

  -- Идемпотентность: повтор с тем же ключом — тот же исход, движений нет.
  select s.outcome, s.payout into v_outcome, v_payout
    from public.gamba_spins as s
    where s.user_id = v_uid and s.idempotency_key = p_idempotency_key;
  if found then
    select p.balance into v_balance from public.profiles as p where p.user_id = v_uid;
    if v_balance is null then raise exception 'insufficient funds: no account (счёта нет — напиши в чат, выдадим стартовые 1000)'; end if;
    spin_outcome := v_outcome; spin_payout := v_payout; spin_balance := v_balance;
    return next;
    return;
  end if;

  -- Игровой прибор (тикет 08): не больше 10 спинов в UTC-сутки. Повторные
  -- попытки тем же ключом выше уже вернулись и лимит не тратят.
  if (select count(*) from public.gamba_spins
      where user_id = v_uid and created_at >= date_trunc('day', now())) >= c_daily_limit then
    raise exception 'daily limit: счастливых спинов на сегодня больше нет (10 в день) — возвращайся завтра';
  end if;

  -- Технический антибот rate-limit (игровую нагрузку теперь держит кэп выше):
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
  if not found then raise exception 'insufficient funds: no account (счёта нет — напиши в чат, выдадим стартовые 1000)'; end if;
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
