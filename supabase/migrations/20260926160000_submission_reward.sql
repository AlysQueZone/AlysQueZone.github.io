-- Награда за принятый привет (спека scratch/suggest-greeting/spec.md, тикет 11).
-- Принятие заявки начисляет автору +500 Пивкойнов один раз (RPC только для
-- service_role, идемпотентный по submissions.rewarded_at) и включает роялти:
-- 3% цены сделки автору привета за первые три перекупа лота, из комиссии биржи
-- (7% = 4% сгорает + 3% автору). Продавец получает как раньше: с него
-- по-прежнему списываются полные 7% (commission_burn), а 3% из них уходят
-- автору отдельной строкой royalty_credit — нетто-сжигание 4%, инвариант
-- «баланс = сумма движений» держится, роялти новых пивкойнов не печатает.
-- Ставка — одним числом в public.royalty_rate() (по образцу commission_rate).
-- Автор без счёта (аккаунт удалён: author_uid/suggested_by_uid is null) —
-- платить некому; профиль не создаём, иначе сминтили бы 1000 «потерянному»
-- uid (research/bonus-economy-options.md §6).
-- Применить: мёрж в main применит сам; руками на прод НЕ накатывать.

-- 0. Ставка роялти одним числом (пересмотр = строка в новой миграции,
--    а не охота за литералом 0.03 по триггерам). Клиентское зеркало —
--    ROYALTY_RATE в src/lib/prices.ts (показ).
create or replace function public.royalty_rate()
returns numeric language sql immutable
as $$ select 0.03::numeric $$;
revoke execute on function public.royalty_rate() from public, anon, authenticated;

-- 1. Разовая выплата за принятие заявки: только service_role, идемпотентно.
--    rewarded_at — ключ идемпотентности. Если аккаунт автора удалён
--    (author_uid null), выплаты нет, но rewarded_at ставим: решение
--    окончательное, повторный запуск пайплайна не должен ретраить вечно.
--    Строка леджера — submission_bonus (mint: деньги появляются из воздуха;
--    баланс автора растёт ровно на сумму строки, инвариант держится).
create or replace function public.pay_submission_reward(p_submission_id bigint)
returns text language plpgsql
security definer set search_path = ''
as $$
declare
  v_uid uuid;
  v_status text;
  v_rewarded timestamptz;
  c_bonus bigint := 500;
begin
  select s.author_uid, s.status, s.rewarded_at
    into v_uid, v_status, v_rewarded
    from public.submissions as s
    where s.id = p_submission_id
    for update;
  if not found then
    raise exception 'submission % not found', p_submission_id;
  end if;

  -- Уже выплачено (или признано невыплачиваемым) — повторно не платим.
  if v_rewarded is not null then
    return 'already';
  end if;
  if v_status <> 'accepted' then
    raise exception 'submission % not accepted (status=%)',
      p_submission_id, v_status;
  end if;

  -- Автор без счёта (аккаунт удалён): платить некому. Счёт не заводим
  -- (см. шапку), но помечаем заявку решённой, чтобы не ретраить.
  if v_uid is null or not exists (
    select 1 from public.profiles as p where p.user_id = v_uid
  ) then
    update public.submissions as s set rewarded_at = now()
      where s.id = p_submission_id;
    return 'no_account';
  end if;

  update public.profiles set
    balance = balance + c_bonus,
    updated_at = now()
  where user_id = v_uid;

  insert into public.ledger (user_id, amount, source)
  values (v_uid, c_bonus, 'submission_bonus');

  update public.submissions as s set rewarded_at = now()
    where s.id = p_submission_id;

  return 'paid';
end;
$$;
revoke all on function public.pay_submission_reward(bigint)
  from public, anon, authenticated;
grant execute on function public.pay_submission_reward(bigint) to service_role;

-- 2. Роялти в покупке: первые три перекупа лота платят автору привета
--    (lots.suggested_by_uid, денормализован при принятии) 3% цены сделки.
--    Комиссия 7% по-прежнему списывается с продавца целиком
--    (commission_burn), роялти — отдельная положительная строка
--    royalty_credit автору; нетто сгорает 4%, продавец получает как раньше.
--    Роялти только там, где у сделки есть продавец (первый забор owner null:
--    комиссии нет, платить не из чего) и у автора есть счёт.
--    «Первые три перекупа» — purchase_count до инкремента 1/2/3: значение 0 —
--    это первый забор лота без продавца (комиссии нет, платить не из чего),
--    поэтому три фактических перекупа — это именно 1/2/3.
--    Вся прочая логика (дебет, кредит продавцу, комиссия, цена/владелец/
--    счётчик, чистка хвоста до 50) без изменений.
create or replace function public.apply_purchase()
returns trigger language plpgsql
security definer set search_path = ''
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

  delete from public.purchases as p
  where p.lot_id = NEW.lot_id
    and p.id not in (select id from public.purchases
                     where lot_id = NEW.lot_id
                     order by created_at desc, id desc limit 50);
  return NEW;
end;
$$;
revoke execute on function public.apply_purchase() from public, anon, authenticated;
