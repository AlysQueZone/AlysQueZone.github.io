-- Ребаланс пивкойнов, тикет 04: вход 200/200/250 в первые три дня.
-- Шкала была 100/100/150/150/200/250/500, стала 200/200/250/150/200/250/500:
-- хвост недели (дни 4–7) и стартовые 1000 — без изменений, механика streak
-- (счётчик без сброса, цикл 7, UTC-день, noop-повтор) — как была.
-- Переписывает только ветку v_amount в claim_daily (create or replace).
-- Уже выданные клеймы не пересчитываются — правила только вперёд.
-- Применить: мёрж в main применит сам; руками на прод НЕ накатывать.

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
    when 1 then 200
    when 2 then 200
    when 3 then 250
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
