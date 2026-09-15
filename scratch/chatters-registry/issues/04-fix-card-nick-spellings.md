# Сверка и починка написания ников в карточках

Status: open
Type: grilling
Blocked by: 05

## Question

Сверить написание ников в `content/lots.toml` с реестром и починить.

Часть названий — кириллические догадки автора, потому что канон ника был неизвестен: «Привет Аврора», «Доброе утро Монах», «Привет для Салата», «Привет Evilzeg», «Привет для remolol», «Привет для Quevizar», «Здраствуйте, nyanyachos», «Грубый привет от Брадхи», «Привет Axel» и т.п.

Для каждого лота — найти канон в реестре и обновить `title`; отдельно решить, что делать с теми, кого в чате нет (напр. `bradhi` — коллаб-стример, не чатерс).

Ответ: обновлённые `title` + решение по не-чаттерсам (что уходит в «Out of scope» / «Not yet specified»).

## Comments

- 2026-09-15 (grilling): сверили все карточки с реестром.
  - Канон в `title` — ровно как в реестре (строчные ники остаются строчными).
  - `lot-meme-pokupayu-avroru` («Покупаю аврору») — мем, не трогаем.
  - Не найденные ники (`arhion24`, `nexizzzz`, `Quevizar`, `Монах`, `Салат`, `Axel`) не трогаем — ждём догрузку VOD.
  - `Брадха` (= `bradhi`, коллаб-стример) — канон неизвестен, тоже ждём 05.
  - Алиасы добавлены в реестр: `avrora_666` ← «аврора», `evilzerg57` ← «evilzeg», `remololpro` ← «remolol», `VandaLQuE` ← «VandalQuE».
- Тикет ждёт [Догрузить реестр со свежих VOD](05-more-vods.md): после неё неизвестные ники могут зарезолвиться.
- Готовые правки (применить после 05): `lot-meme-avrora` → `avrora_666`; `lot-meme-evilzeg` → `evilzerg57`; `lot-meme-remolol` → `remololpro`; `lot-privet-coolbeback` → `coolbeback`; `lot-privet-evilzerg57-double` → `evilzerg57`; `lot-privet-olyacaramel` → `olyacaramel`; `lot-privet-sooblonde` → `sooblonde`; `lot-privet-spirit` → `spiritbanbanban`; `lot-privet-vandalque` → `VandaLQuE`.
- 2026-09-15, после догрузки VOD (тикет 05): нашлись каноны — `CaJIaToB` = «Салат», `77moHax777` = «Монах», `INexizI` = `nexizzzz`, `Bradhi` = «Брадха», `arhion24` (title уже канон). Алиасы `Салат`/`Монах`/`nexizzzz` добавлены.
- Не подтверждено: `quevizariks` = «Quevizar»? — уточнить у человека. `Axel` не найден ни в одном из 8 VOD.
