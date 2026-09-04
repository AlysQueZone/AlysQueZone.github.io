Status: resolved

## Task

4 новых мем-лота «также как предыдущие» (rare, с audio + poster, покупка играет их звук).

## Факты разведки (проверены 2026-09-04, владельцы сверены с архивом чата VOD 2864275043)

Прямые webm (vp9+opus, ~7с, 208–248КБ) качаются curl; звук `ffmpeg -i in.webm -vn -codec:a libmp3lame -q:a 5 out.mp3` (~30–70КБ); постер `ffmpeg -ss 3.5 -i in.webm -frames:v 1 poster.jpg`:

1. `lot-meme-repeat`, «Второй повторный привет», owner `ShidouQuE`, price 650, rare,
   history [{from `AkseLWalkerQuE`, to `ShidouQuE`, price 500}], meme «повторный привет»,
   webm `https://cdns.memealerts.com/p/672ba6a81135f4340a61a4d0/debfc8c4-16a3-45b0-89ed-9b81f92100e6/alert_orig.webm`,
   файлы `public/sounds/n1-repeat.mp3`, `public/memes/n1.jpg`.
2. `lot-meme-remolol`, «Привет для remolol», owner `remololpro` (топ-7 чата, 112 сообщений — настоящий), price 750, rare,
   history [{from `spiritbanbanban`, to `remololpro`, price 600}], meme «привет для remolol»,
   webm `https://cdns.memealerts.com/p/66961426e904cc2377372321/0acec35f-0179-466e-a2ca-7995d46328ea/alert_orig.webm`,
   файлы `public/sounds/n2-remolol.mp3`, `public/memes/n2.jpg`.
3. `lot-meme-salat`, «Привет для Салата», owner `spiritbanbanban` (топа чата; «Салата» как ника в чате нет — лот-обращение), price 750, rare,
   history [{from `coolbeback`, to `spiritbanbanban`, price 600}], meme «привет для Салата»,
   webm `https://cdns.memealerts.com/p/672ba6a81135f4340a61a4d0/fe6b3373-284a-438a-b6f7-041394b31c77/alert_orig.webm`,
   файлы `public/sounds/n3-salat.mp3`, `public/memes/n3.jpg`.
4. `lot-meme-quevizar`, «Привет для Quevizar», owner `foxindique` (que-топ, 104 сообщения; точного ника Quevizar в чате нет), price 850, rare,
   history [{from `VandaLQuE`, to `foxindique`, price 700}], meme «привет для Quevizar»,
   webm `https://cdns.memealerts.com/p/649b210acfd0d2a8f427e00f/5d46287f-92a9-4897-a7cb-dbd4449e8d15/alert_orig.webm`,
   файлы `public/sounds/n4-quevizar.mp3`, `public/memes/n4.jpg`.

## Scope (строго)

- Скачать/извлечь/закоммитить 4 mp3 + 3 постера (n4 постер не нужен? нужен — у всех 4 есть кадры; клади n4.jpg тоже).
- `data/lots.json`: дописать 4 лота (существующие 14 не менять). `emotes.ts`: добавить маппинг для новых id (подбери из 7TV-сета сам).
- Постер/«слушать»/звук-покупки уже поддержаны кодом тикета 17 — переиспользовать, не ломать.
- НЕ трогать: тему, шапку/кнопку-обманку (тикет 22), `wallet.ts`, конфиги, деплой, чужие тикеты.

## Acceptance

- `npm run build` проходит, 21 роут (17 + 4); новые лоты с постерами/звуком; сортировка (rare по убыванию) сама подхватит их через lots.ts.

## Done

- Скачаны 4 webm (~208–249КБ, 7.006с), извлечены `public/sounds/n1-repeat.mp3` (71КБ), `n2-remolol.mp3` (32КБ), `n3-salat.mp3` (59КБ), `n4-quevizar.mp3` (40КБ) + постеры `public/memes/n1..n4.jpg` (кадр на 3.5с).
- `data/lots.json`: дописаны 4 лота (lot-meme-repeat 650, lot-meme-remolol 750, lot-meme-salat 750, lot-meme-quevizar 850; существующие 14 не тронуты).
- `src/lib/emotes.ts`: +4 маппинга на проверенные ID хлопалок канала (POG_CLAP_ID/CAT_CLAP_ID, без новой разведки).
- `npm run build`: OK, 21 page(s); dist содержит sounds/n*.mp3 + memes/n*.jpg, карточки и страницы лотов ссылаются на них.
