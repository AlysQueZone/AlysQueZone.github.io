Status: resolved

## Task

Редепплой после фикса тоста (24): подтянуть main, `npm run build` (обязан проходить, 21 страница), `npm run deploy`, подождать публикацию, `curl -sI` главной + биржи (200). Кода не править (при красном build — блокер в тикет, не резолвить). `AGENTS.md` и другие файлы не трогать.

## Acceptance

- Прод отвечает 200 со свежим билдом.

## Done

- Прод: https://alysquezone.github.io/
- `npm run build`: OK, 21 страница.
- `npm run deploy`: Published (gh-pages).
- `curl -sI /` → 200, `curl -sI /lots/` → 200 (last-modified свежий, совпадает с деплоем).
- Прод-HTML лота содержит фикс тоста из 24 (`bg-panel ... text-milk ... shadow-lg`).
- Кода не правил.
