-- Ребаланс пивкойнов, тикет 01: комиссия биржи 7% со сжиганием + счётчик покупок.
-- Покупатель платит цену как раньше (дебет purchase_debit на price_paid);
-- продавец получает цену минус комиссия (кредит purchase_credit на price_paid
-- + дебет commission_burn на комиссию: инвариант «баланс = сумма движений»
-- держится, сгоревшая разница видна в леджере отдельным источником).
-- Комиссия = ceil(price_paid * 7%), минимум 1; платит продавец из выручки.
-- Первые покупки без продавца (owner NULL): только дебет покупателя в никуда,
-- комиссии нет — кредитовать некого. Накопленное не трогаем.
-- lots.purchase_count — персистентный счётчик сделок лота (тикет 02 читает его
-- для затухания): история purchases режется до 50 записей, count(*) ненадёжен.
-- Бэкфилл — best effort по surviving-строкам (у обрезанных хвостов счётчик
-- занижен, дальше растёт честно). Формула цены здесь НЕ меняется (тикет 02).
-- Применить: мёрж в main применит сам; руками на прод НЕ накатывать.

-- 0. Счётчик покупок лота.
alter table public.lots
  add column if not exists purchase_count bigint not null default 0
    check (purchase_count >= 0);

update public.lots as l
set purchase_count = coalesce(
  (select count(*) from public.purchases as p where p.lot_id = l.id), 0)
where l.purchase_count = 0;

-- 1. AFTER: деньги с комиссией + инкремент счётчика (BEFORE без изменений:
-- цена, guard своего лота, пауза, кап, гейт денег — как были).
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

    -- Комиссия биржи: 7% выручки продавца сгорают (округление вверх, минимум 1).
    v_fee := greatest(ceil(NEW.price_paid * 0.07)::bigint, 1);
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
