# Реестр `content/chatters.toml` и синк из чата

Status: resolved
Type: task
Blocked by: 01

## Question

Завести реестр ников и его синк из чата VOD.

- Схема: `content/chatters.toml`, массив `[[chatters]]` с `nick` (канон — display-имя из чата), `login` (ключ дедупа, нижний регистр), опциональным `aliases = []` и опциональным `id` (числовой user id, если источник его даёт); шапка-комментарий как в `content/lots.toml`.
- `scripts/chatters_sync.py` (stdlib, без зависимостей; рядом с `lots_sync.py`): идемпотентно добавляет новые ники из `chat.json` по ключу `id` (если есть) иначе `login`, **никогда не трогает алиасы**; умеет принять готовый JSON и/или `--vod <id>`; рецепт `just chatters-sync`. Не полагаться на `user.lower() == login`.
- Bootstrap: вытащить ники из архивного `chat-2864275043.json` (лежит в git-истории `.scratch/alysque-launch/research/`), исключив стримера `aLySQuE` и ботов (`LYSB0T`, `Bot_91`) — ~172 ника.

Ответ: файл-реестр + скрипт + рецепт; сколько ников заведено и из какого VOD.

## Answer

- `content/chatters.toml` — **172 ника** из VOD `2864275043`; исключены `aLySQuE` (стример), `LYSB0T`, `Bot_91` (боты). Схема: `nick` / `login` / `id`; `aliases` пока пусто (их дописывает агент).
- `scripts/chatters_sync.py` (stdlib, без зависимостей):
  - `--chat <json>` читает и компактный дамп, и нативный TwitchDownloader;
  - `--vod <id>` скачивает чат анонимным GQL (пагинация по `contentOffsetSeconds` + дедуп по `id`; конец чата Twitch отдаёт `service error` — скрипт это ловит и завершается);
  - идемпотентный merge по `id`, иначе по `login`; `nick` обновляется под свежий display, `aliases` **не трогаются**, файл переписывается только при реальных изменениях.
- `just chatters-sync *args` (напр. `just chatters-sync --vod <id>`).
- Проверено: полный прогон `--vod 2864275043` собрал ровно **3662 сообщения** (совпало с research §2); повторный `--chat` — 0 изменений.
