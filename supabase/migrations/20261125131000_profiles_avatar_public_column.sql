-- Аватар — пятая публичная колонка profiles, как баланс и подпись: отдельный
-- security definer-хелпер и usage на private клиентам не нужны. Возвращаем
-- private закрытой: клиентские роли снова не могут вызывать новые функции
-- схемы (Postgres даёт EXECUTE по умолчанию). Применить: мёрж в main применит
-- сам; руками на прод НЕ накатывать.
--
-- Сама колонка публична по природе (Twitch показывает её всем), поэтому
-- column-грант — то же решение, что и для `login`: прямой select отдаёт
-- только перечисленные колонки, `updated_at` и `ledger` остаются закрытыми.

revoke usage on schema private from anon, authenticated, service_role;
drop function if exists private.profile_avatar(uuid);

grant select (avatar_url) on public.profiles to anon, authenticated;

-- Read model читает колонку тем же security invoker: гранты и RLS
-- вызывающего, без обхода. Состав OUT-колонок прежний — меняем только источник.
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
    p.avatar_url,
    p.balance,
    p.created_at,
    (p.balance + coalesce(sum(l.price), 0))::bigint as capital,
    count(l.id)::bigint as lots_count
  from public.profiles as p
  left join public.lots as l on l.owner_uid = p.user_id
  where p.user_id = uid
  group by p.user_id, p.login, p.avatar_url, p.balance, p.created_at;
$$;
revoke execute on function public.public_profile(uuid) from public;
grant execute on function public.public_profile(uuid) to anon, authenticated, service_role;
