# AlysQueZone

Шуточная биржа приветов чата Twitch-канала alysque. Что это и как запустить — в README.md.

## Правила

- Дописывай сюда кратко новые Twitch-источники и решения реализации.
- Коммить сам, когда изменение готово.
- README — простая инструкция для человека, без подробностей.
- Преддеплой-гейт: `npm run build` + покликать сборку в `preview`. Гейт красный — деплоя нет.
- Простые команды(вроде запуска проекта), которые могут пригодится человеку добавляй в `justfile`.

## Преддеплой-проверка (`preview` + `agent-browser`)

Бинарь `./node_modules/.bin/agent-browser`. Цикл: поднять `npm run preview`, затем `export AGENT_BROWSER_SESSION="<задача>"` → `open http://localhost:4321/` → `snapshot -i` → `click/fill @eN` (после каждого изменения страницы заново `snapshot -i`, рефы протухают). В конце `close` + остановить preview. Справочник — в самом CLI (`--help`, `skills get`).
Скиллы (`core`, `dogfood`, …) в репо не копировать: они лежат в пакете и отдаются командой `skills get <имя>` всегда под версию CLI. Для глубокой проверки (поиск багов/UX) грузить `skills get dogfood` по месту.

## Supabase

- Backend-логика — на supabase, не в клиентском коде; skill `supabase` — на схему/RLS/миграции/отладку.
- MCP `supabase` (`opencode.json`) — на все операции: схема, миграции, данные, логи, edge functions.
- Deploy to production ВКЛ: мерж в `main` сам применяет миграции. Схему менять только миграциями; правки из дашборда забирать через `db pull`.

## Решения

- Звуки гамбы — рандом-пулы из `media/sounds/gamba-*` (спин 4 / выигрыш 4 / супер 3 / проигрыш 2, старые + новые равноправны); Тактактакуе — звук кручения, файл исторически `gamba-win-taktak.mp3`; спин — one-shot без лупа `gamba-bg`; источник фраз — MemeAlerts webm → `ffmpeg -vn libmp3lame`.
- Математика биржи в UI — из одних рук: бегущая строка-лог, hero-бейджи, модалка «Правила биржи» показывают живые правила (комиссия биржи, рост цены, гамба, вход). Меняешь механику — обнови все три места и `CONTEXT.md`, иначе витрина врёт (кейс: бейдж «+10%» пережил введение комиссии).

## Указатели (грузить по ветке)

- Эмоуты/чат VOD/мемы/пасты/стата канала → `docs/agents/twitch-sources.md`.
- Новый привет/лот (конверт `ffmpeg`, заливка в `media`, `INSERT INTO lots`) → `docs/agents/media-pipeline.md`.
- Issues-трекинг (файлы в `scratch/`) → `docs/agents/issue-tracker.md`.
- Триаж-лейблы (`needs-triage` … `wontfix`) → `docs/agents/triage-labels.md`.
- Термины/глоссарий/ADR-конфликт → `docs/agents/domain.md` (`CONTEXT.md` + `docs/adr/`).
