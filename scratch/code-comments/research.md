# Комментарии в коде для LLM-агентов

Короткий ответ: да, но узкой полосой. Когда единственный читатель и писатель кода — агент, комментарий перестаёт быть объяснением для человека и становится **инструкцией в общем канале с кодом**: модель взвешивает естественный язык сильнее, чем вывод инструментов, поэтому устаревший комментарий не «шум», а активная помеха — агент следует ему даже вопреки коду (90,1 % прогонов в контролируемом эксперименте). Обратная сторона: у агента нет памяти между сессиями, и «почему» иначе негде хранить — типы, имена и тесты выражают только то, что можно проверить машиной. Отсюда правило: комментарий оправдан ровно там, где он несёт невыводимый факт (почему так, инвариант, операционный запрет, указатель на живой документ), и не оправдан как пересказ кода, история изменений или экскурсия по файлу — такой текст платится вниманием при каждом чтении и гниёт в ложь без единого падения теста.

Зачем: в `AGENTS.md` нужно правило о комментариях для репозитория, где единственный читатель и писатель кода — LLM-агент. Ниже — что об этом говорят измерения и первоисточники и какие выводы из них следуют.

## 1. Эмпирика: что комментарии делают с моделью

### 1.1. Комментарий — это инструкция, а не украшение

