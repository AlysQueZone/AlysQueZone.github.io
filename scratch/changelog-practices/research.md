# Практики ведения CHANGELOG: что говорят первоисточники

Сверено 27.10.2026. Каждое утверждение — со ссылкой на документ, который его устанавливает
(спека, доки инструмента, исходный README), а не на пересказ. Где источники расходятся —
написано, что расходятся, и в чём именно.

Зачем: в проекте `CHANGELOG.md` ведётся по своим правилам (`AGENTS.md`), и надо понять,
что из этих правил совпадает с практикой индустрии, что является осознанным отступлением,
а что — случайностью. Разбор самого файла — в §9, варианты — в §10–11.

---

## 1. Keep a Changelog 1.1.0

<https://keepachangelog.com/en/1.1.0/> (сама спека в одном файле, там же FAQ и Bad Practices).

### Что это и для кого

> «A changelog is a file which contains a curated, chronologically ordered list of notable
> changes for each version of a project.»

> «To make it easier for users and contributors to see precisely what notable changes have
> been made between each release (or version) of the project.»

> «People do. Whether consumers or developers, the end users of software are human beings
> who care about what's in the software. When the software changes, people want to know why
> and how.»

Ключевое слово — **curated** (отобранный вручную): список не выводится из истории, а пишется.

### Guiding Principles (дословно, все семь)

- «Changelogs are _for humans_, not machines.»
- «There should be an entry for every single version.»
- «The same types of changes should be grouped.»
- «Versions and sections should be linkable.»
- «The latest version comes first.»
- «The release date of each version is displayed.»
- «Mention whether you follow [Semantic Versioning].»

### Категории

Шесть типов, ровно эти слова: `Added` (новые возможности), `Changed` (изменения существующего),
`Deprecated` (скоро удаляемое), `Removed` (удалённое), `Fixed` (исправления), `Security`
(уязвимости). Заголовок раздела по спеке — это версия и дата: `## [1.1.2] - 2024-09-27`,
`## [Unreleased]`. **Темы/названия у релиза в спеке нет** — это уже расширение.

Порядок категорий внутри версии не задан: в собственном CHANGELOG проекта (см. раздел `1.1.1`)
идёт `Added`, `Fixed`, `Changed`, `Removed` — то есть не алфавит и не порядок перечисления
в спеке. Значит, «правильного» порядка категорий спека не требует.

### «Unreleased»

> «Keep an `Unreleased` section at the top to track upcoming changes. This serves two purposes:
> People can see what changes they might expect in upcoming releases; At release time, you can
> move the `Unreleased` section changes into a new release version section.»

Это буквально механика `just release`: переименовать верхний раздел и создать сверху пустой.

Зачем это вообще нужно, сказано в разделе «How can I reduce the effort required to maintain
a changelog?» — чтобы записи делались _по ходу_, а не восстанавливались по памяти в день релиза.

### Против `git log` и «что не писать»

Заголовок страницы: «Don't let your friends dump git logs into changelogs.»

> «Using commit log diffs as changelogs is a bad idea: they're full of noise. Things like merge
> commits, commits with obscure titles, documentation changes, etc.»

> «The purpose of a commit is to document a step in the evolution of the source code. […]
> The purpose of a changelog entry is to document the noteworthy difference, often across
> multiple commits, to communicate them clearly to end users.»

То есть одна запись ченджлога ≠ один коммит: это может быть несколько коммитов, слитых в одну
мысль, и наоборот — один коммит может не дать записи вовсе.

Что ещё названо плохой практикой:

- **Ignoring Deprecations** — «If you do nothing else, list deprecations, removals, and any
  breaking changes in your changelog.»
- **Confusing Dates** — рекомендован ISO 8601 (`2017-07-17`), потому что порядок «от большего
  к меньшему» и нет двусмысленности с региональными форматами.
- **Inconsistent Changes** — «A changelog which only mentions some of the changes can be as
  dangerous as not having a changelog. […] your users may mistakenly think that the changelog
  is the single source of truth. It ought to be.» То есть у файла должен быть **объявленный
  охват**, и внутри охвата нельзя пропускать важное.

### Оговорки самой спеки

- «Is there a standard changelog format? **Not really.**» — GNU-гайд и NEWS-файл названы
  «inadequate or insufficient», а сам проект — «a better changelog convention».
- «This document is not the **truth**; it's my carefully considered opinion, along with
  information and examples I gathered.» — спека не нормативна, отступать от неё можно, но
  осознанно.
- Про GitHub Releases: «GitHub Releases create a non-portable changelog that can only be
  displayed to users within the context of GitHub.» Файл в репозитории — переносимее.
- «Should you ever rewrite a changelog? **Sure.** There are always good reasons to improve
  a changelog.» — правка старых разделов разрешена (важно для §8.6).

---

## 2. Conventional Commits 1.0.0

<https://www.conventionalcommits.org/en/v1.0.0/>

