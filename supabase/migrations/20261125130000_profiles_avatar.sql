-- Аватар чатерса: картинка Twitch в profiles.avatar_url и в публичном read
-- model public_profile(uid). Источник — метаданные Supabase Auth
-- (avatar_url → picture), их пишет провайдер Twitch при входе. Синк — тот же
-- триггер на auth.users, что обновляет логин; пустые метаданные прежнюю
-- картинку не затирают. Колонка profiles клиентам не открывается: URL едет
-- только через RPC. Применить: мёрж в main применит сам; руками на прод
-- НЕ накатывать.

-- 1. Аватар: nullable. Старые/странные счета могут жить без метаданных —
-- паспорт тогда показывает инициалы, страница по uid работает.
alter table public.profiles add column if not exists avatar_url text;

-- 2. Бэкфилл из метаданных: avatar_url → picture, пустые строки — отсутствие.
-- Только где avatar_url ещё null: повторный прогон никого не переписывает.
with picked as (
  select
    u.id,
    coalesce(
      nullif(btrim(u.raw_user_meta_data ->> 'avatar_url'), ''),
      nullif(btrim(u.raw_user_meta_data ->> 'picture'), '')
    ) as avatar_url
  from auth.users as u
)
update public.profiles as p
set avatar_url = picked.avatar_url
from picked
where picked.id = p.user_id
  and p.avatar_url is null
  and picked.avatar_url is not null;

-- 3. Синк аватара тем же триггером, что и подписи: create or replace
-- сохраняет OID, триггер on_auth_user_login_sync пересоздавать не нужно.
-- Метаданные опустели — ни логин, ни картинку не затираем (coalesce): пустой
-- ник и пустая картинка хуже старых.
create or replace function public.sync_profile_login()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_login text := coalesce(
    nullif(btrim(NEW.raw_user_meta_data ->> 'user_name'), ''),
    nullif(btrim(NEW.raw_user_meta_data ->> 'preferred_username'), ''),
    nullif(btrim(NEW.raw_user_meta_data ->> 'name'), ''),
    nullif(btrim(NEW.raw_user_meta_data ->> 'email'), '')
  );
  v_avatar text := coalesce(
    nullif(btrim(NEW.raw_user_meta_data ->> 'avatar_url'), ''),
    nullif(btrim(NEW.raw_user_meta_data ->> 'picture'), '')
  );
begin
  perform public.ensure_profile(NEW.id);
  if v_login is not null or v_avatar is not null then
    update public.profiles as p
    set login = coalesce(v_login, p.login),
        avatar_url = coalesce(v_avatar, p.avatar_url)
    where p.user_id = NEW.id;
  end if;
  return NEW;
end;
$$;
revoke execute on function public.sync_profile_login() from public, anon, authenticated;

-- 4. Чтение аватара для read model. public_profile — security invoker (гранты и
-- RLS вызывающего), а profiles.avatar_url клиентам не выдан: инвайдер-функция
-- на этой колонке упала бы 42501. Узкий security definer читает ровно один
-- URL по uid — сам аватар публичен, колонка остаётся закрытой. Схема private
-- не экспонируется Data API, поэтому helper снаружи недоступен; usage и
-- execute нужны лишь чтобы invoker-функция могла его вызвать.
create or replace function private.profile_avatar(uid uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.avatar_url from public.profiles as p where p.user_id = uid;
$$;
revoke execute on function private.profile_avatar(uuid) from public;
grant usage on schema private to anon, authenticated, service_role;
grant execute on function private.profile_avatar(uuid) to anon, authenticated, service_role;

-- 5. Read model: тот же паспорт плюс avatar_url. Состав OUT-колонок меняется —
-- create or replace не умеет, нужен drop + create. security invoker,
-- search_path = '' — как было; capital = баланс + текущие цены приветов.
drop function if exists public.public_profile(uuid);
create function public.public_profile(uid uuid)
returns table (
  user_id uuid,
  login text,
  avatar_url text,
  balance bigint,
  created_at timestamptz,
  capital bigint,
  lots_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    p.user_id,
    p.login,
    private.profile_avatar(p.user_id) as avatar_url,
    p.balance,
    p.created_at,
    (p.balance + coalesce(sum(l.price), 0))::bigint as capital,
    count(l.id)::bigint as lots_count
  from public.profiles as p
  left join public.lots as l on l.owner_uid = p.user_id
  where p.user_id = uid
  group by p.user_id, p.login, p.balance, p.created_at;
$$;
revoke execute on function public.public_profile(uuid) from public;
grant execute on function public.public_profile(uuid) to anon, authenticated, service_role;
