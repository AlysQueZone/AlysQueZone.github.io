# Карта: углубление архитектуры AlysQueZone

## Destination

Каждая из девяти карточек ревью доведена до решения и, где решение «делаем», — до готовой к исполнению to-spec: решены ADR-конфликты, шов, тесты, порядок и гейты. Исполнение сабагентами — отдельная фаза после карты.

## Notes

- Источник — `review.md` (копия `/tmp/opencode/architecture-review-20261106-144234.md`, 2026-11-06). Ревью — предложение, а не приказ: гриллинг проверяет его по коду.
- Доменные термины — `GLOSSARY.md`; архитектурный словарь — `codebase-design` (module, interface, depth, seam, adapter, leverage, locality). Не заменять на «компонент», «сервис», «API», «граница».
- ADR — `docs/adr/`. Карточки «Числа правил» и «Сетка карточек» задевают ADR-0007/0009: решение фиксируется в тикете, а не молча.
- Каждая сессия тикета: `grilling` + `domain-modeling`; альтернативные интерфейсы — `codebase-design` (design-it-twice); факты кода — `codegraph_explore`; внешние доки — `research`; визуал — `prototype`.
- Ответ тикета — to-spec по шаблону `to-spec` + секции `ADR impact`, `Seams / test surfaces`, `Task graph`, `Acceptance gates`, `Glossary terms`. Спека лежит в `specs/NN-<slug>.md`; тикет ссылается на неё.
- Тикет — HITL: сабагент не гриллит за человека. Спеки исполняют сабагенты отдельной фазой.
- Гейты спеки: `just test`, `just check`; визуальные — `just preview` + клик по сборке; коммит; CHANGELOG по правилам `AGENTS.md`.
- Один тикет за сессию. Чарт ничего не резолвит.
- Тикеты пронумерованы в рекомендуемом порядке; фактические зависимости — в `Blocked by` каждого тикета. «Пейджер истории», «Колокольчик», «Церемония Гамбы» и «Сетка карточек» могут идти параллельно с «Маркизой» и «supabase.ts», если не пересекаются по файлам.
- Ревью рекомендует начинать с «Маркизы», затем с «Пейджера истории», потом с «Покупки» и «Колокольчика», а «live-store» — последним. «supabase.ts» добавлен как энейблер перед «Покупкой».

## Decisions so far

<!-- one line per resolved ticket: [title](issues/NN-...md): gist; spec: [specs/NN-...md](specs/NN-...md) -->

- [Маркиза — убрать четвёртую проекцию purchases](issues/01-marquee-deal-log.md): маркиза читает `fetchDealLog` и одну чистую `dealLogLine(entries)`, поведение не меняет; спека: [specs/01-marquee-deal-log.md](specs/01-marquee-deal-log.md).
- [supabase.ts — разделить роли](issues/02-supabase-roles.md): четыре транспортных модуля, кодек курсора в `trade-history`, `pending-buy` без Supabase; спека: [specs/02-supabase-roles.md](specs/02-supabase-roles.md).
- [Пейджер истории — один контроллер для /lot/ и /deals/](issues/03-history-pager.md): безголовый `history-pager`, поверхности — адаптеры; спека: [specs/03-history-pager.md](specs/03-history-pager.md).
- [Покупка — чистое ядро фаз и ошибок](issues/04-buy-flow.md): `buy-core` с фазами и `mapBuyError`, компонент — DOM и сеть; спека: [specs/04-buy-flow.md](specs/04-buy-flow.md).
- [Колокольчик — чистое состояние](issues/05-outbid-bell.md): `outbid-bell` с историей/`unread`/догоном, адаптер — DOM; спека: [specs/05-outbid-bell.md](specs/05-outbid-bell.md).
- [Церемония Гамбы — чистое ядро и кодек пулов](issues/06-gamba-ceremony.md): `gamba-ceremony` + кодек в `gamba-sounds`; спека: [specs/06-gamba-ceremony.md](specs/06-gamba-ceremony.md).
- [Числа правил — один модуль показа](issues/07-rules-numbers.md): `rules.ts` вместо `prices.ts`, SQL — источник истины; спека: [specs/07-rules-numbers.md](specs/07-rules-numbers.md).
- [Сетка карточек — общий план набора и заметки](issues/08-lot-grid.md): чистый `planGrid`, ADR-0009 сохраняется; спека: [specs/08-lot-grid.md](specs/08-lot-grid.md).
- [live-store — три внутренних владельца](issues/09-live-store-cores.md): три владельца за фасадом, `mine` — селектор, тесты по владельцам; спека: [specs/09-live-store-cores.md](specs/09-live-store-cores.md).

## Not yet specified

- Нет: все девять тикетов сведены в спеки `specs/01`–`specs/09`. Следующая фаза — исполнение спек; карта заканчивается на спеках.
- Форма execution-фазы (ветки, integration branch, параллельность) зависит от спек; возможно, отдельная карта после этой.

## Out of scope

- Python-тулинг (`supabase_common`, `submission`, `dev_auth`, `storage_upload`) — отдельный effort.
- Продуктовые пункты `TODO.md` (универсальные уведомления, перенос состояния колокольчика из localStorage, личный кабинет и т.д.) — карточка «Колокольчик» должна это позволить, но не реализует.
- Новые архитектурные кандидаты вне ревью.
- Исполнение рефакторингов — отдельная фаза после спек; карта заканчивается на спеках.
- Speculative session tri-state как отдельная карточка: берётся только если разделение «supabase.ts» до него дотянется.
