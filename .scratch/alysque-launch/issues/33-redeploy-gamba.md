Status: resolved

## Task

Редепплой тоста (31) + гамбы (32): подтянуть main, `npm run build` (обязан проходить, 21 страница), `npm run deploy`, подождать публикацию, `curl -sI` главной + биржи (200) + spot-check (`gamba-` звуки и модалка в прод-HTML). Кода не править (при красном build — блокер в тикет, не резолвить).

## Acceptance

- Прод отвечает 200 со свежим билдом (гамба + крупный тост на месте).

## Done

- Прод: https://alysquezone.github.io/
- `npm run build` — ок, 21 страница. `npm run deploy` — Published.
- `curl -sI`: `/` → 200, `/lots/` → 200, `/lots/lot-rush-podelu/` → 200.
- Spot-check прод-HTML: `#gamba-modal` (`data-bg` gamba-bg.mp3, win1k/win100k), `#gamba-wheel/spin/close/result/title` на месте; `/sounds/gamba-bg.mp3`, `gamba-win1k.mp3`, `gamba-win100k.mp3` → 200. `#buy-toast` (px-8 py-4 text-xl) на месте в прод-лоте.
- Кода не правил.
