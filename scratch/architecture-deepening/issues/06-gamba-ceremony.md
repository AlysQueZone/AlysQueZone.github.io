# 06: Церемония Гамбы — чистое ядро и кодек пулов

Type: grilling
Status: resolved
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

## Recommended answers

> Решения, лёгшие в основу спеки: [specs/06-gamba-ceremony.md](../specs/06-gamba-ceremony.md).

1. **Ядро церемонии.** Новый чистый `gamba-ceremony.ts`: стадии `idle | requesting | spinning | revealed | aborted`, `SPIN_MS = 4200`, события `start | result | finish | abort | reset`; исходы включая legacy `miss`, для пула/стадии `miss → lose`; `outcomePool`: `return|miss → lose`, `small|big → win`, `jackpot → jackpot`. Компонент владеет rAF, canvas, звуком, таймерами и сетью; ядро — переходами и эффектами.
2. **Abort / release.** Ядро держит `balanceHeld` и выдаёт эффекты `holdBalance` на старте и `releaseBalance` ровно один раз на терминальном переходе (`revealed` / `aborted` / ошибка); повторный release — no-op; `result` после abort игнорируется; закрытие окна в `requesting` / `spinning` → `aborted`.
3. **`WHEEL_PATTERN`.** Переезжает в `gamba-ceremony.ts` (или `gamba-wheel.ts`): паттерн, `SEGMENT_SPECS`, валидация длины 12 / алфавита RBSJ / счётов 9-1-1-1, `segments`, `targetSegment(outcome, random)`. Canvas-адаптер только рисует; проверка в компоненте исчезает.
4. **Кодек пулов.** `gamba-sounds.ts` владеет encode/decode: `POOL_KEYS` / `poolDataKey`, `encodePools`, `decodePool`, `readPools(dataset)`, `poolAttribute`; `pool()` в компоненте удаляется; `POOL_NAMES` — единственный источник имён; round-trip тест.
5. **`setPools` / ошибки.** `fetchSoundPools` → null/неполный список → фолбэк сборки; `setPools` пишет через кодек, `syncPools` при открытии, крутку не блокирует. Ядро не грузит пулы.
6. **Тесты.** `gamba-ceremony.test.ts`: каждый исход → пул, переходы стадий, abort/release один раз, result после abort, валидация паттерна, выбор сегмента; `gamba-sounds.test.ts`: round-trip и имена. DOM не тестируем.
7. **ADR.** `none`; ADR-0011/0003 не переоткрываются.

## Deliverable

`specs/06-gamba-ceremony.md` по шаблону `to-spec` + проектные секции, или мотивированный no-go. Ответ — в `## Answer` этого файла со ссылкой на спеку; статус `resolved`.

## Gates

`just test`, `just check`; для визуальной проверки — `just preview` и клик по сборке.

## Answer

Спека: [specs/06-gamba-ceremony.md](../specs/06-gamba-ceremony.md).

- Новый чистый `gamba-ceremony`: стадии `idle/requesting/spinning/revealed/aborted`, исходы, `outcomePool`, `WHEEL_PATTERN`, `targetSegment`; canvas, rAF и звук остаются адаптеру.
- Инвариант «release ровно один раз» живёт в ядре: `holdBalance` на старте, `releaseBalance` на терминальном переходе; `result` после abort игнорируется.
- `gamba-sounds` получает кодек `SoundPools ↔ data-атрибут`; `POOL_NAMES` — единственный источник имён, round-trip покрыт тестом.
- `setPools` пишет через кодек, неполный список БД даёт фолбэк сборки; крутку это не блокирует.
- Legacy `miss` остаётся в типе, но **Церемония** и **Пул звуков** нормализуют его в `lose`.
- ADR impact — `none`: ADR-0011/0003 не переоткрываются.
