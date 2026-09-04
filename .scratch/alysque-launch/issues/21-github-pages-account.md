Status: resolved

## Task

Переезд публикации на новый аккаунт `AlysQueZone` с user-pages сайтом `https://alysquezone.github.io/` (решение человека). В `gh` активный аккаунт уже `AlysQueZone` (токен: repo+workflow) — ничего не переключать; второй локальный аккаунт не трогать.

## Факты (проверены 2026-09-04)

- `gh auth status`: active = AlysQueZone (keyring), scopes `gist, read:org, repo, workflow`.
- Текущий origin: SSH-адрес старого репозитория (привязан к другому аккаунту, для нового использовать HTTPS чтобы пошел токен AlysQueZone).
- Сейчас в `astro.config.mjs`: `base: '/AlysQueZone/'` — для user-pages сайта должен стать `'/'`, `site: 'https://alysquezone.github.io'`.

## Scope (строго)

1. `gh repo create AlysQueZone/AlysQueZone.github.io --public` (от имени активного аккаунта; если репо уже существует — переиспользовать).
2. `astro.config.mjs`: `base: '/'`, `site` на новый URL. Больше в коде ничего не менять (ссылки идут через BASE_URL и подхватят сами).
3. `git remote set-url origin https://github.com/AlysQueZone/AlysQueZone.github.io.git`, `git push -u origin main`.
4. Включить Pages при нужде (`gh api repos/AlysQueZone/AlysQueZone.github.io/pages` GET, иначе POST с source `gh-pages`), затем `npm run deploy`.
5. Проверить: `curl -sI https://alysquezone.github.io/` 200 + hero в HTML; подождать публикацию и перепроверить.
6. `spec.md`: обновить 2–3 строки про прод-URL/base (минимум).
- НЕ трогать: лоты, тему, компоненты, звуки, чужие тикеты. Кода страниц не править (при красном build — блокер в тикет, не резолвить).

## Acceptance

- Новый прод отвечает 200, все экраны на месте; main запушен в новый origin.

## Done

- Новый прод-URL: `https://alysquezone.github.io/` (репо `AlysQueZone/AlysQueZone.github.io`, аккаунт `AlysQueZone`, Pages source `gh-pages`, build `built`).
- Проверки (2026-09-04): `GET /` 200 + hero «БИРЖА ПРИВЕТОВ» в HTML; `/lots/` 200; `/lots/luk-legend/` 200; `/nonexistent-xyz/` 404 (кастомная). Первая Pages-сборка зависла в `building` ~8 мин — пересборка через `POST pages/builds` прошла за ~30 сек.
- `astro.config.mjs`: `site: 'https://alysquezone.github.io'`, `base: '/'`. Origin теперь HTTPS нового репозитория.
