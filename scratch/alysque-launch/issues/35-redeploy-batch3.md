Status: resolved

## Task

Редепплой мем-лотов batch3 (34): подтянуть main, `npm run build` (обязан проходить, 23 страницы), `npm run deploy`, подождать публикацию, `curl -sI` главной + биржи + одной новой карточки (200) + spot-check (звук/постер новых лотов в прод-HTML). Кода не править (при красном build — блокер в тикет, не резолвить).

## Acceptance

- Прод отвечает 200 со свежим билдом (20 лотов на бирже).

## Done

Прод: https://alysquezone.github.io/
- `npm run build`: ок, 23 страницы.
- `npm run deploy`: Published; `last-modified: Fri, 04 Sep 2026 20:37:43 GMT`.
- `curl -sI`: `/` 200, `/lots/` 200, `/lots/lot-meme-myth/` 200.
- Биржа: 20 лотов (включая lot-meme-myth, lot-meme-evilzeg).
- Spot-check прод-HTML: myth — постер `/memes/r1.jpg` + звук `/sounds/r1-myth.mp3` (data-lot-listen/data-lot-audio); evilzeg — звук `evilzeg.mp3`.
