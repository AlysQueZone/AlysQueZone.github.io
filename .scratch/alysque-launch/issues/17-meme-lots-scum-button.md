Status: resolved
Type: task
Blocked by: 15, 16

## Question (build, implement-skill)

Мем-лоты из видео MemeAlerts + фейковая кнопка «получить еще пивкойнов».

## Факты разведки (проверены 2026-09-04)

4 прямых линка `.../alert_orig.webm` (vp9+opus, ~9–10с, 284–768КБ) — качаются обычным curl, ffmpeg есть:
- m1 `https://cdns.memealerts.com/p/66961426e904cc2377372321/a24b3e2f-5f63-42bc-b40a-346eb305464d/alert_orig.webm` — в кадре чат `@nyanyachos`, пишет `bEnDQuEt`. Лот rare 1200: id `lot-meme-nyachos`, title «Здраствуйте, nyanyachos», owner `bEnDQuEt`, history [{from `las1que`, to `bEnDQuEt`, price 900}], meme «@nyanyachos».
- m2 `https://cdns.memealerts.com/p/672ba6a81135f4340a61a4d0/6e47bcfc-453d-47da-8b6f-958c2a25bc4a/alert_orig.webm` — чиби-аватарка машет, привет сразу нескольким. Лот rare 700: id `lot-meme-optom`, title «Привет сразу всем (оптом)», owner `foxindique`, history [{from `VandaLQuE`, to `foxindique`, price 500}], meme «оптовый привет».
- m3 `https://cdns.memealerts.com/p/64f8378906d68898c5b8e508/2d11fea1-bda2-493a-9774-510e15c6a589/alert_orig.webm` — четыре кота смотрят на руку. Лот rare 800: id `lot-meme-mass`, title «Массовый привет (коты одобряют)», owner `coolbeback`, history [{from `4Deli`, to `coolbeback`, price 600}], meme «массовый привет».
- m4 `https://cdns.memealerts.com/p/67703e376aca378b12d6202f/d7d3f098-37b5-46cd-84fb-17837401f737/alert_orig.webm` — зайка-аватарка, звук для кнопки-обманки.
- Решение человека: аудио-файлы коммитим (надежнее ленивого видео, нет CORS-рисков). Извлечение: `ffmpeg -i in.webm -vn -codec:a libmp3lame -q:a 5 out.mp3` (~85–145КБ каждый). Постеры: `ffmpeg -ss <mid> -i in.webm -frames:v 1 poster.jpg` (m1 ~29КБ, m2/m3 ~6–16КБ).

## Scope (строго)

- Скачать 4 webm в /tmp, извлечь mp3 → `public/sounds/m1-nyachos.mp3`, `m2-optom.mp3`, `m3-mass.mp3`, `m4-scum.mp3`; постеры m1–m3 → `public/memes/m1.jpg` и т.д. (m4 постер не нужен).
- `data/lots.json`: дописать 3 лота выше + опциональные поля `audio` (путь) и `poster` (путь). Существующие 11 не менять. Схему в `lots.ts` дополнить опциональными полями при нужде (без ломки).
- `LotCard`: МИНИМУМ — показать постер если есть + кнопка «слушать» (audio). Эмоут-рендер тикета 16 не ломать.
- Покупка мем-лота играет его `audio` вместо `clap.mp3` (минимальная правка скрипта покупки, логику 16 не ломать).
- Фейковая кнопка «Получить еще пивкойнов» в шапке (BaseLayout готов после 15): клик → играет `m4-scum.mp3` → модалка/тост «Упс, вас обманули! Пивкойны так не добываются 😏», баланс НЕ меняется.
- НЕ трогать: тему, конфиги, остальные страницы, чужие тикеты.

## Acceptance

- `npm run build` проходит; 17 роутов (14 + 3 новых лота); mp3/jpg закоммичены и играют/показываются; кнопка-обманка не начисляет баланс.

## Done

- Медиа: 4 mp3 в `public/sounds/` (m1-nyachos 143КБ, m2-optom 86КБ, m3-mass 86КБ, m4-scum 85КБ), 3 постера в `public/memes/` (m1 29КБ, m2 6КБ, m3 16КБ). Извлечено ffmpeg из 4 webm по команде из тикета.
- `data/lots.json`: +3 rare-лота (nyachos 1200 / optom 700 / mass 800) с `audio`/`poster`; 11 старых без изменений. `lots.ts`: опциональные `audio?`/`poster?`.
- `LotCard`: постер + кнопка «▶ слушать» (play/stop-тоггл, обработчик в BaseLayout); эмоуты не тронуты. Та же связка минимально показана на странице `[id]`.
- Покупка мем-лота играет его `audio` вместо clap (`pending.audio`, `playClap(audio)`), graceful-fallback сохранён.
- Шапка (`BaseLayout`): кнопка «Получить еще пивкойнов» → `m4-scum.mp3` → модалка «Упс, вас обманули! Пивкойны так не добываются 😏». Баланс не трогается (wallet.spend не вызывается).
- `npm run build`: 17 страниц OK. Self-review по dist: постеры/listen/audio-атрибуты на бирже и карточке, scum-кнопка на всех страницах, история nyachos (las1que→bEnDQuEt 900) на месте.
