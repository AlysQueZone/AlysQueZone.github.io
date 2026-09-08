Status: resolved

## Task

Редепплой после 15/16/17/18 (светлая тема, эмоуты+звук, мем-лоты, кнопка-обманка). Шаги: подтянуть main, `npm run build` (обязан проходить, 17 страниц), `npm run deploy` (пуш `gh-pages`), подождать публикацию, `curl -sI` главной + биржи + одной мем-карточки (200), spot-check содержимого (светлые токены, CLAP, m1-звук/постер). Кода не править (при красном build — блокер в тикет, не резолвить).

## Acceptance

- Прод-URL отвечает 200, светлая тема и новые лоты/звуки на проде.

## Done

Прод-URL (на тот момент): project-pages сайт.
Дата: 2026-09-04. main подтянут (already up to date).

- `npm run build`: OK, 17 страниц.
- `npm run deploy`: Published (gh-pages).
- `curl -sI`: `/` → 200, `/lots/` → 200, `/lots/lot-meme-mass/` → 200 (last-modified свежий, совпадает с деплоем).
- Spot-check содержимого:
  - светлые токены в прод-CSS (`_astro/BaseLayout.Cm_imm_Q.css`): `fff3e6` (cream void), `fffefa` (panel), `ff4d6d` (melon), `ff00bc` (blush) — есть;
  - CLAP: `clap.mp3` референс на главной + ассет `/sounds/clap.mp3` → 200;
  - m1-карточка (`/lots/lot-meme-nyachos/` → 200): `sounds/m1-nyachos.mp3` и `memes/m1.jpg` в HTML, оба ассета → 200.
- Кода не правил. `AGENTS.md` не трогал.
