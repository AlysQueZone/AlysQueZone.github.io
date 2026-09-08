# Реальные чаттерсы из VOD — research

Источник: VOD `2864275043` «СТРИМ ЗАКОНЧИТСЯ КОГДА Я ДОЧИТАЮ ЧАТ» (опубликован 2026-09-03, длина 12830с ≈ 3.5ч).
Способ: анонимный Twitch GQL `VideoCommentsByOffsetOrCursor` (persisted hash `b70a3591...adf6a`),
пагинация через `contentOffsetSeconds` с дедупом по id (курсорная пагинация упирается в integrity-check).
Сырой чат: `chat-2864275043.json` (компакт `[{t, user, login, text}]`).

Итого: **3662 сообщения, 175 уникальных ников**, покрытие всего VOD (max t=12859, hasNextPage=false).

## Топ-20 ников по числу сообщений

1. LYSB0T — 303 (подозрение на бота: имя *BOT + формальные приветствия; в лоты НЕ взят)
2. spiritbanbanban — 215
3. coolbeback — 198
4. 4Deli — 175
5. Revixit — 155
6. Onghanntto — 134
7. remololpro — 112
8. kvakograk — 106
9. foxindique — 104
10. VandaLQuE — 94
11. VVOULFAN — 91
12. Norrganon — 85
13. PurpleTie — 85
14. Bot_91 — 82 (бот, в лоты НЕ взят)
15. 0mniuss — 75
16. evilzerg57 — 73
17. NXVER_EXISTD — 64
18. feistyman333 — 63
19. ShidouQuE — 62
20. kuri_puri — 59
21. AkseLWalkerQuE — 55 (добор, que-ник)

## Que-топ (ник содержит `que`, case-insensitive)

- foxindique — 104
- VandaLQuE — 94
- ShidouQuE — 62
- AkseLWalkerQuE — 55
- bEnDQuEt — 49
- andRushQuE — 37
- las1que — 22
- aLySQuE — 19 (сама стример, в лоты НЕ берём)
- Denchique_ — 14
- gRiBoCheQuE — 6 (обязательный, удержан)
- imirQuE — 2, YaBoQuE_ — 2, roromQuE — 2, SvandisQuE — 2, HerrKommandantQue — 1

## Топ-10 частых фраз/мемов

1. `yep` — 80
2. `aga` — 72
3. `xdd` — 38
4. `ахахахахха ахахахах увернуля ez erz` — 34 (игровой момент, автор волны — Gedo0)
5. `👍` — 25
6. `италия suda` — 18 / `suda` — 10 (мем стрима)
7. `hiii` — 18 (приветствие чата)
8. `@gedo0 привет спишь?` — 18 / `@gedo0 спишь?` — 9 (мем «спящий Gedo0»; сам Gedo0 пишет «ребят сплю»)
9. `приму в дар квартиру в москве ))` — 15 (копипаста Gedo0)
10. `alysqueclap` — 10+ (эмоут), `привет пепепоп @pepeppop_ agahi` — 14 (привет-паста)

Команды с `!` (`!цитата` и т.п.) из подсчёта выкинуты.

## Смешные сообщения-кандидаты (ник — автор)

- evilzerg57: «Продам свою дружбу за 2 привета!»
- coolbeback: «14 рублей за холст? На это даже один привет не купишь» + «@DonBurbonn дружище, два привета и мы договорились»
- DonBurbonn: «@coolbeback а чьи приветы?»
- Gedo0: «ребят сплю», «приму в дар квартиру в москве ))», «она не догонит чат до офа», «ахахахахха АХАХАХАХ УВЕРНУЛЯ EZ ERZ»
- gRiBoCheQuE: «<- он календарь alysqueNOTED» (x4), «Алиска и чат, я вас всех поздравляю с буквально красным днем календаря...»
- andRushQuE: «Вот бы привет, мне по делу»
- las1que: «скум на привет»
- LYSB0T: «NXVER_EXISTD, от имени всего чата - приветствую Вас!» (в лоты не взят — ботоподозрение)
- lenivet5: «@alysque привет мой самый любимый догоняющий стример»
- sooblonde: «Привет Алискуэ! чет календарь перевернулся, а за арбузом так и не доехали...»

Коллаб-стримеров (`pepelnayaa`, `nyamuras`, `justdavidcool`, `Guit88man`, `bradhi`) в чате VOD нет
(по 0 сообщений) — в лоты не попали естественным образом. Упоминаний «андрюш/андреи» в этом VOD нет —
мем «Андрюша №37» взят из лора (тикет 02) как обязательный.

## Черновики лотов (схема тикета 04: id/title/owner/price/rarity/history/meme)

Цены по шкале 04: обычные 100–500, редкие 600–1200. ЛУК не тронут (уже есть в 04 как legendary).

1. id `lot-gedo-sleepy`, title «Спящий привет от Gedo0», owner `Gedo0`, price 250, rarity common,
   history [{from `spiritbanbanban`, to `Gedo0`, price 200}], meme «@gedo0 привет спишь? / ребят сплю»
2. id `lot-gedo-uvernulya`, title «Привет, который увернулся», owner `Gedo0`, price 300, rarity common,
   history [{from `kuri_puri`, to `Gedo0`, price 250}], meme «ахахахахха ахахахах увернуля ez erz»
3. id `lot-gedo-flat`, title «Квартира в Москве (приму в дар)», owner `Gedo0`, price 800, rarity rare,
   history [{from `Gedo0`, to `coolbeback`, price 700}], meme «приму в дар квартиру в москве ))»
4. id `lot-evil-friendship`, title «Дружба за 2 привета», owner `evilzerg57`, price 400, rarity common,
   history [{from `DonBurbonn`, to `evilzerg57`, price 350}], meme «Продам свою дружбу за 2 привета!»
5. id `lot-cool-holst`, title «Привет, который не купишь за 14 рублей», owner `coolbeback`, price 350, rarity common,
   history [{from `4Deli`, to `coolbeback`, price 300}], meme «14 рублей за холст? На это даже один привет не купишь»
6. id `lot-gribo-calendar`, title «Календарный привет», owner `gRiBoCheQuE`, price 300, rarity common,
   history [{from `kuri_puri`, to `gRiBoCheQuE`, price 250}], meme «он календарь alysqueNOTED»
7. id `lot-vandal-privet`, title «Привет онлайновсеие чуваки», owner `VandaLQuE`, price 600, rarity rare,
   history [{from `Revixit`, to `VandaLQuE`, price 500}], meme «Привет онлайновсеие чуваки»
8. id `lot-rush-podelu`, title «Привет мне по делу», owner `andRushQuE`, price 200, rarity common,
   history [{from `las1que`, to `andRushQuE`, price 150}], meme «Вот бы привет, мне по делу»
9. id `lot-las-skum`, title «Скум на привет», owner `las1que`, price 150, rarity common,
   history [{from `andRushQuE`, to `las1que`, price 100}], meme «скум на привет»
10. id `lot-andrew-37`, title «Привет от Андрюши №37», owner `Андрюша №37`, price 100, rarity common,
    history [{from `Андрюша №36`, to `Андрюша №37`, price 50}], meme «МНОГОУВАЖАЕМЫЕ АНДРЕИ... ПЕРЕИМЕННОВЫВАЮ ВАС В АНДРЮШ» (лор тикета 02)
