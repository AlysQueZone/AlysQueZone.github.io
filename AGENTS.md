# AlysQueZone

Шуточная биржа приветов Twitch-канала alysque. Запуск — README.md.

- Коммить сам, когда изменение готово; новые решения — краткой строкой сюда.
- README — простая инструкция для человека, без подробностей.
- Гейт красный — деплоя нет: `npm run build` + клик сборки в `preview`.
- Бэкенд — в Supabase, схему — только миграциями; контент лотов — `content/lots.toml` + `just lots-sync` (не миграциями).
- Витрина и страницы лотов — клиентская проекция БД (`docs/adr/0002`): контент публикует `just lots-sync` без деплоя; билд без запроса к БД, но требует `PUBLIC_SUPABASE_*`.
- Математика биржи — из одних рук: меняешь механику — обнови витрину и `CONTEXT.md`.

## Указатели

- Preview-клик / релиз (`gh-pages`, миграции в `main`) → `docs/agents/shipping.md`.
- Supabase-схема / RLS / миграции / отладка → `docs/agents/supabase.md`.
- Стиль / импорты / рендер / SQL-гайд / `just` → `docs/agents/code-style.md`.
- Гамба-звуки / комиссия / рост цены → `docs/agents/economy.md`.
- Эмоуты / чат VOD / мемы / пасты / стата → `docs/agents/twitch-sources.md`.
- Ники чатерсов / реестр / резолв написания → `docs/agents/chatters.md`.
- Новый лот / `ffmpeg` / `media` / `content/lots.toml` → `docs/agents/media-pipeline.md`.
- Issues-трекинг (`scratch/`) → `docs/agents/issue-tracker.md`.
- Триаж-лейблы (`needs-triage` … `wontfix`) → `docs/agents/triage-labels.md`.
- Термины / глоссарий / ADR-конфликт → `docs/agents/domain.md` (`CONTEXT.md` + `docs/adr/`).
