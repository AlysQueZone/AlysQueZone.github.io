-- Публичный профиль чатерса: подпись-логин в profiles и read model
-- public_profile(uid). Баланс, капитал, дата и число приветов публичны;
-- служебное updated_at и журнал движений Пивкойнов (ledger) остаются закрыты.
-- Логин — только подпись, не ключ доступа: решения доступа живут на uid.
-- Применить: мёрж в main применит сам; руками на прод НЕ накатывать.

-- 1. Подпись: текущий Twitch-логин. Nullable — у старых/странных счетов
-- логина может не быть, страница по uid всё равно работает («@чатерс»).
alter table public.profiles add column if not exists login text;

-- 2. Бэкфилл из метаданных Supabase Auth: user_name → preferred_username →
-- name → email, пустые строки — отсутствие. Только где login ещё null:
-- повторный прогон никого не переписывает и ничего не выдумывает.
with picked as (
  select
    u.id,
    coalesce(
      nullif(btrim(u.raw_user_meta_data ->> 'user_name'), ''),
      nullif(btrim(u.raw_user_meta_data ->> 'preferred_username'), ''),
      nullif(btrim(u.raw_user_meta_data ->> 'name'), ''),
      nullif(btrim(u.raw_user_meta_data ->> 'email'), '')
    ) as login
  from auth.users as u
)
update public.profiles as p
set login = picked.login
from picked
where picked.id = p.user_id
  and p.login is null
  and picked.login is not null;

-- 3. Синк подписи на вставку пользователя и смену метаданных (Twitch-ник).
-- ensure_profile, а не прямой insert: счёт открывается с движением
-- seed_opening, и порядок с on_auth_user_created не ломает инвариант
-- «баланс = сумма движений». Метаданные опустели — прежнюю подпись не
-- затираем: пустой ник хуже старого.
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
begin
  perform public.ensure_profile(NEW.id);
  if v_login is not null then
    update public.profiles as p set login = v_login where p.user_id = NEW.id;
  end if;
  return NEW;
end;
$$;
revoke execute on function public.sync_profile_login() from public, anon, authenticated;

drop trigger if exists on_auth_user_login_sync on auth.users;
create trigger on_auth_user_login_sync
  after insert or update of raw_user_meta_data on auth.users
  for each row execute function public.sync_profile_login();

-- 4. Публичное чтение profiles: только четыре колонки. Table-level select у
-- authenticated снимаем — иначе select('*') отдал бы updated_at. RLS остаётся
-- включённой; profiles_select_own сохраняем как историческую политику «свой
-- баланс», публичная политика её перекрывает по OR.
revoke select on public.profiles from anon, authenticated;
grant select (user_id, login, balance, created_at) on public.profiles to anon, authenticated;

drop policy if exists profiles_select_public on public.profiles;
create policy profiles_select_public on public.profiles
  for select to anon, authenticated
  using (true);

-- 5. Read model профиля: один вызов — паспорт целиком. security invoker:
-- работают гранты и RLS вызывающего; search_path = '' — только полные имена.
-- capital = баланс + текущие цены приветов во владении (как разовый догон
-- капитала); sum(bigint) — numeric, поэтому явный ::bigint.
create or replace function public.public_profile(uid uuid)
returns table (
  user_id uuid,
  login text,
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
