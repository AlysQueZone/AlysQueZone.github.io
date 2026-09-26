#!/usr/bin/env just --justfile
# vim:ft=just
# Cheat Sheet настройки:  https://cheatography.com/linux-china/cheat-sheets/justfile/
# Подробная документация: https://just.systems/man/en/quick-start.html
# -----------------------------------------------------------------------------
# Settings
# -----------------------------------------------------------------------------

set quiet
# Читать корневой .env в переменные окружения рецептов (нужно db-vault для
# TELEGRAM_*; SECRET/DSN-строки python-скрипты и так читают из .env сами).
set dotenv-load

# -----------------------------------------------------------------------------
# Variables
# -----------------------------------------------------------------------------

foo := "bar"

# -----------------------------------------------------------------------------
# Aliases:
# -----------------------------------------------------------------------------

alias lg := lazygit
alias r := run
alias db-rest := db-reset

# -----------------------------------------------------------------------------
# Recipes
# -----------------------------------------------------------------------------
# -------------------------------------
# Common
# -------------------------------------

# Вывод всех just recipes
[default]
_default:
    @just --list

# -------------------------------------
# Запуск проекта
# -------------------------------------

run:
    npm run dev

# -------------------------------------
# Качество кода
# -------------------------------------

lint:
    npm run lint

format:
    npm run format

# -------------------------------------
# Контент лотов
# -------------------------------------

# Синк content/lots.toml в прод (Supabase)
lots-sync:
    python3 scripts/lots_sync.py

# Пересобрать supabase/seed.sql из манифеста
lots-seed:
    python3 scripts/lots_sync.py --write-seed

# Рекомендуемый title карточки: ник из имени файла по реестру ников
# Пример: just lots-title privets/Onghanntto.mp4
lots-title *args:
    python3 scripts/lots_title.py {{args}}

# Синк ников чатерсов из чата VOD в content/chatters.toml
# Пример: just chatters-sync --vod 2864275043
chatters-sync *args:
    python3 scripts/chatters_sync.py {{args}}

# Приём заявки на привет: id -> скачивание -> медиа -> карточка -> синк -> лот.
# Безопасный первый заход: just submission 12 --check (скачает и покажет, стоп).
# Полный проход: just submission 12; --force — осознанный обход дубль-гейта.
submission *args:
    python3 scripts/submission.py {{args}}

# Отказ по заявке без выплаты: rejected (по умолчанию) или duplicate.
# Пример: just submission-reject 12 --status duplicate
submission-reject *args:
    python3 scripts/submission.py reject {{args}}

# Повторная выплата награды по уже принятой заявке: путь восстановления,
# если выплата упала после приёма. Идемпотентно (сервер не платит дважды).
# Пример: just submission-reward 12
submission-reward *args:
    python3 scripts/submission.py reward {{args}}

# -------------------------------------
# Локальная разработка (Supabase + фронт)
# -------------------------------------

# Поднять локальный Supabase и до-накатить миграции (данные сохраняются)
db-up:
    ./node_modules/.bin/supabase start
    ./node_modules/.bin/supabase migration up --local

# Остановить локальный Supabase
db-stop:
    ./node_modules/.bin/supabase stop

# Чистая локальная БД: миграции + сид из content/lots.toml (данные теряются).
# --write-seed пишет только файл supabase/seed.sql; в локальную БД его заливает db reset.
# Секреты Vault reset стирает — db-vault в конце их возвращает.
db-reset: db-up
    python3 scripts/lots_sync.py --write-seed
    ./node_modules/.bin/supabase db reset
    just db-vault

# Залить Telegram-секреты в локальный Vault из .env (идемпотентно; пусто — no-op).
# Значения идут в psql через stdin, не в argv; прод-Vault не затрагивается.
db-vault:
    #!/usr/bin/env bash
    set -euo pipefail
    if [ -z "${TELEGRAM_BOT_TOKEN:-}" ] || [ -z "${TELEGRAM_ADMIN_CHAT_ID:-}" ]; then
      echo 'TELEGRAM_BOT_TOKEN/TELEGRAM_ADMIN_CHAT_ID не заданы в .env — локальные уведомления молчат' >&2
      exit 0
    fi
    db_container=$(docker ps -q --filter 'name=supabase_db_' | head -1)
    [ -n "$db_container" ] || { echo 'Локальный Supabase не поднят — сначала just db-up' >&2; exit 1; }
    docker exec -i "$db_container" psql -U postgres -d postgres -v ON_ERROR_STOP=1 <<SQL
    select vault.create_secret('$TELEGRAM_BOT_TOKEN', 'telegram_bot_token', 'local dev')
      where not exists (select 1 from vault.secrets where name = 'telegram_bot_token');
    select vault.update_secret(
      (select id from vault.secrets where name = 'telegram_bot_token'), '$TELEGRAM_BOT_TOKEN')
      where exists (select 1 from vault.secrets where name = 'telegram_bot_token');
    select vault.create_secret('$TELEGRAM_ADMIN_CHAT_ID', 'telegram_admin_chat_id', 'local dev')
      where not exists (select 1 from vault.secrets where name = 'telegram_admin_chat_id');
    select vault.update_secret(
      (select id from vault.secrets where name = 'telegram_admin_chat_id'), '$TELEGRAM_ADMIN_CHAT_ID')
      where exists (select 1 from vault.secrets where name = 'telegram_admin_chat_id');
    SQL
    echo 'Локальный Vault: telegram-секреты обновлены'

# Dev-сервер на локальной БД: вначале just db-up, затем astro против 127.0.0.1:54321.
# `--force` заменяет уже запущенный astro dev (порт 4321 один) — этот сервер и должен победить.
run-local: db-up db-vault
    #!/usr/bin/env bash
    set -euo pipefail
    status_env=$(./node_modules/.bin/supabase status -o env)
    url=$(printf '%s\n' "$status_env" | sed -n 's/^\(API_URL\|SUPABASE_URL\)="\(.*\)"/\2/p' | head -1)
    key=$(printf '%s\n' "$status_env" | sed -n 's/^\(PUBLISHABLE_KEY\|ANON_KEY\)="\(.*\)"/\2/p' | head -1)
    : "${url:=http://127.0.0.1:54321}"
    [ -n "$key" ] || { echo 'Не нашёл publishable-ключ локального стека (supabase status -o env)' >&2; exit 1; }
    echo "Локальная БД: $url"
    PUBLIC_SUPABASE_URL="$url" PUBLIC_SUPABASE_PUBLISHABLE_KEY="$key" npm run dev -- --force

# -------------------------------------
# Релиз
# -------------------------------------

# Push/deploy идут от аккаунта-владельца AlysQueZone (у активного может не
# быть прав); прежний активный аккаунт возвращается в конце даже при ошибке.

# Релиз: push main (миграции Supabase) + deploy gh-pages
release:
    #!/usr/bin/env bash
    set -euo pipefail
    prev=$(gh api user --jq .login)
    trap 'gh auth switch --user "$prev" >/dev/null 2>&1 || true' EXIT
    gh auth switch --user AlysQueZone
    git push origin main
    npm run deploy

# -------------------------------------
# Другое
# -------------------------------------

# LazyGit
lazygit:
    lazygit
