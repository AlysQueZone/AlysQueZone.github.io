# Telegram-уведомление: транспорт, секреты, деплой

Status: resolved
Type: research
Blocked by: none

## Question

Как из текущего стека (Astro-статика на GitHub Pages + Supabase) отправлять админу уведомление о новой заявке в Telegram, не утекая токен бота в браузер?

- В проекте нет ни Edge Functions, ни `pg_net`, ни вебхуков, ни CI; схема применяется миграциями из `main` автоматически.
- Сравнить варианты: Edge Function + Database Webhook; Database Webhook из коробки; `pg_net` + Vault; другие рабочие на 2026 способы.
- Для каждого: поток (кто триггерит), где живут bot token и chat_id, как деплоится без CI (`supabase` CLI), ретраи и ошибки, лимиты и стоимость, сложность.
- Шаги для человека: BotFather, получение chat_id.
- Ответ: рекомендация с обоснованием + шаги настройки + что попадает в спеку.

## Answer

Разбор: [`research/telegram-notification.md`](../research/telegram-notification.md).

- **Рекомендация — DB-нативный путь**: `after insert`-триггер на таблице заявок → `security definer`-функция в непубличной схеме `private` → `net.http_post` (pg_net) прямо в `api.telegram.org/.../sendMessage`. Токен и chat_id — в Supabase Vault (уже установлен в проекте), в git не попадают; всё уезжает обычной миграцией из `main`, без новых артефактов деплоя.
- **Database Webhook «напрямую» в Telegram не годится**: тело запроса фиксировано записью таблицы, `chat_id`/`text` не передать, токен оказался бы в URL триггера открытым текстом.
- **Альтернатива** — Edge Function + Database Webhook: рабочая, но добавляет ручной `supabase functions deploy` без CI и auth-обвязку; брать, если логика вырастет за один POST (разбор 429/`retry_after`, форматирование).
- **Ретраев нет**: pg_net шлёт один раз после коммита (at-most-once), ответы живут 6 часов в `net._http_response`. Если потеря недопустима — `notified_at` + `pg_cron`-бэкстоп (pg_cron доступен, не установлен); по умолчанию не тащим.
- **Отказ уведомления не должен откатывать заявку**: обернуть вызов в `exception`, при отсутствии секретов — `warning` и no-op.
- Человеку: @BotFather `/newbot` → обязательно `/start` боту → `getUpdates` → `chat_id` → оба секрета в Vault; ротация — `/revoke` + `vault.update_secret`.
- Проверено через Supabase MCP: PG 17.6, `supabase_vault` 0.3.1 установлен, `pg_net` доступен но не установлен. Состав сообщения — за тикетом [Сообщение в Telegram и пайплайн агента](06-telegram-message-and-agent-pipeline.md).
