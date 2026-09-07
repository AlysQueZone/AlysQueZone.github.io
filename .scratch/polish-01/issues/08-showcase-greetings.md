# 08: Витрина и карточка: 🍺 + Мои приветы из БД

Status: done (subagent реализовал: 🍺 + Мои приветы из БД + история из shared, `npm run build` зелёный, коммит eb7dd01)
Blocked by: none
Owns (другие тикеты эти файлы не трогают): `src/components/LotCard.astro`, `src/pages/lots/index.astro`, `src/pages/lots/[id].astro`. `src/lib/wallet.ts` НЕ трогать (только убрать импорты инвентаря/истории в своих файлах, сам файл живёт ради баланса/Гамбы).

## What to build

Спека: `.scratch/polish-01/spec.md` (разделы про монетку и Мои приветы).
Решения: `.scratch/polish-01/issues/02-pivkoin-emoji-fallback.md`, `.../05-my-greetings-from-db.md`, `.../03-ui-wording.md`.

1. `🪙` → `🍺` во всех своих файлах (цены, история).
2. Секция «Мои приветы» (`lots/index.astro`): источник — shared-лоты где `owner_uid == uid` сессии; гость — «Войди через Twitch — тут будут твои приветы»; пусто — «Пока пусто — забери первый привет ниже». Локальный инвентарь не читать, перерисовка — от shared/Realtime, не от `alysque:bought` с локальными данными.
3. Карточка (`lots/[id].astro`): история — из shared (`fetchSharedHistory`), свои записи с бейджем «ТВОЙ»; убрать `getLocalHistory`/`owns` из wallet.
4. Бейдж «ТВОЙ» (`owner_uid == сессия`) — как есть. Тексты без «кулдаун»/«тост»/«передышка».

## Done when

- [ ] «Мои приветы» честно показывают текущее владение (перекупленный пропадает), гость/пусто — тексты.
- [ ] История на карточке — общий хвост, свои с бейджем.
- [ ] `npm run build` зелёный; grep по своим файлам: нет `🪙`/`getLocalHistory`/`owns(` из wallet.
