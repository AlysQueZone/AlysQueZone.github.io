-- Ребаланс пивкойнов, review-fix (US-17): ставка комиссии одним числом.
-- Ставка живёт в одном месте — функции public.commission_rate(): пересмотр
-- ставки = одна строка в новой миграции, а не охота за литералом 0.07
-- по триггерам. Формула округления (вверх, минимум 1) не меняется.
-- Клиентское зеркало — COMMISSION_RATE в src/lib/prices.ts (показ).
-- Применить: мёрж в main применит сам; руками на прод НЕ накатывать.

create or replace function public.commission_rate()
returns numeric language sql immutable
as $$ select 0.07::numeric $$;
revoke execute on function public.commission_rate() from public, anon, authenticated;

create or replace function public.apply_purchase()
returns trigger language plpgsql
security definer set search_path = ''
as $$
declare
  v_seller uuid;
  v_fee bigint;
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

    -- Комиссия биржи по единой ставке (см. commission_rate выше).
    v_fee := greatest(ceil(NEW.price_paid * public.commission_rate())::bigint, 1);
    update public.profiles set
      balance = balance - v_fee,
      updated_at = now()
    where user_id = v_seller;
    insert into public.ledger (user_id, amount, source, purchase_id)
    values (v_seller, -v_fee, 'commission_burn', NEW.id);
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
