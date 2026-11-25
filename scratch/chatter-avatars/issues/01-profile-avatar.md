# 01: Аватар в паспорте профиля

**What to build:** у счёта с аватаром Twitch паспорт профиля показывает картинку вместо инициалов; без аватара или при ошибке загрузки — прежние инициалы. Источник — метаданные Supabase Auth, публичный read model отдаёт URL, storage и загрузка не появляются.

**Blocked by:** None (профиль и `public_profile` уже в `main`-линии `feature/chatter-profile`).

**Status:** resolved

- [x] `profiles.avatar_url text` + бэкфилл из `auth.users.raw_user_meta_data` (`avatar_url` → `picture`); тот же триггер, что синкает логин, обновляет картинку при вставке и изменении метаданных, пустые метаданные не затирают старую.
- [x] `public_profile(uid)` возвращает `avatar_url`; новых грантов/политик нет, колонка `profiles` клиентам не открывается.
- [x] Чистое ядро: `ProfileStats.avatarUrl` только `https:` или `null`; тесты на валидный URL, отсутствие, пустую строку, `http:`, мусор и `javascript:`.
- [x] Паспорт: `<img>` в том же квадрате 64×64, `alt=""`, `width`/`height`, `loading="lazy"`, `decoding="async"`, `referrerpolicy="no-referrer"`; инициалы — фолбэк при отсутствии URL и при `error` картинки, без скачка высоты.
- [x] Комментарии и документы: `docs/adr/0014-public-chatter-profile.md` больше не говорит «без аватаров»; шапка модуля профиля описывает фолбэк; `AGENTS.md` — указатель на источник аватара.
- [x] Гейты `just check` зелёные; `pnpm build` не ходит в БД.
- [ ] Проверено на локальном Supabase и в preview: гость/свой/чужой профиль, аватар есть/нет/битый URL, телефон и десктоп.

## Comments

Реализовано: миграция `20261125130000_profiles_avatar.sql` (`profiles.avatar_url`, бэкфилл `avatar_url` → `picture`, тот же триггер синка логина с аватаром без затирания, `avatar_url` в `public_profile`), узкий `private.profile_avatar(uid)` (`security definer`) — колонка `profiles` клиентам не выдана; чистое ядро `cleanAvatarUrl` в `src/lib/profile.ts` (только `https:`, тесты); паспорт — `<img>` поверх инициалов в том же квадрате, инициалы до загрузки, без URL и после `error`, сломанный URL повторно не запрашивается.
Проверено на локальном Supabase: анонимный REST `public_profile` отдаёт `avatar_url`; прямой `select avatar_url` из `profiles` — `42501`; бэкфилл заполнил 1 счёт с метаданными, 42 без — null; смена `raw_user_meta_data.avatar_url` обновила картинку, пустые метаданные её не затёрли, `picture` сработал как фолбэк. Гейты: `tsc`, `lint`, `test`, `format:check`, `build`, `sounds_sync.py check` — зелёные.
Preview (гость/свой/чужой, битый URL, телефон и десктоп) — за оркестратором после мёржа: в этой сессии dev/preview не запускались.
