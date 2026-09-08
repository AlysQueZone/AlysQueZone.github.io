# Прототип общей покупки на одном кандидате

Type: prototype
Status: resolved
Blocked by: 01, 02, 04

## Question

Собрать throwaway-прототип (не в `src/`, а рядом с картой, напр. `scratch/shared-state/prototype/`): одна страница/кусок `BuyModal`-флоу, где нажатие «Купить» пишет Владельца в один сервис-финалист и второй браузер видит смену. Какой минимум показывает, что схема «последний нажавший — Владелец» живёт на статике с 0₽ и из РФ? Прототип — только для реакции человека, не продакшн-код.

## Answer

Вердикт: работает. Прогон человеком (2 Twitch-аккаунта, 2 браузера): вход, покупки INSERT, server-side цена/владелец, блок ЛУКа, Realtime-обновление второго браузера (после добавления таблиц в публикацию `supabase_realtime`), JWT claims на месте — контракт twitch-identity подтверждён. По ходу чинены: миграция realtime-публикации + `.gitignore` под `.env`. Решение по кулдауну: 30с (мало юзеров — фан важнее строгости; было тестовых 90с), кап 10 покупок/10мин оставлен. Артефакты: `scratch/shared-state/prototype/buy-shared.html`, `supabase/migrations/20260906093829_shared_lots.sql`, `supabase/migrations/20260906211834_realtime_publication.sql`. Throwaway-страницу выкинуть на этапе продакшн-реализации.

## Comments

- 2026-09-06: человек завёл проект Supabase сам; секреты лежат в `.env` (не читать, в git не коммитить — `.gitignore` поправлен), форма ключей видна в `.env.example` (`DB_PROJECT_URL`, `DB_PUBLISHABLE_KEY`, пароль/DSN только для сервера, в клиент их нельзя). Прототип строим против этого проекта.
- 2026-09-06: артефакт готов (агент, ветка LOGIC): `scratch/shared-state/prototype/buy-shared.html` — один файл, свободная игра (вход через Twitch, покупка INSERT, Realtime, журнал + дамп getUser/JWT-claims, тест ЛУКа и кулдауна) + чеклист прогона внутри. Схема: `supabase/migrations/20260906093829_shared_lots.sql` (таблицы, RLS, триггеры, PROTOTYPE-SEED `proto-*`). Ждём прогон человеком: `db push` → Twitch app + провайдер → http-serve → два браузера → вердикт + содержимое секции JWT claims.
- 2026-09-06: шаг «Twitch app» упёрся в 2FA: SMS на +7 системно заблокирован Twitch с 22.03.2023 (см. тикет про Twitch 2FA). Обход: SMS-шаг пройти на не-RU real-SIM номере, сразу привязать TOTP-приложение — детали в том тикете.
- 2026-09-06: первый прогон человеком (2 Twitch-аккаунта, 2 браузера): покупки и RLS/триггеры работают, но Realtime-подписка падает («Unable to subscribe...» — таблицы не в публикации supabase_realtime). Лечение: новая миграция `supabase/migrations/20260906211834_realtime_publication.sql` (`alter publication ... add table`), применить `db push`. Открыто: содержимое секции JWT claims (человек пишет «пусто» — уточнить, нажималась ли кнопка «Показать getUser()» и что в секции сессии/журнале).
