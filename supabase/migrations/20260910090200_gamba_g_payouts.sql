-- Ребаланс пивкойнов, тикет 03: Гамба G — печатный станок к нейтральности.
-- Ставка 100 не трогается; новый seed-набор (таблица G): мимо 52% → 0,
-- возврат 30% → 100, крупно 15% → 250 (+150), джекпот x10 3% → 1000.
-- EV = (30*100 + 15*250 + 3*1000)/100 = 97.5 (было ~206 у таблицы F).
-- Джекпот x10 жив — мечта остаётся; доля спинов «в плюсе» падает 70% → 18%.
-- RPC spin_gamba НЕ меняется — исход считается по конфигу из
-- public.gamba_payouts (взвешенный ролл по weight, порядок — по payout),
-- новый конфиг подхватится сам. Старые значения (150/300/500, исходы
-- small/return) оставлены валидными в CHECK ради истории спинов.
-- Применить: мёрж в main применит сам; руками на прод НЕ накатывать.

-- 1. CHECK-рамки: новый номинал крупной выплаты 250 (superset, история валидна).
alter table public.gamba_spins drop constraint if exists gamba_spins_payout_check;
alter table public.gamba_spins
  add constraint gamba_spins_payout_check
  check (payout in (0, 100, 150, 250, 300, 500, 1000));

-- 2. Новый seed таблицы G (старые строки не UPDATE — только DELETE+INSERT).
delete from public.gamba_payouts
where outcome in ('miss', 'small', 'big', 'jackpot', 'return');

insert into public.gamba_payouts (outcome, payout, weight, label) values
  ('miss', 0, 52, 'мимо'),
  ('return', 100, 30, 'возврат 100'),
  ('big', 250, 15, '+150'),
  ('jackpot', 1000, 3, 'джекпот x10');
