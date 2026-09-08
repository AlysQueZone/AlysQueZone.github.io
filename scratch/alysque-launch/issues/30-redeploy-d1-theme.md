Status: resolved

## Task

Редепплой D1-темы (29) + фавикон: подтянуть main, `npm run build` (обязан проходить, 21 страница), `npm run deploy`, подождать публикацию, `curl -sI` главной + биржи (200) + spot-check (токены `fff6bf`/`ffe6ac`/`c2187b` в прод-CSS, ни одного `9146ff`). Кода не править (при красном build — блокер в тикет, не резолвить).

## Acceptance

- Прод отвечает 200 со свежим билдом без фиолетового.

## Done

- Прод: https://alysquezone.github.io/
- Build: 21 страница, OK. Deploy: Published.
- `curl -sI`: главная 200, `/lots/` 200.
- Spot-check прод-CSS (`/_astro/BaseLayout.BToyCoKF.css`, хеш совпадает с локальным `dist/`): `fff6bf`/`ffe6ac`/`c2187b` присутствуют, `9146ff` отсутствует.
