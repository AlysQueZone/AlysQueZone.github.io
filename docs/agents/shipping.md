# Shipping: preview-проверка и релиз

## Preview-проверка (`preview` + `agent-browser`)

`agent-browser` стоит проектным пакетом (`devDependencies`), бинарь — `./node_modules/.bin/agent-browser` (равнозначно `npx agent-browser`). `npm install` тянет только сам CLI: на свежем клоне Chrome докачивается один раз командой `./node_modules/.bin/agent-browser install`, готовность — `doctor --offline --quick`. Цикл: поднять `npm run preview`, затем `export AGENT_BROWSER_SESSION="$(./node_modules/.bin/agent-browser session id --scope worktree --prefix <задача>)"` → `open http://localhost:4321/` → `snapshot -i` → `click/fill @eN` (после каждого изменения страницы заново `snapshot -i`, рефы протухают). В конце `close` + остановить preview. Справочник — в самом CLI (`--help`, `skills get core --full`).

Скиллы (`core`, `dogfood`, …) в репо не копировать: они лежат в пакете и отдаются командой `skills get <имя>` всегда под версию CLI. Для глубокой проверки (поиск багов/UX) грузить `skills get dogfood` по месту. Отдельный скилл с skills.sh не ставим: его `SKILL.md` — заглушка «запусти `skills get core`», а справочник CLI и так отдаётся под версию пакета.

## Релиз

Контент лотов публикуется без деплоя: `just lots-sync` (из `content/lots.toml`) пишет в прод, а сайт читает каталог из БД в рантайме (см. `docs/adr/0002`). Дальше две ступени — они нужны только для изменений кода:

Перед `just release` закрой накопившееся в `CHANGELOG.md`: переименуй `## Внесённые изменения` в датированную секцию (формат — в `AGENTS.md`).

Обе ступени — `just release` (идемпотентно): переключает `gh auth` на аккаунт-владельца `AlysQueZone`, пушит `main`, затем `npm run deploy`, и в конце возвращает прежний активный аккаунт даже при ошибке.

1. Бэкенд: push в `main` — Supabase сам применяет новые миграции. Проверка (агент): подождать ~60с, затем MCP `list_migrations` — все новые версии в списке (сразу после пуша проверять бессмысленно — очередь ещё не отработала). Ошибка — читаем текст, чиним файл неприменённой миграции и пушим снова (очередь встаёт целиком).
2. Сайт: `npm run deploy` (сборка + пуш `dist` в ветку `gh-pages` — GitHub Pages раздаёт именно её, не `main`). Проверка: свежие маркеры на живом сайте.
