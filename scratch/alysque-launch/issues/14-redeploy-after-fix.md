Status: resolved

## Task

Редепплой после фикса 13 (инлайн-скрипт карточек теперь модуль). Шаги: подтянуть main, `npm run build` (обязан проходить), `npm run deploy` (пуш `gh-pages`), подождать публикацию, `curl -sI` главной + одной карточки (200), убедиться что в продовой карточке нет немодульного инлайн-`import`. Заодно запушить код: `git push -u origin main` (репо-origin создан в 12, main туда не пушился).

## Acceptance

- Прод-URL отвечает 200, карточка без SyntaxError-источника, main запушен в origin.

## Done

- `npm run build` — проходит (14 страниц).
- `npm run deploy` — Published, gh-pages обновлён.
- Прод (на тот момент project-pages) — главная 200, карточка `/lots/lot-gedo-sleepy/` 200 (last-modified свежий, совпадает с деплоем).
- Продовая карточка: все 3 `<script>` — `type="module"`, немодульных инлайн-`import` нет (0), хеши совпадают с локальным `dist`.
- `git push -u origin main` — выполнен, main впервые запушен в origin.
