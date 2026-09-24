-- Явные гранты под изменение Supabase от 30.10.2026: новые таблицы, вью и
-- последовательности в public больше не получают гранты автоматически (default
-- privileges отключаются). Существующие объекты гранты сохраняют, но здесь мы
-- делаем их явными и чиним окружения с уже отключённым auto-expose:
-- новый проект / preview branch / локальный `supabase db reset` — там старая
-- миграция создаёт identity-sequence без GRANT, и INSERT из Data API падает
-- `permission denied for sequence`.
-- Гранты anon/authenticated по-прежнему выдаём точечно в миграциях своих таблиц
-- (минимальные права по дизайну), здесь трогаем только service_role и sequence.
-- Идемпотентна: повторный grant безвреден, на проде no-op (гранты уже есть).
-- Применить: мёрж в main применит сам; руками на прод НЕ накатывать.

grant usage, select on all sequences in schema public
  to anon, authenticated, service_role;

grant select, insert, update, delete on all tables in schema public
  to service_role;
