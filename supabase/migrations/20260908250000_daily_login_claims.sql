-- Пивкойны в БД, тикет 10: Ежедневный вход по календарю 100/100/150/150/200/250/500.
-- Таблица клеймов daily_claims (user_id, claim_day) с уникальностью (пользователь,
-- день) + RPC claim_daily (награда дня по streak + дебет в леджер + возврат
-- исхода в одной транзакции). Движение — в public.ledger (источник daily_login).
--
-- Streak (зафиксировано): счётчик дней с клеймами включая сегодня, НЕ цепочка
-- календарных дней подряд. Пропуск дня строк не создаёт и счётчик НЕ сбрасывает —
-- следующий клейм продолжает со следующего дня streak. Календарь недельный
-- циклический: позиция = ((streak - 1) % 7) + 1, т.е. 8-й день streak = снова
-- день 1 (100), день 7/14/21 = 500. День суток — UTC (claim_day date), как леджер.
--
-- Повторный клейм в тот же день — тихо noop: ON CONFLICT DO NOTHING + возврат
-- уже выданного (amount/streak/balance, already = true), движений в леджер нет.
-- Применить: мёрж в main применит сам; руками на прод НЕ накатывать.

-- 0. Клеймы: один ряд на день входа. streak — номер дня streak (1, 2, ...),
-- amount — выданная награда (аудит уже выданного для повторного клейма).
create table public.daily_claims (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  claim_day date not null default CURRENT_DATE,
  streak int not null check (streak >= 1),
  amount bigint not null check (amount > 0),
  created_at timestamptz not null default now(),
  unique (user_id, claim_day)
);
create index daily_claims_user_day_idx on public.daily_claims (user_id, claim_day desc);

-- 1. RLS: свои клеймы видны только себе; гостю деньги не отдаются.
-- Записей клиенту нет вовсе: ни insert/update/delete-политик —
-- клеймы пишет только сервер (RPC ниже).
alter table public.daily_claims enable row level security;

revoke all on public.daily_claims from anon, authenticated;
grant select on public.daily_claims to authenticated;

create policy daily_claims_select_own on public.daily_claims
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- 2. RPC: первый клик дня начисляет награду дня streak, повторный — возвращает
-- уже выданное без дубля. Возврат — OUT-параметры с префиксом claim_.
create or replace function public.claim_daily()
returns table (
  claim_day date,
  claim_streak int,
  claim_amount bigint,
  claim_balance bigint,
  claim_already boolean
)
language plpgsql
security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_today date := (now() at time zone 'UTC')::date;
  v_balance bigint;
  v_streak int;
  v_day_num int;
  v_amount bigint;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  -- Счёт лочится до конца транзакции: гонка двух вкладок видит один баланс.
  select p.balance into v_balance from public.profiles as p
    where p.user_id = v_uid for update;
  if not found then raise exception 'insufficient funds: no account'; end if;

  -- Повторный клейм в тот же день: тихо ничего не делаем, отдаём уже выданное.
  select c.streak, c.amount into v_streak, v_amount
    from public.daily_claims as c
    where c.user_id = v_uid and c.claim_day = v_today;
  if found then
    claim_day := v_today; claim_streak := v_streak; claim_amount := v_amount;
    claim_balance := v_balance; claim_already := true;
    return next;
    return;
  end if;

  -- streak = число дней с клеймами включая сегодня; пропуск счётчик не сбрасывает.
  select count(*)::int + 1 into v_streak
    from public.daily_claims as c where c.user_id = v_uid;
  -- Недельный цикл: 8-й день streak = снова день 1.
  v_day_num := ((v_streak - 1) % 7) + 1;
  v_amount := case v_day_num
    when 1 then 100
    when 2 then 100
    when 3 then 150
    when 4 then 150
    when 5 then 200
    when 6 then 250
    else 500
  end;

  -- Гонка двух вкладок: второй INSERT падает в конфликт — вернуть уже выданное.
  begin
    insert into public.daily_claims (user_id, claim_day, streak, amount)
    values (v_uid, v_today, v_streak, v_amount);
  exception when unique_violation then
    select c.streak, c.amount into v_streak, v_amount
      from public.daily_claims as c
      where c.user_id = v_uid and c.claim_day = v_today;
    claim_day := v_today; claim_streak := v_streak; claim_amount := v_amount;
    claim_balance := v_balance; claim_already := true;
    return next;
    return;
  end;

  -- Кредит награды + леджер (источник daily_login для метрики здоровья).
  update public.profiles set
    balance = balance + v_amount,
    updated_at = now()
  where user_id = v_uid;
  insert into public.ledger (user_id, amount, source)
  values (v_uid, v_amount, 'daily_login');

  select p.balance into v_balance from public.profiles as p where p.user_id = v_uid;
  claim_day := v_today; claim_streak := v_streak; claim_amount := v_amount;
  claim_balance := v_balance; claim_already := false;
  return next;
  return;
end;
$$;

revoke all on function public.claim_daily() from public, anon, authenticated;
grant execute on function public.claim_daily() to authenticated;

-- 3. Свои клеймы — в realtime-публикации (клиент красит календарь живым статусом).
alter publication supabase_realtime add table public.daily_claims;
