-- Прототип shared-Владельца: новые таблицы по умолчанию НЕ входят в
-- публикацию supabase_realtime — без этого postgres_changes-подписка падает с
-- "Unable to subscribe to changes with given parameters".
-- Чинит живые обновления витрины (таблица lots).
-- Применить: npx supabase db push.
-- (Альтернатива руками: Dashboard → Database → Replication → включить lots/purchases.)

alter publication supabase_realtime add table public.lots;
alter publication supabase_realtime add table public.purchases;
