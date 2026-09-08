Status: resolved

## Task

Редепплой фона F1 (37): подтянуть main, `npm run build` (обязан проходить, 23 страницы), `npm run deploy`, подождать публикацию, `curl -sI` главной + биржи (200) + spot-check (webp фона в прод-HTML, ассет 200). Кода не править (при красном build — блокер в тикет, не резолвить).

## Acceptance

- Прод отвечает 200 со свежим билдом (фон-арт на месте).

## Done

- Прод: https://alysquezone.github.io/
- Build: 23 страницы, OK. Deploy: Published.
- `curl -sI /` → 200, `curl -sI /lots/` → 200 (last-modified свежий).
- Spot-check: прод-HTML содержит `/bg/sunflowers.webp`, ассет → 200 image/webp.
