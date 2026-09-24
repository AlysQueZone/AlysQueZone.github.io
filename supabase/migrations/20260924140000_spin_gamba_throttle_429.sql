-- Гамба: порядок проверок и явный 429 у отказов (разбор логов за неделю).
-- Диагноз: клиент одного Чатерса (зажатый Enter / автоклик) за час долбил
-- spin_gamba ~5000 раз; дневной кэп уже был исчерпан, и каждый запрос падал
-- P0001 → HTTP 400 и ERROR в postgres-логах.
-- ВАЖНО: сами серверные лимиты такой флуд НЕ гасят — они считают только
-- УСПЕШНЫЕ спины (public.gamba_spins), а отклонённые попытки в таблицу не
-- пишутся. Значит после кэпа антибот-окно пустое и каждый запрос снова
-- долетает до daily-limit. От флуда защищает клиентский лок (GambaModal.astro),
-- а не порядок проверок; серверное гашение — отдельная задача (писать попытки
-- в отдельную таблицу/счётчик), здесь её нет.
-- Что делает эта миграция:
--   * код отказа лимитов — `raise sqlstate 'PT429'` (PostgREST отдаёт HTTP 429
--     Too Many Requests вместо общего 400/P0001): читаемость в мониторинге;
--   * антибот-rate-limit (1/2с, 20/мин) — ПЕРЕД дневным лимитом, чтобы в окне
--     антибота отказ приходил как rate-limit, а не как «кэп дня»;
--   * тексты сообщений не меняются — клиентский маппинг (mapGambaError)
--     матчит по тексту.
-- Ставка, выплаты, идемпотентность, гейт денег, механика streak — без изменений.
-- Применить: мёрж в main применит сам; руками на прод НЕ накатывать.

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
    if v_balance is null then raise exception 'insufficient funds: no account (счёта нет — напиши в чат, выдадим стартовые 1000)'; end if;
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

revoke all on function public.spin_gamba(uuid) from public, anon, authenticated;
grant execute on function public.spin_gamba(uuid) to authenticated;
