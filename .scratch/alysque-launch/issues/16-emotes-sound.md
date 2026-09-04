Status: resolved
Type: task
Blocked by: none

## Question (build, implement-skill)

Эмоуты и звук покупки (решения Q1A/Q2/Q4): alysqueCLAP + 7TV-эмоуты канала + звук хлопков при покупке.

## Факты разведки (проверены 2026-09-04, не ищи заново)

- alysqueCLAP — нативный анимированный Twitch-эмоут (gif), хотлинки рабочие:
  light `https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_1075070639054e5d8cacb8a0ef4872d7/default/light/3.0`,
  dark `.../default/dark/3.0` (есть 1.0/2.0/3.0 размеры).
- 7TV-сет канала (895 эмоутов): `curl -s https://7tv.io/v3/users/twitch/224473232` (поле `emote_set.emotes`: `name`, `data.animated`, `id`); картинки `https://cdn.7tv.app/emote/<id>/2x.webp` (хотлинк работает). Хлопалки: PogClap `01F6NJQCBG000898NRWSAVVV08`, catClap `01H9D5QNVR0005XNK7Z4N9D90F`. Остальные подбери сам из сета под мемы лотов (xdd/yep/календарь/квартира...).
- Звук хлопков: `File:Clapping hurray.ogg` (11.6с, 229КБ) — прямая ссылка через API:
  `https://commons.wikimedia.org/w/api.php?action=query&format=json&titles=File:Clapping%20hurray.ogg&prop=imageinfo&iiprop=url`
  (поле `imageinfo[0].url`). Обрежь ffmpeg до первых ~2с и сконвертируй в mp3 (Safari не играет ogg).

## Scope (строго)

- Новый `src/lib/emotes.ts`: маппинг lot.id → URL 7TV-эмоута (+ константы ALYSQUE_CLAP light/dark). `data/lots.json` НЕ трогать (его дополняет тикет 17).
- `src/components/LotCard.astro`: картинка-эмоут в карточке (минимум верстки, без рестайла).
- `src/components/BuyModal.astro` (или скрипт покупки): alysqueCLAP-gif в модалку + тост покупки; воспроизведение `public/sounds/clap.mp3` при успешной покупке (клик = автоплей ок; graceful-fallback если файла нет).
- НЕ трогать: `src/styles/**`, `src/layouts/**`, `src/pages/**`, `src/lib/wallet.ts`, `src/lib/confetti.ts`, конфиги, чужие тикеты.

## Acceptance

- `npm run build` проходит; `public/sounds/clap.mp3` закоммичен (маленький); в `dist` есть ссылки на эмоуты; покупка играет звук + показывает CLAP.

## Done

- `src/lib/emotes.ts` (новый): `ALYSQUE_CLAP_LIGHT/DARK`, `POG_CLAP_ID`/`CAT_CLAP_ID`, `LOT_EMOTES` — маппинг всех 11 lot.id → `cdn.7tv.app/emote/<id>/2x.webp` (ID сверены с сетом канала 2026-09-04: peepoSleep, peepoWeirdLeave, peepoRich, peepoFriendship, Pivo, GoodMorning, hiHelloHi:), PauseChamp, SCAMBA, xdd, PogClap для ЛУКа).
- `public/sounds/clap.mp3` (новый, 24КБ): `Clapping hurray.ogg` с Wikimedia Commons, ffmpeg `-t 2` + mp3 96k.
- `LotCard.astro`: `<img>` 7TV-эмоута под заголовком (56px, lazy, без рестайла).
- `BuyModal.astro`: alysqueCLAP (dark/3.0) в шапке модалки; тост успеха с CLAP-картинкой (28px); `playClap()` через `new Audio(data-clap-sound)` с try/catch + `.catch()` fallback.
- Проверка: изолированный билд на HEAD + только свои файлы — `npm run build` OK (14 страниц), в `dist/lots/index.html` 11 уникальных 7TV-URL, CLAP-URL в модалке и JS-бандле, `dist/sounds/clap.mp3` на месте.
- Замечание: билд в общем рабочем дереве сейчас роняет параллельный агент темы (лишний `</div>` в `src/layouts/BaseLayout.astro:36-37`, не мой скоуп — не трогал).
