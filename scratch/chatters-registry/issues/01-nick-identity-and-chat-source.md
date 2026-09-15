# Идентичность ника и актуальный способ скачать чат VOD

Status: resolved
Type: research
Blocked by: none

## Question

Как надёжно определить «оригинал» ника при синке из чата VOD?

- В сообщениях чата есть `user` (display, напр. `ShidouQuE`) и `login` (напр. `shidouque`) — какое поле считать каноном в реестре и по какому ключу дедупить идемпотентно?
- Что происходит при переименовании чатерса: меняется ли `login`, может ли один `login` встречаться с разным `user` в рамках VOD.
- Актуален ли на 2026 способ скачать чат VOD из `docs/agents/twitch-sources.md` (`TwitchDownloaderCLI chatdownload` / анонимный GQL `VideoCommentsByOffsetOrCursor`), и какого формата `chat.json` читать скрипту (в т.ч. для `--vod <id>`-режима).

Ответ: выбранный ключ дедупа + поля, которые скрипт читает из чата, + подтверждённый способ получить `chat.json` сейчас.

## Answer

Разбор: [`research/nick-identity.md`](../research/nick-identity.md).

- **`nick` (канон) — display-имя** (`user` / `commenter.display_name`): «красивое» написание с регистром.
- **Ключ дедупа — `login` в нижнем регистре** (`login` / `commenter.name`); по-настоящему неизменяемый ключ — числовой `commenter._id`, если он есть в источнике. `user` как ключ использовать нельзя: display меняют свободно и он не обязан быть case-вариантом логина.
- Локальный компакт-дамп (VOD `2864275043`, 3662 сообщения): 175 уникальных `user` и `login`, `user.lower() == login` во всех, биекция 1:1 — дедуп по `login` корректен для этого VOD.
- Оба способа скачивания на 2026 рабочие: `TwitchDownloaderCLI` (1.56.5, рекомендован) и анонимный GQL `VideoCommentsByOffsetOrCursor` (пагинация по `contentOffsetSeconds` + дедуп по id; хеш живой, но хрупкий: integrity-check на курсоре, ротация хеша, лимит на IP, sub-only VOD отдаёт пустоту).
- Форма нативного `chat.json`: `comments[].{commenter.display_name, commenter.name, commenter._id, content_offset_seconds}`, `video.id`, `streamer.id`.
