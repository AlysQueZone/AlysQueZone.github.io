-- Имя политики чтения gamba_sounds — по общему правилу `<таблица>_<действие>_<скоуп>`
-- (docs/agents/code-style.md): в первой миграции таблицы оно осталось без действия
-- (`gamba_sounds_public`), как у старой политики gamba_payouts. Политику
-- переименовываем отдельной миграцией: правки уже применённой не трогаем.
-- Права и смысл не меняются.
-- Применить: мёрж в main применит сам; руками на прод НЕ накатывать.

alter policy gamba_sounds_public on public.gamba_sounds
  rename to gamba_sounds_select_public;
