#!/usr/bin/env python3
"""Звуки гамбы: синк манифеста в БД и добавление новых фраз (stdlib, ffmpeg).

Использование (из корня репо):
  python3 scripts/sounds_sync.py sync --dry-run          # показать план
  python3 scripts/sounds_sync.py sync                    # применить к проду
  python3 scripts/sounds_sync.py gen                     # сид + фолбэк из манифеста
  python3 scripts/sounds_sync.py check                   # сид/фолбэк не устарели?
  python3 scripts/sounds_sync.py add <файл|URL> --pool spin [--name имя]

Правила записи: манифест `content/sounds.toml` — источник правды целиком;
строки, которых в нём нет, из таблицы удаляются (у звука нет рантайм-состояния,
в отличие от цены/владельца лота). Пустой манифест — отказ: опечатка не должна
выкосить колесо.

Секреты НИКОГДА не печатаются: ключ и ref берём из env SUPABASE_SERVICE_ROLE_KEY
(алиасы SUPABASE_SECRET_KEY, SERVICE_ROLE_KEY) и PUBLIC_SUPABASE_URL, иначе из
.env (по умолчанию ./.env — запускать из корня репо).
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import tomllib
import urllib.error
import urllib.parse
import urllib.request

from storage_upload import upload_file, verify_public
from supabase_common import (
    load_dotenv,
    project_base,
    request_json,
    resolve,
    resolve_service_key,
    sql_str,
)

POOLS = ("spin", "win", "jackpot", "lose")
PRINT_WIDTH = 100
BUCKET = "media"
MEDIA_SUFFIXES = (
    ".mp3",
    ".mp4",
    ".webm",
    ".mov",
    ".mkv",
    ".m4v",
    ".m4a",
    ".aac",
    ".ogg",
    ".wav",
)
SOUNDS_DEST = "sounds/"
MANIFEST = os.path.join("content", "sounds.toml")
SEED = os.path.join("supabase", "seed-sounds.sql")
FALLBACK = os.path.join("src", "lib", "gamba-sounds.gen.ts")


def read_manifest(path):
    """Читает и валидирует манифест; возвращает список пар pool/file."""
    try:
        with open(path, "rb") as fh:
            data = tomllib.load(fh)
    except FileNotFoundError:
        raise SystemExit("Нет манифеста: %s" % path)
    rows = data.get("sounds")
    if not isinstance(rows, list) or not rows:
        raise SystemExit("Манифест пуст: %s" % path)
    seen = set()
    entries = []
    for row in rows:
        if not isinstance(row, dict):
            raise SystemExit("Звук не таблица: %r" % row)
        pool, name = row.get("pool"), row.get("file")
        if not pool or not name:
            raise SystemExit("Звук без pool/file: %r" % row)
        if pool not in POOLS:
            raise SystemExit(
                "Неизвестный пул у %s: %r (есть: %s)" % (name, pool, ", ".join(POOLS))
            )
        if (pool, name) in seen:
            raise SystemExit("Дубль %s/%s" % (pool, name))
        seen.add((pool, name))
        entries.append({"pool": pool, "file": name})
    for pool in POOLS:
        if not any(e["pool"] == pool for e in entries):
            raise SystemExit(
                "Пул без звуков: %s — пустой пул молчит на своей стадии" % pool
            )
    return entries


def seed_sql(entries):
    lines = [
        "-- Сгенерировано scripts/sounds_sync.py gen из content/sounds.toml.",
        "-- Руками не править: правь манифест и перегенерируй.",
        "-- Локальный сид (supabase db reset); на проде не применяется.",
        "insert into public.gamba_sounds (pool, file) values",
    ]
    rows = ["  (%s, %s)" % (sql_str(e["pool"]), sql_str(e["file"])) for e in entries]
    lines.append(",\n".join(rows))
    lines.append("on conflict (pool, file) do nothing;")
    return "\n".join(lines) + "\n"


def fallback_ts(entries):
    """Фолбэк пулов на время сборки: играет, пока клиент не прочитал БД.

    Массивы пекутся в стиле prettier (printWidth 100): короткий — одной
    строкой, длинный — по элементу на строку. Иначе `just check` краснеет на
    `format:check`: генерируемый файл форматирование не обходит.
    """
    lines = [
        "// Сгенерировано scripts/sounds_sync.py gen из content/sounds.toml.",
        "// Руками не править: правь манифест и перегенерируй.",
        "// Фолбэк пулов: звучит, пока клиент не получил список из БД (docs/adr/0011).",
        "export const GAMBA_SOUND_POOLS_FALLBACK = {",
    ]
    for pool in POOLS:
        files = [e["file"] for e in entries if e["pool"] == pool]
        one = "  %s: [%s]," % (pool, ", ".join("'%s'" % f for f in files))
        if len(one) <= PRINT_WIDTH:
            lines.append(one)
        else:
            lines.append("  %s: [" % pool)
            lines.extend("    '%s'," % f for f in files)
            lines.append("  ],")
    lines.append("} as const;")
    return "\n".join(lines) + "\n"


def write_if_changed(path, text):
    """Пишет файл, только если содержимое изменилось; True — файл обновлён."""
    try:
        with open(path, "r", encoding="utf-8") as fh:
            if fh.read() == text:
                return False
    except FileNotFoundError:
        pass
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)
    return True


def cmd_gen(entries):
    """Пересобирает генерируемые файлы (локальный сид и фолбэк сборки)."""
    for path, text in ((SEED, seed_sql(entries)), (FALLBACK, fallback_ts(entries))):
        print(
            "%s: %s"
            % ("обновлён" if write_if_changed(path, text) else "без правок", path)
        )
    return 0


def cmd_check(entries):
    """Гейт: генерируемые файлы должны совпадать с манифестом."""
    stale = []
    for path, text in ((SEED, seed_sql(entries)), (FALLBACK, fallback_ts(entries))):
        try:
            with open(path, "r", encoding="utf-8") as fh:
                if fh.read() != text:
                    stale.append(path)
        except FileNotFoundError:
            stale.append(path)
    if stale:
        print("Устарело (пересобрать: just sounds-gen): %s" % ", ".join(stale))
        return 1
    print("сид и фолбэк совпадают с манифестом (%d звуков)" % len(entries))
    return 0


def fetch_existing(key, base):
    status, body = request_json(
        key, "GET", "%s/rest/v1/gamba_sounds?select=pool,file" % base
    )
    if status == 404:
        raise SystemExit(
            "Таблицы public.gamba_sounds в БД нет: сначала релиз миграции (скилл alysque-release)."
        )
    if status != 200:
        raise SystemExit("GET gamba_sounds: %s %s" % (status, body))
    return {(row["pool"], row["file"]) for row in json.loads(body)}


def sync_to_db(entries, key, base, dry_run):
    """Манифест -> таблица: новых insert, лишних delete, в конце сверка."""
    existing = fetch_existing(key, base)
    wanted = {(e["pool"], e["file"]) for e in entries}
    to_add = [e for e in entries if (e["pool"], e["file"]) not in existing]
    to_del = sorted(existing - wanted)
    for e in to_add:
        print("+ %s/%s" % (e["pool"], e["file"]))
    for pool, name in to_del:
        print("- %s/%s" % (pool, name))
    if dry_run:
        print("план: +%d новых, -%d лишних" % (len(to_add), len(to_del)))
        return 0
    for e in to_add:
        status, body = request_json(
            key,
            "POST",
            "%s/rest/v1/gamba_sounds" % base,
            {"pool": e["pool"], "file": e["file"]},
            prefer="return=minimal",
        )
        if status not in (200, 201):
            raise SystemExit(
                "INSERT %s/%s: %s %s" % (e["pool"], e["file"], status, body)
            )
    for pool, name in to_del:
        query = "pool=eq.%s&file=eq.%s" % (
            urllib.parse.quote(pool, safe=""),
            urllib.parse.quote(name, safe=""),
        )
        status, body = request_json(
            key, "DELETE", "%s/rest/v1/gamba_sounds?%s" % (base, query)
        )
        if status not in (200, 204):
            raise SystemExit("DELETE %s/%s: %s %s" % (pool, name, status, body))
    after = fetch_existing(key, base)
    drift = sorted(after ^ wanted)
    if drift:
        print("РАСХОЖДЕНИЕ: %s" % ", ".join("%s/%s" % pair for pair in drift))
        return 1
    print("записано: +%d новых, -%d лишних" % (len(to_add), len(to_del)))
    print("сверка: все %d звуков совпадают с манифестом" % len(entries))
    return 0


def creds(env):
    dotenv = load_dotenv(env)
    key = resolve_service_key(dotenv)
    base = project_base(resolve("PUBLIC_SUPABASE_URL", dotenv))
    return key, base


# ---------------------------------------------------------------------------
# add: файл или URL -> mp3 -> Storage -> манифест -> сид/фолбэк -> синк
# ---------------------------------------------------------------------------


def default_name(pool, path):
    """Имя по умолчанию: gamba-<пул>-<слаг из имени источника>."""
    stem = os.path.splitext(os.path.basename(path))[0]
    slug = re.sub(r"[^a-z0-9]+", "-", stem.lower()).strip("-")
    return "gamba-%s-%s.mp3" % (pool, slug or "sound")


def download(url, workdir):
    """Клип или прямая ссылка -> локальный файл.

    yt-dlp берёт и страницы клипов (`twitch.tv/.../clip/...`), и прямые ссылки;
    urllib остаётся запасным путём для прямой ссылки, если yt-dlp не стоит.
    """
    os.makedirs(workdir, exist_ok=True)
    out_tmpl = os.path.join(workdir, "source.%(ext)s")
    ytdlp = None
    try:
        ytdlp = subprocess.run(
            [
                "yt-dlp",
                "--no-playlist",
                "--no-progress",
                "-f",
                "bestaudio/best",
                "-o",
                out_tmpl,
                url,
            ],
            capture_output=True,
            text=True,
        )
    except FileNotFoundError:
        pass
    if ytdlp is not None and ytdlp.returncode == 0:
        found = find_download(workdir)
        if found:
            print("скачано (yt-dlp): %s" % os.path.basename(found))
            return found
    path = urllib.parse.urlsplit(url).path.lower()
    if path.endswith(MEDIA_SUFFIXES):
        target = os.path.join(workdir, "source" + os.path.splitext(path)[1])
        direct_download(url, target)
        print("скачано (прямая ссылка): %s" % os.path.basename(target))
        return target
    if ytdlp is None:
        raise SystemExit("Нет yt-dlp — поставь его или дай прямую ссылку на медиафайл")
    tail = (ytdlp.stderr or "").strip().splitlines()
    raise SystemExit(
        "Ссылка не скачалась: %s" % (tail[-1] if tail else "yt-dlp не справился")
    )


def direct_download(url, target):
    req = urllib.request.Request(url, headers={"User-Agent": "AlysQueZone/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=120) as resp, open(target, "wb") as fh:
            shutil.copyfileobj(resp, fh)
    except urllib.error.HTTPError as exc:
        raise SystemExit("Не скачалось (%s): %s" % (exc.code, url))
    except urllib.error.URLError as exc:
        raise SystemExit("Не скачалось (%s): %s" % (exc.reason, url))
    if not os.path.getsize(target):
        raise SystemExit("Пустой файл: %s" % url)


def find_download(workdir):
    for name in sorted(os.listdir(workdir)):
        if name.startswith("source.") and not name.endswith(".part"):
            full = os.path.join(workdir, name)
            if os.path.isfile(full) and os.path.getsize(full) > 0:
                return full
    return None


def to_mp3(src, out):
    """Звук из клипа: как в скилле лотов — `ffmpeg -vn -codec:a libmp3lame`."""
    cmd = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        src,
        "-vn",
        "-codec:a",
        "libmp3lame",
        "-q:a",
        "5",
        out,
    ]
    try:
        subprocess.run(cmd, check=True)
    except FileNotFoundError:
        raise SystemExit("Нет ffmpeg — он нужен, чтобы вытащить звук из клипа")
    except subprocess.CalledProcessError as exc:
        raise SystemExit("ffmpeg упал (%s): %s" % (exc.returncode, src))
    if not os.path.getsize(out):
        raise SystemExit("Пустой mp3 после конвертации: %s" % src)


def append_manifest(path, pool, name):
    """Дописывает блок в конец своей группы пула (файл читают глазами)."""
    with open(path, "r", encoding="utf-8") as fh:
        text = fh.read()
    # Ключ — пара (пул, файл): одна фраза вправе стоять в двух пулах.
    if (pool, name) in {
        (e["pool"], e["file"]) for e in tomllib.loads(text).get("sounds", [])
    }:
        raise SystemExit("Уже в манифесте: %s/%s" % (pool, name))
    lines = text.splitlines()
    block = ["", "[[sounds]]", 'pool = "%s"' % pool, 'file = "%s"' % name]
    insert_at = None
    starts = [i for i, line in enumerate(lines) if line.strip() == "[[sounds]]"]
    for start in reversed(starts):
        end = len(lines)
        for j in range(start + 1, len(lines)):
            if lines[j].strip().startswith("["):
                end = j
                break
        while end > 0 and lines[end - 1].strip() == "":
            end -= 1
        if 'pool = "%s"' % pool in "\n".join(lines[start + 1 : end]):
            insert_at = end
            break
    if insert_at is None:
        if lines and lines[-1].strip():
            lines.append("")
        lines.extend(block[1:])
    else:
        lines[insert_at:insert_at] = block
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")


def archive_source(root, local):
    """Исходник из privets/ уезжает в privets/already added/ (как у лотов)."""
    privets = os.path.abspath(os.path.join(root, "privets"))
    source = os.path.abspath(local)
    rel = os.path.relpath(source, privets)
    if rel.startswith("..") or rel.split(os.sep)[0] == "already added":
        return
    already = os.path.join(privets, "already added")
    os.makedirs(already, exist_ok=True)
    shutil.move(source, os.path.join(already, os.path.basename(source)))
    print("исходник: privets/%s -> privets/already added/" % rel)


def cmd_add(args):
    root = os.getcwd()
    manifest = args.manifest
    entries = read_manifest(manifest)
    key, base = creds(args.env)
    if not key or not base:
        print(
            "Нет ключа/URL: задай SUPABASE_SERVICE_ROLE_KEY и PUBLIC_SUPABASE_URL в .env"
        )
        return 1

    tmp = tempfile.mkdtemp(prefix="sound-")
    if re.match(r"^https?://", args.source):
        # Имя по умолчанию — из ссылки: yt-dlp кладёт всё в source.<ext>.
        name_hint = (
            os.path.basename(urllib.parse.urlsplit(args.source).path) or args.source
        )
        local = download(args.source, tmp)
        keep_source = None
    else:
        local = args.source
        if not os.path.isfile(local):
            raise SystemExit("Нет файла: %s" % local)
        name_hint = local
        keep_source = local

    name = args.name or default_name(args.pool, name_hint)
    if not name.endswith(".mp3"):
        name += ".mp3"
    if (args.pool, name) in {(e["pool"], e["file"]) for e in entries}:
        raise SystemExit("Уже в манифесте: %s/%s" % (args.pool, name))

    mp3 = os.path.join(tmp, name)
    if local.lower().endswith(".mp3"):
        shutil.copyfile(local, mp3)
    else:
        to_mp3(local, mp3)

    dest = SOUNDS_DEST + name
    ok, status = upload_file(key, base, BUCKET, dest, mp3, "audio/mpeg", True)
    print("%s -> %s/%s : %s" % (name, BUCKET, dest, status))
    if not ok:
        raise SystemExit("Залив не удался: %s" % status)
    ok, status = verify_public(base, BUCKET, dest)
    print("public %s/%s : %s" % (BUCKET, dest, status))
    if not ok:
        raise SystemExit("Публичный URL не отвечает: %s" % status)

    append_manifest(manifest, args.pool, name)
    print("манифест: + %s/%s" % (args.pool, name))
    entries = read_manifest(manifest)
    cmd_gen(entries)
    rc = sync_to_db(entries, key, base, dry_run=False)
    if rc:
        return rc
    if keep_source:
        archive_source(root, keep_source)
    print("живой: %s/storage/v1/object/public/%s/%s" % (base, BUCKET, dest))
    return 0


def main():
    ap = argparse.ArgumentParser(
        description="Звуки гамбы: синк манифеста и добавление фраз."
    )
    sub = ap.add_subparsers(dest="cmd", required=True)

    p_sync = sub.add_parser("sync", help="content/sounds.toml -> public.gamba_sounds")
    p_sync.add_argument("--manifest", default=os.path.join(os.getcwd(), MANIFEST))
    p_sync.add_argument("--env", default=os.path.join(os.getcwd(), ".env"))
    p_sync.add_argument(
        "--dry-run", action="store_true", help="Только план, без записи"
    )

    p_gen = sub.add_parser("gen", help="Пересобрать сид и фолбэк из манифеста")
    p_gen.add_argument("--manifest", default=os.path.join(os.getcwd(), MANIFEST))

    p_check = sub.add_parser("check", help="Проверить, что сид и фолбэк свежие")
    p_check.add_argument("--manifest", default=os.path.join(os.getcwd(), MANIFEST))

    p_add = sub.add_parser("add", help="Новый звук: залив + манифест + синк")
    p_add.add_argument("source", help="Локальный файл (mp3/mp4/webm) или URL клипа")
    p_add.add_argument("--pool", required=True, choices=POOLS)
    p_add.add_argument(
        "--name",
        default=None,
        help="Имя файла в бакете (по умолчанию gamba-<пул>-<слаг>)",
    )
    p_add.add_argument("--manifest", default=os.path.join(os.getcwd(), MANIFEST))
    p_add.add_argument("--env", default=os.path.join(os.getcwd(), ".env"))

    args = ap.parse_args()
    entries = read_manifest(args.manifest)

    if args.cmd == "gen":
        return cmd_gen(entries)
    if args.cmd == "check":
        return cmd_check(entries)
    if args.cmd == "add":
        return cmd_add(args)

    key, base = creds(args.env)
    if not key or not base:
        print(
            "Нет ключа/URL: задай SUPABASE_SERVICE_ROLE_KEY и PUBLIC_SUPABASE_URL "
            "в окружении или в %s" % args.env
        )
        return 1
    # Синк — единственный путь правки прод-таблицы, поэтому и генераты
    # (сид + фолбэк сборки) обновляются здесь же: разойтись с манифестом нечем.
    if not args.dry_run:
        cmd_gen(entries)
    return sync_to_db(entries, key, base, dry_run=args.dry_run)


if __name__ == "__main__":
    sys.exit(main())
