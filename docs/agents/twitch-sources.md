# Twitch-источники канала alysque

Канал: <https://www.twitch.tv/alysque> (ID `224473232`, ник `aLySQuE`). Цвет чата `#FF00BC`.

- Аватар/баннер — хотлинкать с `static-cdn.jtvnw.net`, в репо не класть.
- TG с анонсами/мемами: <https://t.me/alysque> (читать через `https://t.me/s/alysque`).
- 7TV-сет (895 эмоутов): `GET https://7tv.io/v3/users/twitch/224473232` (поле `emote_set.emotes`); картинки `https://cdn.7tv.app/emote/<id>/2x.webp` (хотлинк ок).
- Нативный эмоут alysqueCLAP (gif): `https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_1075070639054e5d8cacb8a0ef4872d7/default/light|dark/3.0` (хотлинк ок).
- Все эмоуты разом: `https://emotes.adamcy.pl/v1/channel/alysque/emotes/all` (поле `code`).
- Токены в заголовках лотов (напр. `o7`) фронт рисует 7TV-эмоутом — карта в `src/lib/emotes.ts` (`TITLE_EMOTES`).
- Архив чата VOD: `TwitchDownloaderCLI chatdownload --id <VOD_ID>` либо анонимный Twitch GQL `VideoCommentsByOffsetOrCursor` (хеш `b70a3591...adf6a`, пагинация через `contentOffsetSeconds`); VOD ID — число из `twitch.tv/videos/<id>`, живут 14–60 дней, качать только чат (`chat.json`).
- Мемы: страница <https://memealerts.com/alysque> публичного API не имеет (нужен токен стримера); прямые файлы `https://cdns.memealerts.com/p/.../alert_orig.webm` качаются curl, звук — `ffmpeg -i in.webm -vn -codec:a libmp3lame -q:a 5 out.mp3`.
- Пасты/тон чата: <https://twitchpaste.ru/channels/alysque>. Стата: <https://twitchtracker.com/alysque>.
