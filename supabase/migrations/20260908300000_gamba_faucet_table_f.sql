-- Пивкойны в БД, тикет 16: Гамба-фаусет, таблица F (щедрый аттракцион).
-- Ставка 100: 30% — мимо (0), 40% — +50 (150), 22% — +200 (300),
-- 8% — джекпот x10 (1000). Со 100 возвращается в среднем 206,
-- 70% спинов в плюсе; синков в экономике не остаётся (бывший edge 10%
-- спина отменён этим тикетом).
-- Append-only: файл тикета 09 не тронут; RPC spin_gamba НЕ меняется —
-- исход считается по конфигу из public.gamba_payouts (проверено чтением
-- функций в 20260908240000 и 20260908290000: взвешенный ролл по weight,
-- порядок — по payout), новый конфиг подхватится сам. Здесь только
-- CHECK-рамки под новые исходы/выплаты (старые 100/500 и 'return'
-- оставлены валидными ради истории спинов) + замена seed-строк через
-- DELETE+INSERT (старые строки UPDATE не правятся).
-- RLS/гранты таблицы не меняются (публичный SELECT anon/authenticated).
-- Применить: агент на прод не накатывал; применение — мёржем в main / человеком.

-- 1. CHECK-рамки под 4 исхода (superset: старые значения валидны).
alter table public.gamba_payouts drop constraint if exists gamba_payouts_outcome_check;
alter table public.gamba_payouts
  add constraint gamba_payouts_outcome_check
  check (outcome in ('miss', 'return', 'small', 'big', 'jackpot'));

alter table public.gamba_spins drop constraint if exists gamba_spins_outcome_check;
alter table public.gamba_spins
  add constraint gamba_spins_outcome_check
  check (outcome in ('miss', 'return', 'small', 'big', 'jackpot'));

alter table public.gamba_spins drop constraint if exists gamba_spins_payout_check;
alter table public.gamba_spins
  add constraint gamba_spins_payout_check
  check (payout in (0, 100, 150, 300, 500, 1000));

-- 2. Новый seed таблицы F (старые строки не UPDATE — только DELETE+INSERT).
delete from public.gamba_payouts
where outcome in ('miss', 'return', 'jackpot');

insert into public.gamba_payouts (outcome, payout, weight, label) values
  ('miss', 0, 30, 'мимо'),
  ('small', 150, 40, '+50'),
  ('big', 300, 22, '+200'),
  ('jackpot', 1000, 8, 'джекпот x10');
