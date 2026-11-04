# Preview-проверка (гейт перед релизом)

## Цикл (`just preview` + `agent-browser`)

`agent-browser` — системная программа (пакетом в проекте не стоит), нужна версия 0.41+ и браузер: на этой машине CLI сам находит `/usr/bin/chromium`. Готовность — `agent-browser doctor --offline --quick`. Цикл: поднять `just preview` (фиксированный `4321`; чужой сервер на порту — ошибка с PID, а не тихий уход на `4322`), затем `export AGENT_BROWSER_SESSION="$(agent-browser session id --scope worktree --prefix <задача>)"` → `open http://localhost:4321/` → `snapshot -i` → `click/fill @eN` (после каждого изменения страницы заново `snapshot -i`, рефы протухают). В конце `close` + `just preview-stop`. Справочник — в самом CLI (`--help`, `skills get core --full`).

Готово, когда: браузер закрыт, `just preview-stop` выполнен.

## Состояния и ошибки

Ошибку чтения БД имитируй обрывом REST-запроса, а не офлайном: `agent-browser network route '*purchases*' --abort` → `reload` → подождать ~2 с → проверить состояние ошибки; после `network unroute` и «Обновить» — восстановление. `set offline on` режет и сам статический сайт, поэтому селекторов на странице не остаётся.

`agent-browser is visible <sel>` падает, если узла нет; наличие и скрытость проверяй через `eval` (например, `classList.contains('hidden')`).

Скиллы (`core`, `dogfood`, …) в репо не копировать: они лежат в пакете и отдаются командой `skills get <имя>` всегда под версию CLI. Для глубокой проверки (поиск багов/UX) грузить `skills get dogfood` по месту. Отдельный скилл с skills.sh не ставим: его `SKILL.md` — заглушка «запусти `skills get core`», а справочник CLI и так отдаётся под версию пакета.

## Залогиненная проверка (колокол, гамба, покупка)

Preview и живой сайт ходят в прод гостем — залогиненные экраны проверяются на локальном стеке:

1. `just run-local` — локальный Supabase и `astro dev` на `http://localhost:4321`.
2. `just dev-auth` — создаёт dev-продавца `dev-seller@alysque.local` и dev-покупателя, фикстуру «перекупа» и пишет сессию продавца в `/tmp/alysque-dev-session.json`; печатает ключ localStorage и готовую команду.
3. В `agent-browser`: `open http://localhost:4321/` → `storage local set <ключ> "$(cat /tmp/alysque-dev-session.json)"` → `reload`. В шапке — ник, баланс и колокол с непрочитанным; в панели — запись «перекупа» и кнопка с ценой. Первый вход открывает окно ежедневного входа — закрыть его, иначе оно перекрывает колокол.
4. `agent-browser close`; остановить — `just stop` (dev, preview и локальный Supabase) или по отдельности `just dev-stop`, `just db-stop`.

`just db-reset` стирает и юзеров, и фикстуру — повторить `just dev-auth`.

### Живой перекуп (колокол и всплывающее уведомление)

`dev-auth` создаёт фикстуру в БД, но не событие «здесь и сейчас»: для него лот должен быть своим в снапшоте страницы **до** покупки.

1. Войти продавцом по шагам выше и открыть `/deals/`.
2. `just dev-outbid-prepare` — лот снова у продавца. **Перезагрузи страницу**: «Мои приветы» читаются при загрузке (ADR 0012), иначе снапшот не увидит лот своим.
3. `just dev-outbid-buy &` — покупка придёт событием. Ждать уведомление: `agent-browser wait --fn "!!document.getElementById('notice-corner')"`, затем `snapshot -i` и клик «Забрать». Окошко закрывается само, hover удерживает; поллить `eval` в цикле не нужно.
4. Панель при открытии пишет метку `alysque:outbid-seen:<uid>`, поэтому после перезагрузки история не восстанавливается. Для повторной проверки панели сбрось ключ в localStorage.

## Релиз

Контент лотов публикуется без деплоя: новый лот — `just lot-add <файл|URL>` (тройка, Storage, карточка, сид и синк), правки манифеста — `just lots-sync` (из `content/lots.toml`); сайт читает каталог из БД в рантайме (`docs/adr/0002-market-client-projection.md`).

Изменения кода — обе ступени `just release`; процедура и проверки — в скилле `alysque-release`.
