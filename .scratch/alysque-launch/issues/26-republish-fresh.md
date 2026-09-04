Status: resolved

## Task

Опубликовать всё заново в свежеу IIT (старый репозиторий удален человеком вручную). Локально: ветка `main`, один чистый коммит `4fbe120` (автор `AlysQueZone`, ноль упоминаний старого аккаунта во всей истории — проверено).

## Scope (строго)

1. `gh repo create AlysQueZone/AlysQueZone.github.io --public` (активный gh-аккаунт — `AlysQueZone`, ничего не переключать).
2. `git push -u origin main`.
3. `npm run deploy` (build обязан проходить; при красном — блокер в тикет, не резолвить).
4. Включить Pages (`gh api .../pages -X POST` с source `gh-pages`, path `/`), default branch → `main` (`gh repo edit ... --default-branch main`), подождать сборку (при зависании `building` — `POST pages/builds`).
5. Проверить: `curl` `/` и `/lots/` → 200, 18 лотов в порядке (ЛУК → rare → common), contributors API — только `AlysQueZone`.
- Кода и истории не править, `AGENTS.md` не трогать, человеку ничего не спрашивать.

## Acceptance

- Прод `https://alysquezone.github.io/` отвечает 200 со свежим билдом; контрибьютор один.

## Done

- Прод: `https://alysquezone.github.io/`
- Репозиторий `AlysQueZone/AlysQueZone.github.io` создан заново (был удалён вручную), `main` (`4fbe120`) запушен, `npm run deploy` — build OK (21 страница), ветка `gh-pages` опубликована.
- Pages: `POST /pages` вернул 409 (уже enabled с source `main`), переключил через `PUT /pages` на source `gh-pages`, path `/`; статус висел `building` ~2 мин — дёрнул `POST /pages/builds` (queued), после этого `built`. Default branch → `main`.
- Проверки:
  - `curl https://alysquezone.github.io/` → 200
  - `curl https://alysquezone.github.io/lots/` → 200, 18 лотов в порядке (сверено побайтово с локальным `dist`: `luk-legend` [legendary] → 9 rare по убыванию цены → 8 common по убыванию цены)
  - contributors API → только `AlysQueZone`
- Кода и истории не правил, коммитов не делал (только push существующего `main` + `gh-pages` от deploy).
