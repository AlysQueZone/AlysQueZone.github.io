-- Звуки гамбы — контент, а не схема: список фраз по пулам живёт в
-- content/sounds.toml и публикуется синком `just sounds-sync` (миграции
-- содержимое не трогают, docs/adr/0011).
-- Здесь только таблица-проекция: клиент читает пулы при открытии окна и
-- подменяет ими фолбэк сборки (src/lib/gamba-sounds.gen.ts). Пустого пула в
-- БД не бывает: синк отказывается работать с пустым манифестом, а клиент при
-- неполном списке остаётся на фолбэке.
-- Применить: мёрж в main применит сам; руками на прод НЕ накатывать.

create table public.gamba_sounds (
  pool text not null check (pool in ('spin', 'win', 'jackpot', 'lose')),
  file text not null check (file <> ''),
  primary key (pool, file)
);

alter table public.gamba_sounds enable row level security;

revoke all on public.gamba_sounds from anon, authenticated;
grant select on public.gamba_sounds to anon, authenticated;
grant select, insert, update, delete on public.gamba_sounds to service_role;

create policy gamba_sounds_public on public.gamba_sounds
  for select to anon, authenticated
  using (true);
