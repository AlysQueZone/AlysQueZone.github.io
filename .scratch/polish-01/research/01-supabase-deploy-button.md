# Кнопка Supabase «Deploy to production»: что делает, вердикт, чеклист

Дата: 2026-09-07. Тикет: `.scratch/polish-01/issues/01-supabase-deploy-button.md`. Тикет не закрыт — решение за ведущей сессией.

## Что делает кнопка (факты из primary sources)

- Тумблер **Deploy to production** находится в **Project Settings → Integrations → GitHub Integration**. При включении Supabase автоматически деплоит изменения при push/merge в настроенную production-ветку GitHub (формулировка свежих версий Studio: обновления production-БД происходят при мерже в сконфигурированную production-ветку, не на каждый push куда угодно).
  Источники: `https://supabase.com/docs/guides/deployment/branching/github-integration` (раздел «Deploying changes to production»); PR `supabase/supabase#44138` (уточнение wording'а: merge-based deployments); PR `supabase/supabase#41817` (при включённом тумблере merge git-трекаемой base-ветки из дашборда блокируется — прод-деплой только через git).
- **Какая ветка — production.** Со стороны Supabase production — всегда базовый проект, от которого создаются все бранчи (сменить нельзя). Со стороны GitHub — ветка, указанная в настройках интеграции (обычно `main`), её можно поменять на странице Integrations.
  Источник: `https://supabase.com/docs/guides/deployment/branching/troubleshooting` (раздел «Changing production branch»).
- **Что триггерит apply.** Supabase следит за коммитами/ветками/PR в подключённом репозитории (нужен закоммиченный `supabase/` и правильно указанный Working directory — `.`, если `supabase/` в корне). На каждый push/merge в production-ветку запускается deploy workflow: Clone → Pull → Health → Configure → Migrate → Seed → Deploy. Применяются только ещё не применённые миграции.
  Источники: github-integration doc; `https://supabase.com/docs/guides/deployment/branching` (раздел «Deploying to production», DAG workflow).
- **Что именно применяется.** Только три вещи: (1) новые миграции из `supabase/migrations`, (2) Edge Functions, объявленные в `config.toml`, (3) Storage buckets из `config.toml`. **Всё остальное — API, Auth, seed-файлы — по умолчанию игнорируется.** Изменения данных в seed-файлах в production не мержатся.
  Источник: github-integration doc, раздел «Deploying changes to production».
- **Ответ на «применит ли миграции, если их не применяли вручную» — да.** В этом смысл кнопки; официальный чеклист going-into-prod прямо рекомендует её вместо ручного `supabase db push` с локальной машины ради консистентности.
  Источник: `https://supabase.com/docs/guides/deployment/going-into-prod`.
- **Дрейф схемы.** Правки через Dashboard/SQL Editor без `supabase db pull` расходятся с историей миграций → конфликты/падение деплоя. Merge preview-ветки в production создаёт дрейф относительно ещё не смерженных preview-веток; лечится merge/rebase от production-ветки + корректным порядком timestamp'ов миграций (применяются последовательно).
  Источник: troubleshooting doc («When a preview branch is merged into the production branch, it creates a schema drift…»).
- **Защита.** Доки настоятельно рекомендуют включить required status check Supabase-интеграции в настройках репозитория GitHub — тогда PR с битыми миграциями нельзя смержить.
  Источник: github-integration doc, «Preventing migration failures».
- **Цена/план.** Прямой деплой из GitHub работает на любом плане (Free ок), доплат не требует. Preview-бранчи на каждый PR — Pro-функция, но кнопке Deploy она не нужна.
  Источники: `https://supabase.com/docs/guides/deployment/branching`; going-into-prod («If you're on the Pro Plan, consider enabling branching…» — отдельно от Deploy).

## Что это значит для нашего проекта (контекст, без изменения кода)

- `supabase/` уже лежит в корне репо → Working directory `.`, три файла миграций (`shared_lots`, `realtime_publication`, `seed_real_lots`). Кнопке есть что применять.
- Нюанс: `20260907110628_seed_real_lots.sql` — это **миграция**, а не `seed.sql`. Игнор seed-файлов на неё не распространяется: при включении Deploy она применится на production при следующем мерже, если ещё не применена. Проверить её идемпотентность до включения.
- Сид реальных лотов, внесённый через SQL Editor вручную, кнопка не затрет (seed-файлы игнорируются), но и расхождение «ручные правки vs миграции» — главный источник дрейфа у нас: миграции правим руками.

## Вердикт: ВКЛЮЧАТЬ, но только после чеклиста

Кнопка соответствует нашему флоу (статика, ноль бюджета, без своего сервера, ручные миграции): бесплатна, убирает ручной `db push`, seed-файлы игнорит. Но включать на дрейфующей истории — получить упавший автодеплой в production. Поэтому: сначала чеклист, потом тумблер.

## Чеклист безопасного включения

1. `supabase db pull` (или `supabase db diff`) локально и сверить, что production-схема = файлы в `supabase/migrations`; закоммитить результат. Без дрейфа дальше не идти.
2. Проверить `supabase/migrations/20260907110628_seed_real_lots.sql` на идемпотентность/безопасность повторного применения (INSERT'ы — через `ON CONFLICT DO NOTHING` или guard); сид реальных лотов не должен дублироваться при apply.
3. Подключить GitHub-интеграцию: Project Settings → Integrations → Authorize GitHub → выбрать репозиторий → Working directory `.`.
4. В настройках интеграции указать production-ветку (`main`), включить **Deploy to production**.
5. В GitHub repo settings включить required status check от Supabase-интеграции (блок мержа при битых миграциях).
6. Тестовый мерж мелкой миграции → проверить в дашборде, что deploy workflow зелёный (при падении — чинить миграцию, не давить руками в Editor).
7. Дальше правило: схему меняем только миграциями в репо; правки из Dashboard/SQL Editor сразу забираем через `db pull`, иначе вернётся дрейф.
