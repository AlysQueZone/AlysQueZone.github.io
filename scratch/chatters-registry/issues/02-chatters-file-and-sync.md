# Реестр `content/chatters.toml` и синк из чата

Status: open
Type: task
Blocked by: 01

## Question

Завести реестр ников и его синк из чата VOD.

- Схема: `content/chatters.toml`, массив `[[chatters]]` с `nick` (канон — display-имя из чата), `login` (ключ дедупа, нижний регистр), опциональным `aliases = []` и опциональным `id` (числовой user id, если источник его даёт); шапка-комментарий как в `content/lots.toml`.
- `scripts/chatters_sync.py` (stdlib, без зависимостей; рядом с `lots_sync.py`): идемпотентно добавляет новые ники из `chat.json` по ключу `id` (если есть) иначе `login`, **никогда не трогает алиасы**; умеет принять готовый JSON и/или `--vod <id>`; рецепт `just chatters-sync`. Не полагаться на `user.lower() == login`.
- Bootstrap: вытащить ники из архивного `chat-2864275043.json` (лежит в git-истории `.scratch/alysque-launch/research/`), исключив стримера `aLySQuE` и ботов (`LYSB0T`, `Bot_91`) — ~172 ника.

Ответ: файл-реестр + скрипт + рецепт; сколько ников заведено и из какого VOD.
