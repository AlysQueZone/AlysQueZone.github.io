# 06: Церемония Гамбы — чистое ядро и кодек пулов

Type: grilling
Status: open
Blocked by: —

## Question

Как вынести из `GambaModal` таймлайн церемонии, выбор сегмента, стадию → пул, обрыв по закрытию Окна и гарантию «abort раскрывает баланс ровно один раз» в чистое ядро, а кодек `SoundPools ↔ data-атрибут` — в `gamba-sounds`?

Ревью: `review.md`, карточка «Церемония Гамбы без модуля».

## What to grill

- Стадии и длительности; исходы (возврат/выигрыш/джекпот/проигрыш), legacy miss → lose.
- Abort: закрытие Окна; кто вызывает `deferBalance` release и как гарантировать ровно один раз.
- `WHEEL_PATTERN`: где живёт, кто валидирует; рисование — отдельный адаптер.
- `POOL_KEYS` / `pool()` / `poolAttribute`: encode и decode рядом, имена пулов из одного источника; тест round-trip.
- `setPools` и ошибки загрузки; фолбэк пулов.
- Тесты: каждый исход, abort, кодек.
- ADR impact: `none`; ADR-0011/0003 не переоткрываются.

## Deliverable

`specs/06-gamba-ceremony.md` по шаблону `to-spec` + проектные секции, или мотивированный no-go. Ответ — в `## Answer` этого файла со ссылкой на спеку; статус `resolved`.

## Gates

`just test`, `just check`; для визуальной проверки — `just preview` и клик по сборке.
