# 07: Кулдаун per-lot + честная кнопка (BuyModal + миграция)

Status: done (subagent реализовал: миграция per-(user,lot) + 3 состояния кнопки + переименования, `npm run build` зелёный, коммит 40469e1; живой чек per-lot INSERT — за человеком)
Blocked by: none
Owns (другие тикеты эти файлы не трогают): `src/components/BuyModal.astro`, `src/lib/supabase.ts`, `supabase/migrations/` (только новый файл).

## What to build

Спека: `scratch/polish-01/spec.md` (разделы про кулдаун-сервер/клиент, термины, монетку в BuyModal).
Решения: `scratch/polish-01/issues/04-per-lot-cooldown-button.md`, `.../03-ui-wording.md`, `.../02-pivkoin-emoji-fallback.md`.

1. Новая миграция `supabase/migrations/<timestamp>_per_lot_cooldown.sql`: в `enforce_purchase_rules` кулдаун проверять per-(user,lot) — `buyer_uid = v_uid and lot_id = NEW.lot_id and created_at > now() - 30s`; текст ошибки с секундами (формат как сейчас, `parseCooldownSec` должен парсить). Кап 10/10мин, ЛУК-блок, +10% — без изменений.
2. `src/lib/supabase.ts`: экспортные имена не переименовывать (`subscribeSharedLots`, `getSessionUid`, `buyLotShared`, `mapBuyError` используют другие тикеты); комменты без слов «кулдаун»/«тост»/«передышка» (только «пауза»).
3. `src/components/BuyModal.astro`: кнопка — 3 состояния «Забрать за N 🍺» / «Жди N с» (disabled + живой отсчёт) / «Лимит: 10 покупок за 10 минут» (disabled); таймер — проекция из моей последней покупки этого лота (shared-история, живо по Realtime) + серверная ошибка как правда; чужой выкуп таймер не трогает; `🪙` → `🍺` в этой модалке; переименовать `buy-toast` → `buy-notice`, `showToast` → `showNotice`, `toastTimer` → `noticeTimer`, `cooldownTimer` → `pauseTimer`; тексты уведомлений — «Подожди N с — …», без «кулдаун»/«тост»/«передышка».

## Done when

- [ ] Повтор того же лота < 30с отклонён сервером, другого лота — принят (ручной чек через два INSERT или UI).
- [ ] Кнопка показывает живой отсчёт «Жди N с», кап окна — текст лимита.
- [ ] `npm run build` зелёный; grep по `BuyModal.astro` + `supabase.ts`: нет `🪙`/`тост`/`кулдаун`/`передышка` (комменты тоже).
