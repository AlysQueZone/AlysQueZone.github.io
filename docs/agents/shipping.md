# Preview-проверка (гейт перед релизом)

## Цикл (`preview` + `agent-browser`)

`agent-browser` — системная программа (пакетом в проекте не стоит), нужна версия 0.41+ и браузер: на этой машине CLI сам находит `/usr/bin/chromium`. Готовность — `agent-browser doctor --offline --quick`. Цикл: поднять `pnpm preview`, затем `export AGENT_BROWSER_SESSION="$(agent-browser session id --scope worktree --prefix <задача>)"` → `open http://localhost:4321/` → `snapshot -i` → `click/fill @eN` (после каждого изменения страницы заново `snapshot -i`, рефы протухают). В конце `close` + остановить preview. Справочник — в самом CLI (`--help`, `skills get core --full`).

Скиллы (`core`, `dogfood`, …) в репо не копировать: они лежат в пакете и отдаются командой `skills get <имя>` всегда под версию CLI. Для глубокой проверки (поиск багов/UX) грузить `skills get dogfood` по месту. Отдельный скилл с skills.sh не ставим: его `SKILL.md` — заглушка «запусти `skills get core`», а справочник CLI и так отдаётся под версию пакета.

## Релиз

Контент лотов публикуется без деплоя: новый лот — `just lot-add <файл|URL>` (тройка, Storage, карточка, сид и синк), правки манифеста — `just lots-sync` (из `content/lots.toml`); сайт читает каталог из БД в рантайме (`docs/adr/0002`).

Изменения кода — обе ступени `just release`; процедура и проверки — в скилле `alysque-release`.