Формат: `<type>[optional scope]: <description>` + тело + футеры. Машиночитаемый смысл:
`fix:` ↔ PATCH, `feat:` ↔ MINOR, `BREAKING CHANGE:` или `!` ↔ MAJOR.

> «Additional types are not mandated by the Conventional Commits specification, and have no
> implicit effect in Semantic Versioning (unless they include a BREAKING CHANGE).»

В «Why Use Conventional Commits» первым пунктом стоит «Automatically generating CHANGELOGs»,
вторым — «Automatically determining a semantic version bump». То есть ченджлог здесь —
**побочный продукт** аккуратной истории коммитов, а не самостоятельный документ.

### Где подход упирается

- Спека описывает намерение **для потребителей библиотеки**: «to communicate intent to the
  consumers of your library». Для сайта без публичного API отображение типов на SemVer
  не к чему привязать.
- Revert не определён: «Conventional Commits does not make an explicit effort to define revert
  behavior. Instead we leave it to tooling authors…» — то есть отмена изменения в ченджлоге
  остаётся на усмотрение инструмента (и человека).
- Неверный тип не ломает мир, но запись теряется: «It simply means that commit will be missed
  by tools that are based on the spec.»
- Требовать конвенцию от всех не обязательно — но только если история чистится мержем:
  «If you use a squash based workflow on Git lead maintainers can clean up the commit messages
  as they're merged».

Ограничение по существу: из коммита извлекается только то, что в него написали. «Почему»
и «что это значит для чатерса» в subject не влезают, а тело коммита инструменты по умолчанию
в ченджлог не тянут (см. §5.1 — только `message`, максимум с `body` через парсер).

---

## 3. Semantic Versioning 2.0.0

<https://semver.org/>

> «Software using Semantic Versioning MUST declare a public API. This API could be declared in
> the code itself or exist strictly in documentation.»

Правила инкремента (MAJOR — несовместимое изменение API, MINOR — обратно совместимая новая
функциональность, PATCH — обратно совместимое исправление) имеют смысл **только при наличии
объявленного API и потребителей, которые на него опираются**. У сайта-витрины такого API нет:
чатерс не подключается к нему как к библиотеке.

Формально это не «SemVer запрещает версии без API», а «SemVer начинается с объявления API» —
без него правило 1 невыполнимо, и связка «тип изменения → цифра» перестаёт что-либо значить.

Ещё две вещи, релевантные ченджлогу:

- Правило 3: «Once a versioned package has been released, the contents of that version MUST NOT
  be modified. Any modifications MUST be released as a new version.» — сказано про содержимое
  пакета, не про текст заметок; но дух «выпущенное не переписываем» отсюда родом.
- FAQ «Is "v1.2.3" a semantic version? **No**» — тег и версия это разные вещи (полезно, если
  когда-нибудь появятся теги).

**Вывод для проекта без версий:** SemVer не «запрещён», он просто не применим — как только
нет публичного API, выбирать MAJOR/MINOR/PATCH не из чего. Это не аргумент против ченджлога:
KaC (§1) и CalVer (§4) прямо разделяют «версия» и «человекочитаемая история».

---

## 4. CalVer — версия как дата

<https://calver.org/>

> «CalVer is a versioning convention based on your project's release calendar.»

Схемы: `YYYY`, `YY.M`, `YYYY.0M.0D[.MICRO]` и т. п. Примеры живых проектов: Ubuntu `YY.0M`
(26.04), yt-dlp `YYYY.0M.0D` (2026.08.19), Home Assistant `YYYY.M.MICRO`.

Прямо про наш случай:

> «CalVer deliberately does not attempt to communicate breaking changes. That's because there's
> never been consensus on what counts as a breaking change… **There is no substitute for
> a changelog and policy.**»

То есть дата в заголовке не заменяет ченджлог, а снимает с него обязанность объяснять
«насколько это ломающе» — это делает текст записи.

Про несколько релизов в день:

> «Append an incrementing micro segment, `YYYY.M.D.MICRO`: `2026.9.11`, then `2026.9.11.1`.
> Intra-day timestamps trade readability for still-limited resolution (two releases in the same
> minute) or a version that grows too long. Humans don't convert a second-counter to a wall
> clock in their heads.»

Практический вывод: разрешение «минута» (`HH:MM`) закрывает почти всё, но два релиза в одну
минуту дадут два одинаковых заголовка. Если это станет реальностью — нужен суффикс.

Про паддинг: `YYYY.M.D` без нулей, потому что паддинг ломает строгий SemVer; паддинг оправдан
там, где версии сортируются лексически (имена файлов, теги образов). Наши даты в заголовках
паддятся (`2026-10-18`) — это не версия, а метка времени, конфликта с SemVer нет.

---

## 5. Инструменты: что берут за источник правды

