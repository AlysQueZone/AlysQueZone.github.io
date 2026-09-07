-- Polish-01/07: пауза перед повторной покупкой — per-(user,lot), 30с.
-- Было: глобальная проверка per-user (повтор ЛЮБОГО лота < 30с отклонялся).
-- Стало: отклоняется только повтор ТОГО ЖЕ лота тем же чатерсом < 30с;
-- разные лоты покупаются без задержки. Кап 10 покупок/10мин, блок ЛУКа,
-- цена ceil +10% и кап цены — без изменений.
-- Текст ошибки паузы — 'cooldown: wait <interval>' (HH:MM:SS),
-- клиент парсит секунды через parseCooldownSec.

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
  v_locked boolean;
  c_cooldown interval := interval '30 seconds';
  c_max_per_window int := 10;
  c_window interval := interval '10 minutes';
  c_max_price bigint := 1000000000;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  select l.price, l.is_locked into v_price, v_locked
    from public.lots as l where l.id = NEW.lot_id for update;
  if not found then raise exception 'lot % not found', NEW.lot_id; end if;
  if v_locked then raise exception 'lot % is not for sale (LUK)', NEW.lot_id; end if;

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

  return NEW;
end;
$$;
revoke execute on function public.enforce_purchase_rules() from public, anon, authenticated;
