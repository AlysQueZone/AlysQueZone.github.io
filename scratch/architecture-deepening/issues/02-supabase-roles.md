# 02: supabase.ts — разделить роли

Type: grilling
Status: resolved
Blocked by: —

## Question

Какие роли в `supabase.ts` действительно несовместимы и как разделить файл, сохранив текущие импорты на время перехода, чтобы `pending-buy` не тянул Supabase, а кодек `HistoryCursor` жил рядом с типом?

Ревью: `review.md`, карточка «supabase.ts — четыре несовместимые роли».

## What to grill

- Четыре роли (`session`, `pending-buy`, `purchases-read`, `purchase-write`) или меньше; нужен ли отдельный `purchase-write`.
- `withAuthRetry` — сессия или общий транспорт; где живёт клиент.
- Кодек курсора: encode/decode рядом с `HistoryCursor` в чистом ядре или в `purchases-read`; как не протащить Supabase в ядро.
- `pending-buy`: какие функции и поверхности; как убрать Supabase из навигации.
- Session tri-state (`unknown | guest | user`): входит сюда или остаётся small seam; если входит — кто владелец.
- Миграция импортов: re-export/barrel или сразу все call sites; как не оставить две реализации навсегда.
- ADR impact: ожидается `none`; проверить ADR-0003.
- Буквальная формулировка ADR-0003 «только через `live.ts`» уже расходится с `/deals/` и `/lot/` (разовые чтения страниц идут через `supabase.ts`), а после тикета 01 — и с маркизой. Решить при разделении ролей: уточнить ADR или оставить как есть.

## Deliverable

`specs/02-supabase-roles.md` по шаблону `to-spec` + проектные секции, или мотивированный no-go. Ответ — в `## Answer` этого файла со ссылкой на спеку; статус `resolved`.

## Gates

`just test`, `just check`.

## Answer

Спека: [specs/02-supabase-roles.md](../specs/02-supabase-roles.md).

- Четыре модуля: `session` (клиент, вход/выход, retry, `displayLogin`, гейт), `pending-buy` (навигация без Supabase), `purchases-read` (три чтения), `purchase-write` (`buyLotShared`). uid-снапшот остаётся у `live`.
- `historyCursorFilter` живёт в `trade-history` рядом с `HistoryCursor`; оба чтения с курсором используют её, литерал keyset-фильтра больше не дублируется.
- Все текущие импорты обновляются сразу, `supabase.ts` удаляется; барреля не остаётся. Витрина берёт `peekPendingBuy` из `pending-buy` и перестаёт тянуть Supabase.
- Session tri-state (`unknown | guest | user`) в карточку не входит: это отдельный шов, передан в тикет «live-store — три внутренних владельца».
- ADR impact — `amend`: первая фраза ADR-0003 уточняется, что разовые чтения и запись идут через `purchases-read` / `purchase-write`, а `live` владеет снапшотом и событиями.
- Спека исполнима одной сессией: кодек и тесты, четыре модуля, сплошная миграция импортов, ADR, гейты `just test` / `just check` / `preview` и запись в `CHANGELOG.md` в группе `### Внутри`.