| Инструмент               | Источник правды                                               | Когда пишется запись                       | Где ломается                                |
| ------------------------ | ------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------- |
| `git-cliff`              | история git (коммиты, при желании — PR-метаданные)            | при генерации, из уже случившихся коммитов | неконвенциональные коммиты, merge-история   |
| `conventional-changelog` | то же (git metadata)                                          | при генерации                              | то же                                       |
| `release-please`         | коммиты в main + теги                                         | бот собирает release PR                    | plain merge, «нерелизные» типы              |
| `changesets`             | отдельные файлы в `.changeset/`, написанные автором изменения | в момент изменения, до релиза              | требует версий пакетов; много ручных файлов |
| GitHub Releases          | мерженные PR + лейблы                                         | при публикации релиза                      | нет лейбла — нет категории; непереносимо    |

### 5.1 `git-cliff`

<https://git-cliff.org/docs/>

> «**git-cliff** can generate changelog files from the Git history by utilizing conventional
> commits as well as regex-powered custom parsers. The changelog template can be customized…»

Рекомендация по истории (<https://git-cliff.org/docs/>):

> «We recommend using a Git history that follows the Conventional Commits specification as the
> primary strategy.»

Конфиг (<https://git-cliff.org/docs/configuration/git>) даёт ровно те ручки, которые нужны,
когда коммиты неидеальны:

- `conventional_commits`, `filter_unconventional` — неконвенциональные коммиты либо
  выбрасываются, либо попадают в группу «Other»;
- `require_conventional` — сборка падает, если хоть один коммит не по спеке;
- `commit_parsers` с `group = "…"` — категории задаются регулярками по сообщению, а не только
  типом (`{ message = "^feat", group = "Features" }`), есть `skip = true` для «не писать»;
- `fail_on_unmatched_commit` — «useful to enforce that all commits are classified and prevents
  silently omitting unknown commit types» (прямая защита от «Inconsistent Changes» из §1);
- `split_commits` — с оговоркой в самих доках: «This flag violates "conventional commits".
  It should remain off by default…»;
- `include_paths` / `exclude_paths` — не писать записи о коммитах, тронувших только доки.

`[unreleased]` и переход к релизу (<https://git-cliff.org/docs/usage/examples>):

```
git cliff --unreleased                      # только незакрытые коммиты
git cliff --unreleased --tag 1.0.0 --prepend CHANGELOG.md
```

> «1- changelog header is removed from CHANGELOG.md; 2- new entries are prepended to
> CHANGELOG.md without footer part».

То есть файл становится **артефактом сборки**: старые разделы не редактируются руками, новый
просто дописывается сверху. Для повторных прогонов есть `header_marker`
(<https://git-cliff.org/docs/configuration/changelog>): «a stable marker written after a header
that uses template variables. When prepending releases with `--prepend`, git-cliff uses this
marker to remove the previously rendered header even if its content has changed.» — без него
повторная генерация дублирует шапку.

Отдельно: git-cliff умеет тянуть не только коммиты — PR-заголовки, номера и лейблы
(<https://git-cliff.org/docs/configuration/remote>, пример «GitHub pull request labels can be
used as grouping keys»). И рекомендует squash-мержи, иначе PR-контекст не привязывается
к одному коммиту.

### 5.2 `conventional-changelog`

<https://github.com/conventional-changelog/conventional-changelog> — README в одну строку:
«Generate a CHANGELOG from git metadata.» Дальше — набор пакетов (парсер, writer, пресеты
angular/conventionalcommits, `conventional-recommended-bump`) и совет брать инструмент выше
уровнем: `commit-and-tag-version`, `semantic-release`. Своего мнения о качестве записей README
не высказывает — это чистый конвейер «коммиты → файл».

### 5.3 `release-please`

<https://github.com/googleapis/release-please>

> «Release Please automates CHANGELOG generation, the creation of GitHub releases, and version
> bumps for your projects. It does so by parsing your git history, looking for Conventional
> Commit messages, and creating release PRs.»

Механика: бот держит открытый release PR; мерж PR = релиз (обновляет `CHANGELOG.md`, ставит
тег, создаёт GitHub Release). «It does not handle publication to package managers or handle
complex branch management.»

Что считается релизным:

> «A releasable unit is a commit to the branch with one of the following prefixes: "feat", "fix",
> and "deps". (A "chore" or "build" commit is not a releasable unit.)»

То есть по умолчанию **рефакторинг и доки в ченджлог не попадают** — это зашито в инструмент,
а не выведено из спеки.

Про историю: «We **highly** recommend that you use squash-merges…». Аргумент прямо про качество
заметок:

> «you may have `feat: introduce feature A` and then `fix: some bugfix introduced in the first
commit`. The `fix` commit is actually irrelevant to the release notes as there was never a bug
> experienced in the main branch.»

Правка заметок постфактум возможна, но с ограничением: `BEGIN_COMMIT_OVERRIDE … END_COMMIT_OVERRIDE`
в теле смерженного PR — «This feature will not work with plain merges because release-please
does not know which commit(s) to apply the override to.»

### 5.4 `changesets`

<https://changesets.dev/guide/getting-started>

> «A changeset is a Markdown file with YAML frontmatter. The contents of the Markdown is the
> change summary which will be written to the changelog and the YAML frontmatter describes the
> packages that have changed and their respective semver bump types.»

```md
---
'pkg-a': minor
'pkg-b': patch
---

Summary of the change
```

Автор изменения сам пишет summary **в момент изменения** и сам объявляет тип бампа; ченджлог
собирается при версионировании. Важная оговорка:

> «Not every change requires a changeset […] we **do not recommend** blocking contributions in
> the absence of a changeset.»

Инструмент про monorepo и npm-пакеты: без `package.json`/версий он не нужен, но **идея**
(файл на изменение вместо общей секции) переносима куда угодно и решает конфликты мержа (§8.5).

### 5.5 GitHub Releases

<https://docs.github.com/en/repositories/releasing-projects-on-github/automatically-generated-release-notes>

> «Automatically generated release notes include a list of merged pull requests, a list of
> contributors to the release, and a link to a full changelog.»

Группировка — по лейблам PR (`.github/release.yml`: `changelog.categories[*].title` +
`labels`), то есть категории берутся из метаданных, а не пишутся руками. Тот же минус, что
у всего производного: категория есть только там, где лейбл повесили. KaC отдельно отмечает
непереносимость такого ченджлога (§1).

---

## 6. GNU Coding Standards

Два разных документа, и путать их нельзя.

**ChangeLog** (<https://www.gnu.org/prep/standards/html_node/Change-Logs.html>) — для
разработчиков, «судебная экспертиза» по коду:

> «The purpose of this is so that people investigating bugs in the future will know about the
> changes that might have introduced the bug.»

> «change logs should be detailed enough and accurate enough to provide the information commonly
> required for such _software forensics_» — какие файлы/функции затронуты, что удалено, «What
> was the rationale for a given change, and what were its main ideas?»

Формат записи (<https://www.gnu.org/prep/standards/html_node/Change-Log-Concepts.html>):

> «It is a good idea to start the change log entry with a _header line_: a single line that is a
> complete sentence which summarizes the changeset.»

> «Pay special attention to aspects of the changeset not easily gleaned from the diffs or from the
> names of modified files and functions: the overall idea of the change and the need for it…»

И тут же — важная граница, куда девать «почему»:

> «If you think that a change calls for explanation of _why_ the change was needed […] you're
> probably right. Please put the explanation in comments in the code, where people will see it
> whenever they see the code.»

> «The best place for other kinds of explanation of the change is in the change log entry. In
> particular, comments usually will not say why some code was deleted or moved to another place —
> that belongs to the description of the change which did that.»

То есть: «почему этот код такой» → комментарий в коде; «почему этот код исчез/переехал» →
запись в журнале. Ровно это у нас сформулировано в `docs/agents/code-style.md`, только
в терминах «почему/инвариант/подводный камень».

Длина: «This should be as long as needed to give a clear description» — не «одна строка»,
но и не эссе.

**NEWS** (<https://www.gnu.org/prep/standards/html_node/NEWS-File.html>) — для пользователей:

> «the package should have a file named NEWS which contains a list of user-visible changes worth
> mentioning. In each new release, add items to the front of the file and identify the version
> they pertain to. **Don't discard old items**; leave them in the file after the newer items.»

Если файл распух — старое уезжает в `ONEWS` со ссылкой.

Отдельно: GNU разрешает вообще не держать ChangeLog, если есть VCS: «Projects that maintain
such VCS repositories can decide not to maintain separate change log files, and instead rely on
the VCS to keep the change logs.» — но только при условии «one commit for each logical
changeset» и хороших сообщениях.

**Вывод:** GNU — единственный из источников, который явно разводит «журнал для тех, кто копает
код» и «список для тех, кто пользуется программой». Наш `CHANGELOG.md` сегодня — гибрид: тема
релиза читается пользователем, `→`-абзац — разработчиком.

---

## 7. Debian Policy: `debian/changelog`

<https://www.debian.org/doc/debian-policy/ch-source.html#debian-changelog-debian-changelog>

> «Every source package must include the Debian changelog file, `debian/changelog`. Changes in
> the Debian version of the package should be briefly explained in this file.»

Зачем он существует — не для людей в первую очередь:

> «The format of the `debian/changelog` allows the package building tools to discover which
> version of the package is being built and find out other release-specific information.»

Формат жёсткий: `package (version) distribution(s); urgency=urgency`, дальше строки изменений
(«conventionally each change starts with an asterisk»), последняя строка —
` -- maintainer name <email>  date`, дата в формате RFC 2822 с таймзоной
(`day-of-week, dd month yyyy hh:mm:ss +zzzz`), весь файл в UTF-8. Есть машиночитаемая связка
с баг-трекером: `closes: Bug#nnnnn`.

Две вещи, которых нет в KaC:

- **Время и таймзона обязательны** — не только дата. Для «нескольких релизов в день» это
  готовый ответ (§4 говорит то же про разрешение).
- **Дисциплина истории** (сноска 3): «Mistakes in changelogs are usually best rectified by
  making a new changelog entry rather than "rewriting history" by editing old changelog
  entries.»

Это **прямое расхождение** с KaC («Should you ever rewrite a changelog? Sure») и с GNU NEWS
(«Don't discard old items» — но там про удаление, а не про правку). См. §8.6.

И ещё: Debian-ченджлог пишется про **внутренние** изменения пакета («This includes
modifications made in the Debian package compared to the upstream one as well as other changes
and updates to the package») — потому что читатель у него пакиджер, а не конечный пользователь.
Читатель определяет содержание; это подтверждает KaC-тезис «for humans», просто человек другой.

---

## 8. Сводка: спорные вопросы и что говорят источники

### 8.1 Категории (`Added/Fixed/…`) или темы релиза

| Источник                   | Позиция                                                                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| KaC                        | категории обязательны по смыслу («The same types of changes should be grouped»), набор фиксирован; заголовок — версия+дата, темы нет |
| Debian                     | категорий нет, свободные пункты `*`                                                                                                  |
| GNU                        | категорий нет, запись = changeset                                                                                                    |
| git-cliff / release-please | категории — производная от типов коммитов (`feat`→Features, `fix`→Bug Fixes)                                                         |
| changesets                 | категорий нет, есть summary на изменение                                                                                             |

Расхождения нет: категории — это KaC-специфика, привязанная к версиям и к типам изменений.
Тема релиза — расширение, которого нет ни в одном из первоисточников; она требует человека,
который её сформулирует, и не даёт грепать «все исправления».

Практическая несовместимость: тема и категории конкурируют за одну строку заголовка. Совместить
можно (заголовок с темой + подразделы `Added/Fixed`), но это +2 уровня заголовков на каждый
релиз. У нас 24 релизных раздела на 301 строку — подразделы удвоят файл.

### 8.2 «Почему» и внутренние рефакторинги

- KaC: ченджлог — про «notable changes» для людей; доки и внутренние правки — шум
  («documentation changes, etc.» в списке причин не дампить git log). Прямого запрета на
  рефакторинги нет, есть критерий «заметно ли это читателю».
- release-please: жёстко — «A "chore" or "build" commit is not a releasable unit».
- GNU: **обязательно** про внутреннее — файлы, функции, удаления, «what was the rationale».
- Debian: внутреннее тоже, потому что читатель — пакиджер.
- SemVer/CalVer: молчат (это не их предмет).

Итог: вопрос решается **читателем файла**, а не жанром. Если файл читает владелец проекта и
агент — внутренние записи законны (GNU, Debian). Если чатерс — незаконны (KaC, release-please).
Один файл на две аудитории — источник постоянного спора о том, «надо ли это писать».

Про «почему» конкретно: GNU говорит писать причину изменения, но причину **устройства кода** —
в комментарии к коду, а не в журнал. У нас это уже разведено (`docs/agents/code-style.md`).

### 8.3 Насколько подробно

- KaC: примеры — одна строка на пункт, иногда полстроки («Improve French translation»).
- Debian: «briefly explained».
- GNU: «as long as needed to give a clear description» + перечислить затронутые сущности.
- git-cliff / release-please / conventional-changelog: subject коммита, то есть одна строка
  по построению.

Расхождение реальное: KaC/Debian за краткость, GNU — за полноту «пока не станет ясно».
Компромисс, который предлагают сами источники: краткая строка + ссылка на подробность
(GNU: «include a pointer to that discussion or the issue ID»; Debian: `closes:`).

У нас подробность живёт в `→`-абзаце и в ADR; ссылка на ADR в записи есть не всегда.

### 8.4 «Unreleased» и накопление до релиза

- KaC: да, верхний раздел, при релизе переименовывается. Мотивация — записи делаются по ходу
  и видны до релиза.
- git-cliff: `--unreleased` + `--tag <дата>` + `--prepend` — тот же приём, но раздел
  генерируется, а не пишется.
- release-please: накопление в открытом release PR (аналог Unreleased, но в PR, не в файле).
- changesets: накопления нет — есть N файлов, которые исчезают при версионировании.
- GNU NEWS: «add items to the front» — тоже верхний раздел, версия появляется при релизе.

Четыре из пяти — верхний раздел. Это самая устойчивая часть практики, и у нас она уже есть.

Отличие только в названии: `[Unreleased]` — конвенция, по которой файл узнают; «Внесённые
изменения» — наше название. Не ошибка, но при чтении чужого файла `Unreleased` ищут глазами.

### 8.5 Конфликты при мерже и порядок разделов

**Ни один первоисточник не обсуждает merge-конфликты в ченджлоге.** Это не пробел в
исследовании, а факт: KaC, SemVer, Conventional Commits, GNU и Debian про параллельные ветки
молчат. Ответ есть только в механике инструментов, и он выводится из их устройства:

- **KaC-модель (один изменяемый верхний блок)** — конфликты по построению: две ветки правят
  одни и те же строки в `## Внесённые изменения`. У нас релиз идёт merge-коммитами
  (`Merge spec/purchase-seller: …`), то есть ветки живут параллельно и этот случай реален.
- **changesets-модель (файл на изменение)** — конфликтов почти нет: каждая ветка **добавляет
  новый файл**, общих строк нет; конфликт возможен только при совпадении имени файла
  (имена случайные).
- **git-cliff/release-please (файл производный)** — ручных правок нет вовсе, поэтому и
  конфликтов нет; цена — файл нельзя писать руками.

Порядок разделов источники задают однозначно и одинаково: KaC — «The latest version comes
first»; Debian — `dpkg-parsechangelog` берёт поля из первой записи («most fields are taken from
the first entry (usually the most recent entry)»,
<https://manpages.debian.org/bookworm/dpkg-dev/dpkg-parsechangelog.1.en.html>), а формат требует,
чтобы «title»-строка шла от левого края.

Порядок **внутри** раздела: KaC требует группировки по типам, порядок типов не задан
(в его собственном файле — `Added, Fixed, Changed, Removed`). Порядок пунктов внутри группы
не задан нигде; git-cliff по умолчанию `sort_commits = "oldest"`.

### 8.6 Что делать с историей: переписывать или оставлять

Прямое расхождение:

- **KaC**: «Should you ever rewrite a changelog? Sure. There are always good reasons to improve
  a changelog.» Разрешено, в том числе задним числом.
- **Debian**: «Mistakes in changelogs are usually best rectified by making a new changelog entry
  rather than "rewriting history"». Дописывать, не править.
- **GNU NEWS**: «Don't discard old items» — не удалять; про правку не сказано.
- **SemVer** (правило 3): выпущенное содержимое версии не меняется — про пакет, но вектор тот
  же, что у Debian.

Практический смысл расхождения: KaC оптимизирует **читаемость** («файл должен быть хорошим»),
Debian — **аудируемость** (запись — часть контракта сборки, её нельзя незаметно изменить).
Для журнала деплоев без версий аудируемость важнее: исправлять надо явной записью, а не тихой
правкой, иначе «что было в проде 18 октября» перестаёт быть проверяемым.

Компромисс, который не противоречит никому: опечатки и битые ссылки править молча (это не
смысл), смысловые ошибки — отдельной записью.

### 8.7 Версии и даты для проекта без версий

- SemVer: без объявленного публичного API применять нечего (правило 1).
- KaC: требует «an entry for every single version» и «Mention whether you follow Semantic
  Versioning» — для сайта без версий невыполнимо буквально; ближайший эквивалент — «запись на
  каждый деплой».
- CalVer: дата и есть версия; «There is no substitute for a changelog and policy».
- Debian: дата+время+таймзона обязательны, формат RFC 2822.
- KaC: дата — ISO 8601 (`2017-07-17`), без времени.

Сходятся на трёх вещах: (1) дата в заголовке обязательна, (2) формат однозначный
(ISO-порядок), (3) при нескольких выпусках в день одного дня мало — нужно время (Debian,
CalVer-микро). Наш `YYYY-MM-DD HH:MM` + `Europe/Moscow` удовлетворяет всем трём, кроме
ISO-разделителя `T` (`2026-10-18 14:02` вместо `2026-10-18T14:02`) — это косметика,
но если хочется строгого ISO, менять надо формат заголовков.

---

## 9. Наш CHANGELOG сегодня: сверка с источниками

Факты по файлу (`CHANGELOG.md`, 301 строка, 24 датированных раздела + `## Внесённые изменения`):

| Наша практика                                                         | Ближайший источник                                       | Статус                                                              |
| --------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------- |
| верхний раздел `## Внесённые изменения`, переименовывается при релизе | KaC `[Unreleased]`                                       | **совпадает** по механике, отличается название                      |
| свежее сверху                                                         | KaC, Debian                                              | совпадает                                                           |
| заголовок `YYYY-MM-DD HH:MM — тема`                                   | KaC (дата) + Debian (время) + CalVer (дата как версия)   | совпадает; тема — расширение                                        |
| пункт = слова владельца, затем `→` что сделано                        | GNU (changeset + rationale), Debian (briefly)            | гибрид: «слова владельца» — это KaC-curation, `→` — GNU-подробность |
| время московское                                                      | Debian (таймзона обязательна)                            | совпадает, KaC таймзону не требует                                  |
| категорий нет                                                         | Debian (категорий тоже нет)                              | осознанное отступление от KaC                                       |
| не пишем проверки/аудиты, только изменения продукта                   | KaC «Inconsistent Changes» — требует объявленного охвата | охват объявлен в шапке файла («Что выпущено в прод») — приемлемо    |
| без версий и тегов                                                    | SemVer не применим; CalVer поддерживает                  | нормально                                                           |
| старые разделы не правим (правила молчат)                             | KaC разрешает, Debian советует дописывать                | **не решено** — пробел правил                                       |

Наблюдения по качеству, без ссылок на источники (это про наш файл, не про спеку):

- Длина `→`-абзацев выросла: в разделе `2026-10-17 00:18` один пункт — 200 слов. По шкале
  «KaC-строка ↔ GNU-абзац» это уверенно GNU-край, и просканировать релиз глазами нельзя.
- Раздел `2026-09-30 16:02` — 15 пунктов, почти все внутренние (модули, тесты, pre-commit).
  Это журнал разработчика, а не «что изменилось для чатерса»; вопрос аудитории (§8.2) встаёт
  в полный рост именно на таких релизах.
- В `## Внесённые изменения` пункты идут не в порядке появления, а как получилось; при мерже
  веток это место конфликтует первым.

---

## 10. Выводы для нашего проекта: три варианта

### Вариант A. Оставить как есть + дописать недостающие правила

Ничего не менять в структуре: Unreleased-модель, тема в заголовке, пункт владельца + `→`.

**Плюсы**

- Соответствует источникам там, где они согласны между собой: верхний накопительный раздел,
  свежее сверху, дата в заголовке, «для людей», запись ≠ коммит.
- Ноль миграции: шаг 1 релиза (`alysque-release` переименовывает раздел в скилле, `just release`
  пушит и деплоит) — это ровно KaC-шаг «Unreleased → датированный раздел».
- Слова владельца в записи — это и есть curation из KaC; такого не даст ни один генератор
  из коммитов.
- `→`-абзац закрывает GNU-требование «rationale» без второго файла.

**Минусы**

- Категорий нет: нельзя грепнуть «все исправления» или «что удалили». KaC это прямо
  рекомендует группировать.
- Темы в заголовке — расширение, которого нет ни в одном источнике; зато они несут
  человеческий смысл, которого нет в `Added/Fixed`.
- Один изменяемый блок наверху → конфликты при параллельных ветках (§8.5).
- Длина записей не ограничена ничем: файл растёт быстрее, чем читается.
- Пробел: не сказано, можно ли править старые разделы (§8.6).

**Когда подходит:** если файл читают владелец и агент, а не чатерс; если релизы редкие
(раз в несколько дней) и ветки короткие — как сейчас.

### Вариант B. Тема + минимальная разметка внутри

Заголовок остаётся `дата — тема`, но внутри пункты получают явную пометку аудитории —
например, `видимое:` / `внутреннее:` (или подразделы `### Видимое`, `### Внутреннее`, что ближе
к KaC-группировке, но не копирует его словарь).

**Плюсы**

- Отвечает на главный спор (§8.2) явно, а не «по настроению автора»: внутреннее можно писать,
  но видно, что оно внутреннее.
- Появляется грепабельность (`grep "видимое"` = «что увидит чатерс»), не ломая темы.
- `just release` не трогает подразделы — переименование заголовка работает как раньше.
- Дешевле, чем полноценные шесть KaC-категорий: у нас нет регулярных `Deprecated`/`Removed`/
  `Security`, заводить пустые категории — против KaC («Remove empty sections from CHANGELOG,
  they occupy too much space and create too much noise»).

**Минусы**

- +1 строка на пункт и микрорешение «куда отнести» на каждой записи; при 15 пунктах в разделе
  это заметно.
- KaC-категории всё равно не появляются: «исправление» и «новая фича» по-прежнему в одной куче.
- Риск, что «внутреннее» станет свалкой.

**Когда подходит:** если хочется, чтобы файл отвечал на вопрос «а чатерс это заметит?» без
чтения `→`-абзацев.

### Вариант C. Производный ченджлог из коммитов (`git-cliff` / `release-please`)

Шаг 1 релиза (переименование раздела в скилле `alysque-release`) заменяется на
`git cliff --unreleased --tag <дата> --prepend CHANGELOG.md`; коммиты пишутся по Conventional
Commits, мерж — squash.

**Плюсы**

- Ноль ручной работы и ноль конфликтов: файл — артефакт, а не место правок (§8.5).
- `fail_on_unmatched_commit` / `require_conventional` закрывают «Inconsistent Changes» из KaC
  машинно, а не дисциплиной.
- Датирование и «Unreleased» решаются флагами, а не правилами в `AGENTS.md`.

**Минусы, и они для нас тяжёлые**

- Наши коммиты не conventional: `Звуки гамбы: манифест как правда, публикация без деплоя`,
  `Лоты: общий just lot-add…`. Придётся менять привычку коммитить — иначе `filter_unconventional`
  выкинет почти всё, а `require_conventional` уронит релиз.
- Релиз идёт merge-коммитами, а не squash. И git-cliff («we recommend using squash merges»),
  и release-please («We highly recommend…») называют это условием работы; release-please прямо
  говорит, что override заметок при plain merge не работает.
- Теряется главное: слова владельца и «почему». KaC называет такой файл «dump git logs into
  changelogs» — ровно то, против чего он написан.
- Всё равно нужен один файл-накопитель, если хочется писать записи до релиза (иначе — только
  постфактум из коммитов).

**Когда подходит:** если коммитов станет много и параллельных веток тоже, а записи начнут
отставать. Сейчас — цена выше выгоды.

---

## 11. Рекомендация

Оставить **вариант A** и закрыть три пробела, которые видны при сверке с источниками. Все три —
правки правил в `AGENTS.md` (в этом исследовании ничего не менял), каждая опирается на
конкретный источник:

1. **Бюджет длины записи.** Пункт владельца — как есть (это curation, KaC). `→` — не больше
   ~3 строк: что изменилось для читателя и где подробности. Длинные детали — в ADR/`docs/`, в
   записи — ссылка. Основание: KaC (записи для людей, примеры в одну строку), Debian
   («briefly explained»), GNU («pointer to that discussion»). Сегодняшние записи на 200 слов
   — это GNU-край без GNU-причины: подробности уже есть в ADR.

2. **Правило про историю.** Опечатки и битые ссылки в старых разделах — править молча;
   смысловую ошибку — отдельной записью, а не правкой старого текста. Основание: Debian
   (сноска 3: «best rectified by making a new changelog entry rather than rewriting history»);
   KaC разрешает правку, но для журнала деплоев аудируемость важнее читаемости. Сейчас правила
   молчат — и это единственный пункт, где любой агент поступит по-своему.

3. **Порядок при мерже.** Новые пункты в `## Внесённые изменения` добавляются **в конец**
   раздела, а не в начало; при мерже ветки блок ветки приклеивается целиком, порядок — по
   времени закрытия. Основание: источники конфликты не обсуждают (§8.5), но KaC-модель
   «один изменяемый блок» конфликтует по построению, а внутри релиза порядок пунктов не задан
   ни одним источником — значит, можно зафиксировать свой и перестать спорить на каждом мерже.

Чего делать **не** стоит сейчас:

- Вводить шесть KaC-категорий: у нас нет `Deprecated`/`Removed`/`Security` на регулярной
  основе, пустые категории KaC сам называет шумом; тема в заголовке несёт больше смысла.
- Переходить на производный ченджлог: коммиты не conventional, релиз — merge-коммитами,
  и главная ценность (слова владельца) при этом теряется.
- Вводить версии/теги: SemVer без публичного API не применим, CalVer говорит, что дата версией
  быть может, но «there is no substitute for a changelog».

Если появится вторая долгоживущая ветка или релизы станут ежедневными — вернуться к §10C и
рассмотреть changesets-модель (файл на изменение): она снимает конфликты, не требуя
переписывать коммиты.

---

## Источники (все проверены 27.10.2026)

- Keep a Changelog 1.1.0 — <https://keepachangelog.com/en/1.1.0/>
- Conventional Commits 1.0.0 — <https://www.conventionalcommits.org/en/v1.0.0/>
- Semantic Versioning 2.0.0 — <https://semver.org/>
- Calendar Versioning — <https://calver.org/>
- git-cliff: getting started — <https://git-cliff.org/docs/>; конфиг `git` —
  <https://git-cliff.org/docs/configuration/git>; конфиг `changelog` —
  <https://git-cliff.org/docs/configuration/changelog>; примеры CLI —
  <https://git-cliff.org/docs/usage/examples>
- conventional-changelog — <https://github.com/conventional-changelog/conventional-changelog>
- release-please — <https://github.com/googleapis/release-please>
- changesets — <https://changesets.dev/guide/getting-started>
- GNU Coding Standards: Change Logs —
  <https://www.gnu.org/prep/standards/html_node/Change-Logs.html>; Change Log Concepts —
  <https://www.gnu.org/prep/standards/html_node/Change-Log-Concepts.html>; Style of Change Logs —
  <https://www.gnu.org/prep/standards/html_node/Style-of-Change-Logs.html>; NEWS File —
  <https://www.gnu.org/prep/standards/html_node/NEWS-File.html>
- Debian Policy §4.4 — <https://www.debian.org/doc/debian-policy/ch-source.html#debian-changelog-debian-changelog>;
  `dpkg-parsechangelog(1)` — <https://manpages.debian.org/bookworm/dpkg-dev/dpkg-parsechangelog.1.en.html>
- GitHub: автоматически сгенерированные release notes —
  <https://docs.github.com/en/repositories/releasing-projects-on-github/automatically-generated-release-notes>
