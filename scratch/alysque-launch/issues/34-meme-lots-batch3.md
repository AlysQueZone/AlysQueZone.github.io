Status: resolved

## Task

2 новых редких мем-лота «также как предыдущие» (rare, audio + poster, покупка играет их звук).

## Факты разведки (проверены 2026-09-04, владельцы из архива чата)

webm качаются curl; звук `ffmpeg -i in.webm -vn -codec:a libmp3lame -q:a 5 out.mp3`; постер `ffmpeg -ss <mid> -i in.webm -frames:v 1 poster.jpg`:

1. `lot-meme-myth`, «Миф о бесплатном пивете» (название дословно от человека), owner `Onghanntto` (топ-6 чата, 134 сообщения, лота еще нет), price 1000, rare,
   history [{from `kvakograk`, to `Onghanntto`, price 800}], meme «миф о бесплатном пивете»,
   webm `https://cdns.memealerts.com/p/649b210acfd0d2a8f427e00f/1870f6b6-c0d7-45c9-b39f-f7c00c5220b7/alert_orig.webm` (9.6с, в кадре лепрекон-шляпа),
   файлы `public/sounds/r1-myth.mp3` (~105КБ), `public/memes/r1.jpg`.
2. `lot-meme-evilzeg`, «Привет Evilzeg», owner `evilzerg57` (чаттерс, 73 сообщения, уже владеет «Дружбой»), price 900, rare,
   history [{from `DonBurbonn`, to `evilzerg57`, price 700}], meme «привет Evilzeg»,
   webm `https://cdns.memealerts.com/p/66961426e904cc2377372321/cdd80a79-9dd9-4a44-a5a7-016de293f8d6/alert_orig.webm` (7с, в кадре ковбойская шляпа),
   файлы `public/sounds/r2-evilzeg.mp3` (~58КБ), `public/memes/r2.jpg`.

## Scope (строго)

Скачать/извлечь/закоммитить 2 mp3 + 2 постера; `data/lots.json` — дописать 2 лота (существующие 18 не менять); `emotes.ts` — добавить 2 маппинга (из 7TV-сета, сам); постер/listen/звук-покупки переиспользовать как есть. НЕ трогать: тему, шапку/гамбу, wallet, конфиги, деплой, чужие тикеты.

## Acceptance

- `npm run build` проходит, 23 роута (21 + 2); новые лоты с постерами/звуком; сортировка подхватит (rare по убыванию).

## Done

- Скачаны 2 webm, извлечены `public/sounds/r1-myth.mp3` (104619 Б), `public/sounds/r2-evilzeg.mp3` (57675 Б), постеры `public/memes/r1.jpg` (512x667), `public/memes/r2.jpg` (352x448).
- `data/lots.json`: дописаны `lot-meme-myth` (1000) и `lot-meme-evilzeg` (900), старые 18 не менялись.
- `src/lib/emotes.ts`: `lot-meme-myth` → PogClap, `lot-meme-evilzeg` → CatClap.
- `npm run build`: 23 page(s) built, новые роуты `/lots/lot-meme-myth`, `/lots/lot-meme-evilzeg` в dist со звуком/постером.
