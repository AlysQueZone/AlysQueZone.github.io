-- Леджер: разовая компенсация ручных правок баланса через web-UI.
-- В первые дни бэкенда владелец вручную выдавал Пивкойны нескольким чатерсам
-- прямо в Supabase Studio; такие правки меняют public.profiles.balance, но не
-- пишут строк в public.ledger. Из-за этого инвариант «баланс = сумма движений»
-- перестал сходиться у двух счетов (итого 1 840) и всплывал при пересчёте
-- математики. Компенсируем разницу источником manual_adjustment.
-- Идемпотентно: повторный прогон вставит 0 строк (после первой вставки
-- баланс и сумма движений сходятся, having отсекает всё).
-- Применить: мёрж в main применит сам; руками на прод НЕ накатывать.

with diff as (
  select p.user_id,
         p.balance - coalesce(sum(l.amount), 0) as delta
  from public.profiles as p
  left join public.ledger as l on l.user_id = p.user_id
  group by p.user_id, p.balance
  having p.balance <> coalesce(sum(l.amount), 0)
)
insert into public.ledger (user_id, amount, source)
select user_id, delta, 'manual_adjustment'
from diff
where delta <> 0;
