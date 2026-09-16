#!/usr/bin/env just --justfile
# vim:ft=just
# Cheat Sheet настройки:  https://cheatography.com/linux-china/cheat-sheets/justfile/
# Подробная документация: https://just.systems/man/en/quick-start.html
# -----------------------------------------------------------------------------
# Settings
# -----------------------------------------------------------------------------

set quiet

# -----------------------------------------------------------------------------
# Variables
# -----------------------------------------------------------------------------

foo := "bar"

# -----------------------------------------------------------------------------
# Aliases:
# -----------------------------------------------------------------------------

alias lg := lazygit
alias r := run

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

# Синк ников чатерсов из чата VOD в content/chatters.toml
# Пример: just chatters-sync --vod 2864275043
chatters-sync *args:
    python3 scripts/chatters_sync.py {{args}}

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
