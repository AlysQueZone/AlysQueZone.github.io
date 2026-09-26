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
# Полный проход: just submission 12
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
