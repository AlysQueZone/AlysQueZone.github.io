-- Пивкойны в БД, review-fixes (п.3): updated_at профилей ставит один триггер.
-- Ручные `updated_at = now()` в денежных UPDATE миграций 08–10 оставлены как есть
-- (безвредны: триггер ставит то же значение); новым денежным записям ручные
-- присвоения не нужны — метку ставит триггер ниже.
-- Применить: мёрж в main применит сам; руками на прод НЕ накатывать.

create or replace function public.profiles_touch_updated_at()
returns trigger language plpgsql
security definer set search_path = ''
as $$
begin
  NEW.updated_at := now();
  return NEW;
end;
$$;

revoke all on function public.profiles_touch_updated_at() from public, anon, authenticated;

drop trigger if exists profiles_touch_updated_at on public.profiles;

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.profiles_touch_updated_at();
