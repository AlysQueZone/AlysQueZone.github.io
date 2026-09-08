-- Пивкойны в БД, тикет 15: бэкфилл счетов юзерам до триггера стартовых 1000.
-- Чатерсы, зарегистрировавшиеся до миграции тикета 07, остались без строк
-- в public.profiles: баланс пуст, клейм/покупка/спин не работают.
-- Эта миграция задним числом создаёт им профили с 1000 (+ открывающие строки
-- леджера seed_opening для инварианта «баланс = сумма движений»).
-- Идемпотентна: повторный прогон ничего не дублирует (профили — через
-- WHERE NOT EXISTS + ON CONFLICT DO NOTHING; леджер без уникальности по
-- юзеру — только через WHERE NOT EXISTS «нет движений вообще»).
-- Применить: мёрж в main применит сам; руками на прод НЕ накатывать.
--
-- Причина молчаливой залочки (найдена, чиню здесь же отдельными стейтментами,
-- клиент не тронут): при отсутствующем профиле сервер отвечал
-- `insufficient funds: no account` — для покупки/спины клиент маппил это в
-- «не хватает денег» (вводит в заблуждение: дело не в балансе, а в отсутствии
-- счёта), для клейма mapDailyError такого текста не знает вовсе и топил его в
-- generic ERROR_TEXT, а повтор спина с тем же ключом при отсутствующем профиле
-- вообще молча возвращал NULL-баланс. Ниже — тот же гейт, но с понятным
-- текстом; префикс `insufficient funds` сохранён намеренно — клиент матчит
-- ошибки по этой подстроке, маппинг не ломается. Тела функций — побайтово как
-- в миграциях 08–10, меняется только текст ошибки (+ null-гарда в повторе
-- спина); гранты/revoke от CREATE OR REPLACE не меняются.

-- 1. Бэкфилл счетов: всем auth-юзерам без профилей — стартовые 1000.
insert into public.profiles (user_id, balance)
select u.id, 1000
from auth.users as u
where not exists (select 1 from public.profiles as p where p.user_id = u.id)
on conflict (user_id) do nothing;

-- 2. Открывающие движения для инварианта (паттерн тикета 08): кому движений
-- нет вообще — строкой seed_opening на текущий баланс (у только что созданных
-- это 1000). balance <> 0 — из-за CHECK (amount <> 0) леджера.
insert into public.ledger (user_id, amount, source)
select p.user_id, p.balance, 'seed_opening'
from public.profiles as p
where p.balance <> 0
  and not exists (select 1 from public.ledger as l where l.user_id = p.user_id);

-- 3. Понятная ошибка покупки (BEFORE-гейт): был голый 'no account'.
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

  -- Деньги (тикет 08 + 15): хватает ли серверной цены. Строка покупателя лочится
  -- до конца транзакции — вторая покупка в гонке ждёт и видит новый баланс.
  -- Счёта нет (юзер до триггера/бэкфилла) — понятная ошибка, а не молчание.
  select p.balance into v_buyer_balance from public.profiles as p
    where p.user_id = v_uid for update;
  if not found then raise exception 'insufficient funds: no account (счёта нет — напиши в чат, выдадим стартовые 1000)'; end if;
  if v_buyer_balance < NEW.price_paid then
    raise exception 'insufficient funds: need %, have %', NEW.price_paid, v_buyer_balance;
  end if;

  return NEW;
end;
$$;

-- 4. Понятная ошибка покупки (AFTER-дебет): практически недостижимо (BEFORE уже
-- проверил под локом в той же транзакции), но текст должен быть тем же.
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
  if not found then raise exception 'insufficient funds: no account (счёта нет — напиши в чат, выдадим стартовые 1000)'; end if;

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

-- 5. Понятная ошибка спина + фикс молчаливого NULL-баланса в повторе:
-- раньше повтор с тем же ключом при отсутствующем профиле возвращал исход
-- с spin_balance = NULL без ошибки.
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
    if v_balance is null then raise exception 'insufficient funds: no account (счёта нет — напиши в чат, выдадим стартовые 1000)'; end if;
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

-- 6. Понятная ошибка клейма: раньше голый 'no account' топился клиентом
-- в generic ERROR_TEXT (mapDailyError такого текста не знает).
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
  -- Счёта нет (юзер до триггера/бэкфилла) — понятная ошибка, а не молчание.
  select p.balance into v_balance from public.profiles as p
    where p.user_id = v_uid for update;
  if not found then raise exception 'insufficient funds: no account (счёта нет — напиши в чат, выдадим стартовые 1000)'; end if;

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
