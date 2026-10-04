# Preview-проверка (гейт перед релизом)

## Цикл (`preview` + `agent-browser`)

`agent-browser` стоит проектным пакетом (`devDependencies`), бинарь — `./node_modules/.bin/agent-browser` (равнозначно `npx agent-browser`). `npm install` тянет только сам CLI: на свежем клоне Chrome докачивается один раз командой `./node_modules/.bin/agent-browser install`, готовность — `doctor --offline --quick`. Цикл: поднять `npm run preview`, затем `export AGENT_BROWSER_SESSION="$(./node_modules/.bin/agent-browser session id --scope worktree --prefix <задача>)"` → `open http://localhost:4321/` → `snapshot -i` → `click/fill @eN` (после каждого изменения страницы заново `snapshot -i`, рефы протухают). В конце `close` + остановить preview. Справочник — в самом CLI (`--help`, `skills get core --full`).

Скиллы (`core`, `dogfood`, …) в репо не копировать: они лежат в пакете и отдаются командой `skills get <имя>` всегда под версию CLI. Для глубокой проверки (поиск багов/UX) грузить `skills get dogfood` по месту. Отдельный скилл с skills.sh не ставим: его `SKILL.md` — заглушка «запусти `skills get core`», а справочник CLI и так отдаётся под версию пакета.

## Релиз

Контент лотов публикуется без деплоя: `just lots-sync` (из `content/lots.toml`); сайт читает каталог из БД в рантайме (`docs/adr/0002`).

Изменения кода — обе ступени `just release`; процедура и проверки — в скилле `alysque-release`.
