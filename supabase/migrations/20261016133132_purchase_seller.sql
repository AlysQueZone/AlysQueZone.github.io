-- Продавец сделки в БД (владение лотом — docs/adr/0010, канон живой
-- математики — docs/agents/economy.md). Раньше продавца не хранили: на сервере
-- его выводили из текущего владельца лота, на клиенте — из предыдущей строки
-- цепочки покупок.
-- Поэтому первая строка «Истории перепродаж» врала у любого лота (показывала
-- нынешнего владельца вместо первого продавца), первой продаже автора привета
-- не находилось места в оффлайн-догоне Колокольчика, а само-переходы вида
-- `X → X` вообще были возможны.
--
-- Теперь продавец — факт сделки: `purchases.seller_uid`/`seller_login`. NULL
-- значит «продавца не было» (ничей лот админа) → на витрине «Биржа», а не
-- «неизвестно». Продавца пишет BEFORE-триггер из владельца лота до сделки и
-- перезаписывает оба поля всегда: у `authenticated` нет UPDATE на `purchases`,
-- а из INSERT принимаются только lot_id/buyer_uid — подделать продавца нельзя.
--
-- Заодно AFTER-триггер перестаёт подрезать историю лота до 50 строк: она
-- хранится целиком, поэтому первая сделка не потеряется с ростом перекупов.
-- Три лота, обрезанных до этой миграции, не восстанавливаем: логинов в
-- `public.ledger` нет — их первая сохранённая строка честно покажет «Биржа».
--
-- Гранты и RLS не меняем: они табличные и накрывают новые колонки; новых
-- объектов, кроме индекса, нет. Публичность `purchases` не расширяем и не
-- сужаем. Математика (цена, комиссия, роялти, награда) не тронута.
-- Применить: мёрж в main применит сам; руками на прод НЕ накатывать.

-- 1. Колонки продавца + зеркало индекса покупателя (нужен оффлайн-догону
--    Колокольчика: выборка сделок `where seller_uid = uid` свежими сверху).
alter table public.purchases
  add column if not exists seller_uid uuid null,
  add column if not exists seller_login text null;

create index if not exists purchases_seller_time_idx
  on public.purchases (seller_uid, created_at desc);

-- 2. Бэкфилл старых сделок: продавец — предыдущий покупатель по
--    (created_at, id) внутри лота (`lag`); у первой сохранённой строки лота
--    продавец — владелец при приёме заявки (`lots.suggested_by_uid`), и только
--    если он есть: при удалённом авторе владельца не назначали — там продавца
--    не было (NULL → «Биржа»).
with chain as (
  select
    p.id,
    p.lot_id,
    lag(p.buyer_uid) over w as prev_uid,
    lag(p.buyer_login) over w as prev_login
  from public.purchases as p
  window w as (partition by p.lot_id order by p.created_at, p.id)
)
update public.purchases as p
set seller_uid = case
      when c.prev_uid is not null then c.prev_uid
      when l.suggested_by_uid is not null then l.suggested_by_uid
      else null
    end,
    seller_login = case
      when c.prev_uid is not null then c.prev_login
      when l.suggested_by_uid is not null then l.suggested_by_login
      else null
    end
from chain as c
join public.lots as l on l.id = c.lot_id
where p.id = c.id;

-- 3. BEFORE-триггер покупки: продавец — владелец лота до сделки. Строка лота
--    уже залочена `for update` — берём owner_uid/owner_login оттуда (у ничейного
--    лота оба NULL). Цена — из одной формулы, identity, пауза, кап покупок и
--    гейт денег — без изменений (docs/adr/0007).
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
  v_owner_login text;
  v_buys bigint;
  v_buyer_balance bigint;
  c_cooldown interval := interval '30 seconds';
  c_max_per_window int := 10;
  c_window interval := interval '10 minutes';
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  select l.price, l.owner_uid, l.owner_login, l.purchase_count
    into v_price, v_owner_uid, v_owner_login, v_buys
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

  -- Продавец — владелец лота до покупки; NULL = продавца не было (ничей лот).
  -- Пишем оба поля всегда, не доверяя клиентскому INSERT.
  NEW.seller_uid := v_owner_uid;
  NEW.seller_login := case when v_owner_uid is null then null else v_owner_login end;

  -- Цена: рост — из одной формулы, потолок — из одной константы (см. выше).
  NEW.price_paid := public.next_lot_price(v_price, v_buys);
  if NEW.price_paid > public.lot_price_cap() then
    raise exception 'price cap reached';
  end if;

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

  -- Деньги: хватает ли серверной цены. Строка покупателя лочится
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

-- 4. AFTER-триггер покупки: начисления, комиссия, роялти, обновление лота и
--    счётчик — без изменений (награда за привет — migration submission_reward).
--    Убрана только подрезка истории лота до 50 строк: она хранится целиком,
--    поэтому первая сделка не потеряется с ростом перекупов. Продавца тут не
--    трогаем — его уже записал BEFORE-триггер в NEW.
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

  return NEW;
end;
$$;
revoke execute on function public.apply_purchase() from public, anon, authenticated;