**Эмпирика.** ALIBI: четыре LLM-детектора уязвимостей, 125 реальных null-pointer-дереференсов; вредоносные комментарии, внедрённые агентом, обходят детекцию в >90 % случаев (до 100 % на одной системе). Самый эффективный приём — комментарий, «направляющий рассуждение» детектора, а не подделка вывода инструментов. ([arXiv:2607.24964](https://arxiv.org/abs/2607.24964), 27.07.2026)

Область — детекторы уязвимостей, не правка кода, но механизм тот же: естественный язык внутри исходника участвует в решении наравне с кодом.

**Эмпирика.** TAB: 89 терминальных задач (из Terminal-Bench 2.1), где нужная подсказка спрятана в артефакте окружения (README, комментарий, стектрейс) рядом с правдоподобным дистрактором. На десяти фронтир-агентах — систематический разрыв: сильнейший агент по Terminal-Bench показывает высокое выполнение задач и низкое «выравнивание» на TAB. Вывод авторов: агенту нужно _избирательное_ использование инструкций из окружения, а не blanket accept/reject; подавление дистракторов подавляет и нужные подсказки. ([arXiv:2605.12233](https://arxiv.org/abs/2605.12233), 12.05.2026)

**Вывод (инференс).** Комментарий не бывает «просто документацией»: он попадает в тот же поток, что и системная инструкция, и модель может ему последовать. Значит цена плохого комментария — не потраченные токены, а неверное действие.

### 1.2. Иррелевантный текст стоит качества, а не только денег

**Эмпирика.** Chroma, «Context Rot»: 18 моделей (GPT-4.1, Claude 4, Gemini 2.5, Qwen3 и др.), сложность задачи держится постоянной, меняется только длина входа. Деградация с ростом длины — у всех. Даже **один** дистрактор снижает результат относительно baseline, четыре — сильнее; эффект усиливается с длиной. ([research.trychroma.com/context-rot](https://research.trychroma.com/context-rot), 14.07.2025)

**Эмпирика.** «Lost in the Middle»: качество зависит от позиции релевантной информации — выше в начале и конце, значимо хуже в середине, в том числе у моделей с заявленным длинным контекстом. ([arXiv:2307.03172](https://arxiv.org/abs/2307.03172), TACL 2023)

Это не про комментарии напрямую — это про то, что «безвредный» текст в контексте не бесплатен: он разбавляет сигнал и отнимает точность у того, что рядом.

### 1.3. Сигнал «зачем» помогает — это измерено

**Эмпирика.** Крупнейшая абляция комментариев: >80 000 переводов кода с комментариями и без, 1100+ образцов, пять языков (C, C++, Go, Java, Python). Комментарии значимо повышают точность перевода, причём **комментарии о назначении кода в целом — сильнее, чем построчные описания функциональности**. ([arXiv:2601.16661](https://arxiv.org/abs/2601.16661), 23.01.2026)

Это ближайшее, что есть к прямому ответу «какие комментарии помогают»: уровень абстракции важнее наличия.

**Эмпирика (для людей, не для агентов).** Онлайн-эксперимент n=91: и блочные, и строчные комментарии воспринимаются как значимо более полезные, чем код без комментариев; новички предпочитают блочные. ([arXiv:2508.19610](https://arxiv.org/abs/2508.19610), Empirical Software Engineering, 2025)

Полезно как контраст: человеческая интуиция «комментарии помогают» подтверждена для людей и **не переносится автоматически** на агентов — у агента другой дефект: он доверяет прозе больше, чем коду.

### 1.4. Сгенерированные комментарии нельзя считать надёжными

**Эмпирика.** У лучшей из трёх LLM примерно **пятая часть** сгенерированных комментариев содержит доказуемо неверные утверждения. При этом детекторы code-comment inconsistency **не имеют статистически значимой связи** с фактической точностью комментария — то есть «согласованность» не ловит ложь. ([arXiv:2406.14836](https://arxiv.org/abs/2406.14836), 21.06.2024)

**Вывод (инференс).** «Пусть агент допишет комментарии» — не решение проблемы дрейфа, а её источник: генерация даёт правдоподобный, а не верный текст, и проверить его нечем, кроме тестов.

## 2. Что говорят вендоры (это мнение, но мнение владельца формата)

Anthropic, Claude Code best practices — единственная инструкция, которая прямо формулирует критерий «что вообще писать агенту»:

> Only write down what Claude can't find by reading the repo, or what it would otherwise spend time rediscovering every session.

и про цену:

> every line in it takes a little of Claude's attention on _every_ task, whether it's relevant or not

Оттуда же — единственный класс «комментариев», который Anthropic называет полезным явно:

> Places where the code is misleading: an old pattern that's everywhere but that new code must not copy, or a directory that looks unused but isn't

([code.claude.com/docs/en/best-practices](https://code.claude.com/docs/en/best-practices), прочитано 31.10.2026; страница переехала с `docs.claude.com`)

Показательна таблица «что можно перестать делать»: строка «Describe your architecture and file layout in `CLAUDE.md`» помечена как устаревший совет — «Claude reads the repo itself. Only write down what isn't in there».

Anthropic, память проекта: цель — **меньше 200 строк** на файл инструкций, «longer files consume more context and reduce adherence»; при противоречии двух инструкций «Claude may pick one arbitrarily»; и главное для нашей темы — «Each Claude Code session begins with a fresh context window». ([code.claude.com/docs/en/memory](https://code.claude.com/docs/en/memory))

Cursor, правила: «Keep rules under 500 lines»; «**Reference files instead of copying their contents.** This keeps rules short and prevents them from becoming stale as code changes»; в списке «what to avoid» — «Copying entire style guides: Use a linter instead». ([cursor.com/docs/context/rules](https://cursor.com/docs/context/rules))

GitHub Copilot: инструкции «are sent with every chat message, they should be broadly applicable to most requests»; форма — «short, self-contained statements». ([docs.github.com](https://docs.github.com/en/copilot/concepts/response-customization))

AGENTS.md (спецификация, соавторы — OpenAI Codex, Amp, Jules, Cursor, Factory; сейчас под Linux Foundation): «README for agents», «Treat AGENTS.md as living documentation». ([agents.md](https://agents.md/))

Оговорка: страница документации OpenAI Codex про AGENTS.md отдаёт 403 из этого окружения (редирект на `learn.chatgpt.com`), поэтому цитаты от OpenAI здесь нет — только соавторство в спецификации выше.

**Итог по вендорам (мнение, но согласованное у четырёх из пяти).** Пиши то, чего нет в репозитории; не дублируй то, что читается из кода; не копируй документ в контекст — ссылайся; длинное — в линтер, хук или тест.

## 3. Дрейф: устаревший комментарий хуже отсутствующего

**Эмпирика (классика, люди).** Fluri et al., три открытых системы: «newly added code — despite its growth rate — barely gets commented»; при этом 97 % изменений комментариев попадают в ту же ревизию, что и изменение кода. ([WCRE 2007, DOI](https://doi.org/10.1109/WCRE.2007.21), открытая копия — [ZORA, Univ. Zürich](https://www.zora.uzh.ch/server/api/core/bitstreams/1ef6e85e-6f76-41ad-8070-e4fba4b97513/content))

Читать это надо правильно: 97 % — про комментарии, которые _вообще_ кто-то тронул. Механизм дрейфа — в том, что большинство изменений кода комментарий не трогает вовсе.

**Эмпирика (продолжение).** Восемь систем: код и комментарии коэволюционируют в 90 % случаев в шести из восьми, но «API changes and comments do not co-evolve but they are re-documented in a later revision» — то есть отставание документации от кода измерено, а не гипотетично. ([Software Quality Journal, 2009](https://doi.org/10.1007/s11219-009-9075-x))

**Эмпирика (мотивация инструментов).** «developers are often motivated to update code but not comments, leading to outdated or inconsistent documentation». ([LLMCup, arXiv:2507.08671](https://arxiv.org/abs/2507.08671), 11.07.2025) Существование отдельной задачи «comment updating» (CUP → HatCUP → LLMCup) — само по себе доказательство, что синхронизация не происходит сама.

**Эмпирика.** Zero-shot LLM на just-in-time comment update работают плохо: «the performance of LLMs is poor without examples», и даже с примерами больше примеров не всегда лучше. ([arXiv:2407.02824](https://arxiv.org/abs/2407.02824), 03.07.2024)

**Эмпирика (прямо про агентов, но про файлы инструкций).** 40 Python-проектов, 320 прогонов, Claude Code и Codex CLI: файл инструкций требует одной конвенции, код использует другую. Без оговорки **90,1 %** решений агента последовали устаревшему файлу; Claude Code указал на конфликт в 79 из 80 прогонов и всё равно пошёл за файлом; Codex в 20 из 80 переписал код под файл, и в 17 случаях упали тесты проекта. Одна фраза «код главнее» подняла следование коду с 4,2 % до 91,4 %, а прохождение тестов — с 89,4 % до 100 %. ([arXiv:2610.30571](https://arxiv.org/abs/2610.30571), 22.10.2026)

Это про AGENTS.md/CLAUDE.md, а не про `//`-комментарии. Но канал тот же — «естественный язык приходит как инструкция, код — как вывод инструмента, и модели обучены ранжировать его ниже» (объяснение авторов). Для комментария внутри файла механизм как минимум не слабее: он ближе к коду и выглядит как пояснение автора.

**Эмпирика.** Тот же класс проблемы у документации: проверка 356 репозиториев нашла устаревшие ссылки на элементы кода в 23,0 % репозиториев. ([arXiv:2606.09090](https://arxiv.org/abs/2606.09090), 08.06.2026)

**Эмпирика.** Несогласованное изменение кода и комментария примерно в **1,5 раза** чаще приводит к bug-introducing коммиту, чем согласованное; эффект максимален сразу после появления несогласованности. ([arXiv:2409.10781](https://arxiv.org/abs/2409.10781), 16.09.2024)

**Инференс (не измерено напрямую).** Агент, правящий функцию, не обновит соседний комментарий, если этого не требует задача: нет ни ошибки компилятора, ни падения теста, а отдельная задача comment updating даже у специализированных моделей без примеров проваливается. Прямого замера «доля правок агента, после которых комментарий стал ложным» я не нашёл — это пробел, а не факт.

## 4. Канон «почему, а не что»: что здесь доказано, а что мнение

**Мнение (но канон).** Ousterhout, «A Philosophy of Software Design», гл. 13: «The goal of comments is to ensure that the structure and behavior of the system is obvious to readers»; «there is a significant amount of information that can't easily be deduced from the code. Comments fill in this information». (Yaknyam Press, 2018, ISBN 978-1732102201; проверено по тексту гл. 13.8)

**Мнение (официальный стайлгайд, не исследование).** Google C++ Style Guide, раздел Comments:

> Do not state the obvious. In particular, don't literally describe what code does, unless the behavior is nonobvious to a reader who understands C++ well. Instead, provide higher-level comments that describe why the code does what it does, or make the code self-describing.

и там же: «the best code is self-documenting. Giving sensible names to types and variables is much better than using obscure names that you must then explain through comments». Отдельно полезна развилка: «Declaration comments describe use of the function (when it is non-obvious); comments at the definition of a function describe operation». ([google.github.io/styleguide/cppguide.html#Comments](https://google.github.io/styleguide/cppguide.html#Comments))

**Что из этого реально проверено.** Контролируемого эксперимента «почему vs что» для агентов я не нашёл. Ближайшее — абляция перевода (§1.3): комментарий о назначении помогает, построчное описание — нет. Это подтверждает _форму_ совета, но не его механизм. Второе косвенное — таксономия «inline comment smells» как отдельного класса дефектов, который пытаются детектировать автоматически. ([arXiv:2504.18956](https://arxiv.org/abs/2504.18956), EASE 2025)

Kernighan & Pike в этот обзор не попали: проверить цитату по первоисточнику в рамках этой работы не удалось, поэтому не цитирую.

## 5. Чем заменить: носители той же информации с меньшим дрейфом

**Типы и имена.** Прямо у Google: имя лучше комментария, объясняющего имя. В TypeScript это ещё и проверяемо компилятором — в отличие от прозы.

**Тесты и проверки.** Anthropic формулирует это как главный рычаг: дать агенту то, что «comes back pass or fail», чтобы он сам закрывал цикл. ([best-practices](https://code.claude.com/docs/en/best-practices))

**Исполняемые ограничения вместо прозы — измерено.** ContextCov компилирует правила из AGENTS.md в AST-проверки, shell-шимы и архитектурные валидаторы: 88,3 % соблюдения ограничений против 67,0 % у prompt-only и 50,3 % у LLM-reflection, при в 3,4 раза меньшей стоимости обратной связи; SWE-bench Lite, 12 репозиториев, 300 задач. ([arXiv:2603.00822](https://arxiv.org/abs/2603.00822), 28.02.2026)

Это самый сильный аргумент за перенос «вечных» правил из комментариев в проверки: текст просят соблюдать, проверку — нельзя не соблюсти.

**Документы и указатели.** Cursor: ссылаться на файл, а не копировать его содержимое, — «prevents them from becoming stale as code changes». Anthropic: решение, которого нет в репозитории, — законный повод написать строку; архитектуру и layout — нет.

**Работают ли AGENTS.md вообще — данные противоречивы, и это важно.**

| Работа                                                            | Настройка                                                         | Результат                                                                                                                  |
| ----------------------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| [arXiv:2602.11988](https://arxiv.org/abs/2602.11988) (12.02.2026) | SWE-bench + задачи из репозиториев с файлами; разные LLM и агенты | Успех не растёт, стоимость вывода **+20 %**; инструкции соблюдаются хорошо, а «repository overviews» **не полезны**        |
| [arXiv:2601.20404](https://arxiv.org/abs/2601.20404) (28.01.2026) | 10 репозиториев, 124 PR                                           | Медианное время **−28,64 %**, выходные токены **−16,58 %**, поведение сопоставимо                                          |
| [arXiv:2607.27250](https://arxiv.org/abs/2607.27250) (28.07.2026) | 2 агента, 17 задач, 3 репозитория, 288 прогонов                   | Корректность не двигается в пределах ≤10–15 п.п.; провалы — в «implementation skill», а не в нехватке знаний о репозитории |

Сводя: файлы инструкций экономят **время и токены** и помогают соблюдать нестандартные практики, но **не повышают корректность** и не заменяют понимание кода. Массовость практики при этом не аргумент: 26,3 % из 22 854 популярных репозиториев имеют AGENTS.md или CLAUDE.md (59,6 % у самых звёздных), и **74,0 % директив не объясняют причину**. ([arXiv:2610.31715](https://arxiv.org/abs/2610.31715), 22.10.2026)

## 6. Экономика токенов и внимания

**Вендор (механизм).** Anthropic: «attention budget», у трансформера n² связей на n токенов, «Every new token introduced depletes this budget by some amount»; цель — «the smallest set of high-signal tokens». ([Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents), 29.09.2025)

**Эмпирика.** Та же деградация с длиной у 18 моделей (§1.2) — то есть стоимость контекста не линейна по полезности.

**Эмпирика.** Context Bloat — второй по частоте «запах» конфигурации агента: 42 % из 100 популярных репозиториев. ([arXiv:2606.15828](https://arxiv.org/abs/2606.15828), SCAM 2026)

**Измерение (моё, этот репозиторий, 31.10.2026).** Грубая эвристика по `src/**/*.{ts,astro,css,js}`: 53 файла, 10 340 строк, 374 076 символов. Комментарии — 1752 строки (**16,9 %**) и 103 158 символов (**27,6 %**), т.е. примерно 26 тыс. из 93,5 тыс. токенов при оценке «4 символа на токен». По файлам разброс большой: `src/lib/prices.ts` — 59 % символов, `src/lib/errors.ts` — 49,7 %, `src/lib/outbid-event.ts` — 63 %.

Что это значит практически: агент не читает весь `src/`, он читает файл. И в «комментарных» модулях половина прочитанных токенов — проза. Это не приговор (в `errors.ts` проза как раз несёт классификацию ошибок), но и не ноль: цена платится при каждом чтении, а польза возникает только если факт нужен именно сейчас.

**Оговорка.** Оценка токенов — chars/4, атрибуция комментариев — построчная эвристика; для `.astro` и `.css` она приблизительна. Точных замеров токенайзером я не делал.

## Что это значит для правила

### Оставлять (несёт невыводимый факт)

1. **Почему так, а не очевидным способом** — особенно если очевидный вариант отвергнут по причине, которой нет в коде.
2. **Инвариант, который не выражается типом**: единицы, диапазон, порядок, владение, «вызывающий обязан…», время жизни.
3. **Операционный запрет**: «руками не править», «после миграции прогнать X». Если запрет должен выполняться _всегда_ — не комментарий, а хук/проверка (Anthropic, ContextCov).
4. **Указатель на живой документ** (`docs/adr/...`) вместо пересказа решения.
5. **Ловушка**: «выглядит мёртвым, но используется», «старый паттерн, новый код так не пишем» — единственный класс, который Anthropic называет прямо.
6. **Осознанный уродливый обход** с причиной: почему нельзя сделать нормально.

### Удалять (пересказ, история, навигация)

1. Пересказ следующих трёх строк.
2. Ченджлог в комментарии («добавлено для задачи 123») — это git.
3. Номер тикета как единственное содержимое — умирает вместе с трекером; ссылка на ADR долговечнее.
4. Закомментированный код.
5. Docstring, повторяющий сигнатуру: типы уже это сказали.
6. Экскурсия по файлу и баннеры секций в файле на 50 строк.
7. Планы и черновики агента, оставленные в коммите: агенты действительно «plan solutions in code comments» ([arXiv:2607.22807](https://arxiv.org/abs/2607.22807), 24.07.2026) — это рабочая память, ей не место в истории.
8. Всё, что станет ложью после ближайшего рефакторинга и при этом не роняет ни один тест.

### Проверки, чтобы правило было тестируемым, а не вкусовым

- **Тест удаления.** Если удаление комментария не может заставить будущего читателя сделать неверный шаг — удалить.
- **Тест дрейфа.** Может ли комментарий стать ложным без падения теста? Если да и он не несёт инварианта — либо удалить, либо превратить в тип/тест/проверку.
- **Тест токенов.** Комментарии больше ~20–25 % символов файла — почти наверняка пересказ (в этом репозитории такие файлы есть, см. §6).
- **Тест обновления.** Правило должно требовать: меняешь описанное поведение — в том же изменении правишь или удаляешь комментарий. Без этой фразы агент этого не сделает (§3).
- **Тест канала.** Факт, который должен соблюдаться всегда, проверяется машиной, а не прозой (§5).

### Формулировка

> Комментарий пишем только там, где код молчит: почему так, инвариант, операционный запрет, указатель на живой документ. Пересказ кода, история и номера тикетов — удаляем при первой правке; меняешь поведение — в том же изменении правишь или удаляешь комментарий. Если факт можно проверить типом, тестом или линтером — он живёт там, а не в комментарии.

## Источники

**Эмпирика про модели и контекст**

1. Liu et al. _Lost in the Middle: How Language Models Use Long Contexts._ TACL 2023. https://arxiv.org/abs/2307.03172 (06.07.2023)
2. Hong K., Troynikov A., Huber J. _Context Rot: How Increasing Input Tokens Impacts LLM Performance._ Chroma Technical Report, 14.07.2025. https://research.trychroma.com/context-rot
3. Gupta M. et al. _Revisiting the Role of Natural Language Code Comments in Code Translation._ 23.01.2026. https://arxiv.org/abs/2601.16661
4. Kang S., Milliken L., Yoo S. _Identifying Inaccurate Descriptions in LLM-generated Code Comments via Test Execution._ 21.06.2024. https://arxiv.org/abs/2406.14836
5. Radmanesh S. et al. _Investigating the Impact of Code Comment Inconsistency on Bug Introducing._ 16.09.2024. https://arxiv.org/abs/2409.10781
6. Wu Z., Nita-Rotaru C. _ALIBI: Adaptive Agentic Attacks on LLM-Based Vulnerability Detectors via Adversarial Code Comments._ 27.07.2026. https://arxiv.org/abs/2607.24964
7. Mavali S. et al. _No More, No Less: Task Alignment in Terminal Agents._ 12.05.2026. https://arxiv.org/abs/2605.12233
8. Wu Z., Anderson C. J., Guha A. _The Best Programming Language for Tokenmaxxing._ 24.07.2026. https://arxiv.org/abs/2607.22807
9. Figl K. et al. _The Influence of Code Comments on the Perceived Helpfulness of Stack Overflow Posts._ EMSE, 2025. https://arxiv.org/abs/2508.19610
10. Oztas I., Torun U. B., Tüzün E. _Towards Automated Detection of Inline Code Comment Smells._ EASE 2025. https://arxiv.org/abs/2504.18956

**Дрейф комментариев**

11. Fluri B., Würsch M., Gall H. C. _Do Code and Comments Co-Evolve?_ WCRE 2007. https://doi.org/10.1109/WCRE.2007.21 · открытая копия: https://www.zora.uzh.ch/server/api/core/bitstreams/1ef6e85e-6f76-41ad-8070-e4fba4b97513/content
12. Fluri B. et al. _Analyzing the co-evolution of comments and source code._ Software Quality Journal, 2009. https://doi.org/10.1007/s11219-009-9075-x
13. Ge H. et al. _LLMCup: Ranking-Enhanced Comment Updating with LLMs._ 11.07.2025. https://arxiv.org/abs/2507.08671
14. Fan L. et al. _Exploring the Capabilities of LLMs for Code Change Related Tasks._ 03.07.2024. https://arxiv.org/abs/2407.02824
15. Panthaplackel S. et al. _Deep Just-In-Time Inconsistency Detection Between Comments and Source Code._ AAAI 2021. https://arxiv.org/abs/2010.01625

**Агенты и файлы инструкций**

16. Gloaguen T. et al. _Evaluating AGENTS.md: Are Repository-Level Context Files Helpful for Coding Agents?_ 12.02.2026 (v3 29.09.2026). https://arxiv.org/abs/2602.11988
17. Lulla J. L. et al. _On the Impact of AGENTS.md Files on the Efficiency of AI Coding Agents._ 28.01.2026. https://arxiv.org/abs/2601.20404
18. Khatri P. _Do Context Files Help Coding Agents? A Two-Agent Ablation Study on Real Repositories._ 28.07.2026. https://arxiv.org/abs/2607.27250
19. Xu X., Wu W. _Stale Instruction Files Override the Code in Coding Agents: A One-Sentence Fix._ 22.10.2026. https://arxiv.org/abs/2610.30571
20. Treude C., Baltes S. _Context Rot in AI-Assisted Software Development._ 08.06.2026. https://arxiv.org/abs/2606.09090
21. dos Santos H. V. F. et al. _Configuration Smells in AGENTS.md Files._ SCAM 2026. https://arxiv.org/abs/2606.15828
22. Zarzycki P. _What Open-Source Projects Tell Their Coding Agents: A Census of AGENTS.md and CLAUDE.md._ 22.10.2026. https://arxiv.org/abs/2610.31715
23. Sharma R. K. _ContextCov: Deriving and Enforcing Executable Constraints from Agent Instruction Files._ 28.02.2026. https://arxiv.org/abs/2603.00822

**Вендорские документы и канон (мнение, не исследование)**

24. Anthropic. _Best practices for Claude Code._ https://code.claude.com/docs/en/best-practices (прочитано 31.10.2026)
25. Anthropic. _How Claude remembers your project_ (CLAUDE.md / AGENTS.md). https://code.claude.com/docs/en/memory (прочитано 31.10.2026)
26. Anthropic. _Effective context engineering for AI agents._ 29.09.2025. https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
27. Cursor. _Rules._ https://cursor.com/docs/context/rules (прочитано 31.10.2026)
28. GitHub. _Custom instructions for GitHub Copilot._ https://docs.github.com/en/copilot/concepts/response-customization (прочитано 31.10.2026)
29. _AGENTS.md_ — открытый формат (OpenAI Codex, Amp, Jules, Cursor, Factory; стюард — Agentic AI Foundation). https://agents.md/ (прочитано 31.10.2026)
30. Google. _C++ Style Guide_, раздел Comments. https://google.github.io/styleguide/cppguide.html#Comments
31. Ousterhout J. _A Philosophy of Software Design._ Yaknyam Press, 2018, гл. 13 «Comments Describe Design». ISBN 978-1732102201
