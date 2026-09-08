-- Пивкойны в БД, тикет 07: счета Чатерсов и стартовые 1000.
-- Порядок миграций по спеке: счета → леджер → спины/RPC → вход/RPC →
-- деньги покупки → прайс-фид. Этот файл — только счета и показ.
-- Локальный кошелёк (src/lib/wallet.ts) живёт рядом (expand), деньги
-- здесь никто не тратит: баланс — серверный кэш, пишет только сервер.
-- Применить: мёрж в main применит сам; руками на прод НЕ накатывать.

-- 0. Таблица счетов: user_id = Supabase Auth UID, баланс стартует с 1000.
create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  balance bigint not null default 1000 check (balance >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 1. RLS: свой баланс виден только себе; гостю деньги не отдаются.
-- Записей денег клиенту нет вовсе: ни insert/update/delete-политик —
-- баланс пишет только сервер (триггер ниже, позже — леджер/RPC тикетов 08-10).
alter table public.profiles enable row level security;

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;

create policy profiles_select_own on public.profiles
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- 2. Стартовые 1000 — триггером на появление пользователя, не кодом.
-- Повторный вызов безопасен (on conflict do nothing).
create or replace function public.handle_new_profile()
returns trigger language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (user_id, balance)
  values (NEW.id, 1000)
  on conflict (user_id) do nothing;
  return NEW;
end;
$$;
revoke execute on function public.handle_new_profile() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_profile();

-- 3. Живой баланс в шапке: таблица в realtime-публикации,
-- клиент подписывается postgres_changes по своему user_id.
alter publication supabase_realtime add table public.profiles;
