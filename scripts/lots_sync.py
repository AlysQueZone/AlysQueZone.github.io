#!/usr/bin/env python3
"""Синк контента лотов из content/lots.toml в БД (stdlib, без зависимостей).

Использование (из корня репо):
  python3 scripts/lots_sync.py --dry-run     # показать план без записи
  python3 scripts/lots_sync.py               # применить к проду
  python3 scripts/lots_sync.py --write-seed  # пересобрать supabase/seed.sql

Правила записи:
  - слаг есть в манифесте, но не в БД -> POST (slug, title, price, video_url),
    владелец NULL (первый покупатель станет первым владельцем);
  - слаг уже есть -> PATCH только title/video_url; price/owner_* не трогаем —
    это runtime-состояние триггеров покупки (docs/agents/economy.md);
  - --dry-run и --write-seed секретов не требуют (dry-run читает БД, если есть ключ).

Ключ и ref: env SUPABASE_SERVICE_ROLE_KEY (алиасы SUPABASE_SECRET_KEY,
SERVICE_ROLE_KEY) и PUBLIC_SUPABASE_URL, иначе те же имена из .env файла.
Секреты НИКОГДА не печатаются.
"""

import argparse
import json
import os
import sys
import tomllib
import urllib.error
import urllib.parse
import urllib.request

from supabase_common import load_dotenv, project_base, resolve, resolve_service_key

FIELDS = ("slug", "title", "price", "video_url")


def read_manifest(path):
    """Читает и валидирует манифест; возвращает список лотов."""
    try:
        with open(path, "rb") as fh:
            data = tomllib.load(fh)
    except FileNotFoundError:
        raise SystemExit("Нет манифеста: %s" % path)
    lots = data.get("lots")
    if not isinstance(lots, list) or not lots:
        raise SystemExit("Манифест пуст: %s" % path)
    seen = set()
    for lot in lots:
        if not isinstance(lot, dict):
            raise SystemExit("Лот не таблица: %r" % lot)
        for field in FIELDS:
            if not lot.get(field):
                raise SystemExit("Лот без %s: %r" % (field, lot))
        if not isinstance(lot["price"], int) or lot["price"] <= 0:
            raise SystemExit("Некорректная цена у %s: %r" % (lot["slug"], lot["price"]))
        if lot["slug"] in seen:
            raise SystemExit("Дубль slug: %s" % lot["slug"])
        seen.add(lot["slug"])
    return lots


def sql_str(value):
    return "'" + str(value).replace("'", "''") + "'"


def write_seed(lots, path):
    """Пересобирает supabase/seed.sql из манифеста (локальный db reset)."""
    lines = [
        "-- Сгенерировано scripts/lots_sync.py --write-seed из content/lots.toml.",
        "-- Руками не править: правь манифест и перегенерируй.",
        "-- Локальный сид (supabase db reset); на проде не применяется.",
        "insert into public.lots (slug, title, price, video_url) values",
    ]
    rows = [
        "  (%s, %s, %d, %s)"
        % (
            sql_str(lot["slug"]),
            sql_str(lot["title"]),
            lot["price"],
            sql_str(lot["video_url"]),
        )
        for lot in lots
    ]
    lines.append(",\n".join(rows))
    lines.append("on conflict (slug) do nothing;")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")


def request(key, method, url, payload=None, prefer=None):
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    headers = {"apikey": key, "Authorization": "Bearer " + key}
    if data is not None:
        headers["Content-Type"] = "application/json"
    if prefer:
        headers["Prefer"] = prefer
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", "replace")[:300]
        return exc.code, body


def fetch_existing(key, base):
    status, body = request(
        key, "GET", "%s/rest/v1/lots?select=slug,title,video_url" % base
    )
    if status != 200:
        raise SystemExit("GET lots: %s %s" % (status, body))
    return {row["slug"]: row for row in json.loads(body)}


def plan(lot, existing):
    """Что сделать с лотом: ('insert', body) либо ('update', patch) либо None."""
    slug = lot["slug"]
    if slug not in existing:
        return (
            "insert",
            {
                "slug": slug,
                "title": lot["title"],
                "price": lot["price"],
                "video_url": lot["video_url"],
            },
        )
    cur = existing[slug]
    patch = {}
    if cur.get("title") != lot["title"]:
        patch["title"] = lot["title"]
    if cur.get("video_url") != lot["video_url"]:
        patch["video_url"] = lot["video_url"]
    return ("update", patch) if patch else None


def main():
    root = os.getcwd()
    ap = argparse.ArgumentParser(description="Sync content/lots.toml to public.lots.")
    ap.add_argument("--manifest", default=os.path.join(root, "content", "lots.toml"))
    ap.add_argument("--seed", default=os.path.join(root, "supabase", "seed.sql"))
    ap.add_argument("--env", default=os.path.join(root, ".env"))
    ap.add_argument("--dry-run", action="store_true", help="Только план, без записи")
    ap.add_argument(
        "--write-seed", action="store_true", help="Пересобрать supabase/seed.sql"
    )
    args = ap.parse_args()

    lots = read_manifest(args.manifest)

    if args.write_seed:
        write_seed(lots, args.seed)
        print("seed: %s (%d лотов)" % (args.seed, len(lots)))

    if args.write_seed and not args.dry_run:
        return 0

    dotenv = load_dotenv(args.env)
    key = resolve_service_key(dotenv)
    base = project_base(resolve("PUBLIC_SUPABASE_URL", dotenv))
    if not key or not base:
        print(
            "Нет ключа/URL: задай SUPABASE_SERVICE_ROLE_KEY и PUBLIC_SUPABASE_URL "
            "в окружении или в %s" % args.env
        )
        return 1

    existing = fetch_existing(key, base)
    created = updated = 0
    for lot in lots:
        action = plan(lot, existing)
        if not action:
            continue
        kind, payload = action
        if kind == "insert":
            created += 1
            print("+ %s" % lot["slug"])
            if not args.dry_run:
                status, body = request(
                    key,
                    "POST",
                    "%s/rest/v1/lots" % base,
                    payload,
                    prefer="return=minimal",
                )
                if status not in (200, 201):
                    raise SystemExit("INSERT %s: %s %s" % (lot["slug"], status, body))
        else:
            updated += 1
            print("~ %s (%s)" % (lot["slug"], ", ".join(sorted(payload))))
            if not args.dry_run:
                url = "%s/rest/v1/lots?slug=eq.%s" % (
                    base,
                    urllib.parse.quote(lot["slug"], safe=""),
                )
                status, body = request(
                    key, "PATCH", url, payload, prefer="return=minimal"
                )
                if status not in (200, 204):
                    raise SystemExit("PATCH %s: %s %s" % (lot["slug"], status, body))

    if args.dry_run:
        print("план: +%d новых, ~%d обновлений" % (created, updated))
        return 0

    print("записано: +%d новых, ~%d обновлений" % (created, updated))
    after = fetch_existing(key, base)
    drift = [
        lot["slug"]
        for lot in lots
        if lot["slug"] not in after
        or after[lot["slug"]].get("title") != lot["title"]
        or after[lot["slug"]].get("video_url") != lot["video_url"]
    ]
    if drift:
        print("РАСХОЖДЕНИЕ: %s" % ", ".join(drift))
        return 1
    print("сверка: все %d лотов совпадают с манифестом" % len(lots))
    return 0


if __name__ == "__main__":
    sys.exit(main())
