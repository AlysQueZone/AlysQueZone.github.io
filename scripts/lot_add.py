#!/usr/bin/env python3
"""Новый лот: файл или ссылка -> медиа-тройка -> Storage -> карточка -> синк.

Использование (из корня репо):
  python3 scripts/lot_add.py privets/Onghanntto.mp4 --title "Привет Onghanntto"
  python3 scripts/lot_add.py https://twitch.tv/alysque/clip/... --title "…" --slug lot-meme-x
  python3 scripts/lot_add.py --link https://cdn.example/alert_orig.webm --slug lot-meme-x --title "…"

Это общий пайплайн нового лота: им же пользуется `scripts/submission.py`
для заявок. Файл или ссылка на клип -> ffmpeg собирает тройку
`videos/<slug>.webm|mp4|webp` -> залив в Storage с проверкой публичных URL ->
`[[lots]]` в `content/lots.toml` -> свежий `supabase/seed.sql` -> синк в прод.
`--link` — готовый чужой URL: карточка без скачивания и залива (хотлинк-мем).
Локальный исходник из `privets/` после успеха уезжает в `privets/already added/`.

Секреты НИКОГДА не печатаются: ключ и ref берём из env
SUPABASE_SERVICE_ROLE_KEY (алиасы SUPABASE_SECRET_KEY, SERVICE_ROLE_KEY) и
PUBLIC_SUPABASE_URL, иначе из `.env` (по умолчанию ./.env).
"""

import argparse
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.parse
import urllib.request

import lots_sync
from storage_upload import upload_file, verify_public
from supabase_common import load_dotenv, project_base, resolve, resolve_service_key

BUCKET = "media"
VIDEOS_DEST = "videos/"
DEFAULT_PRICE = 800
# Один уровень для всех приветов: речь в вебе, пик — запас под lossy-кодеки
# и короткие клипы. Константа, а не флаг: разнобой между запусками не нужен.
TARGET_LUFS = -16.0
TARGET_TP = -1.5
LOUDNESS_TOLERANCE = 1.0
# Меняешь цель — подними версию: иначе /tmp-кэш останется на старом уровне.
LOUDNESS_MARKER = ".loudness-v1"
MANIFEST = os.path.join("content", "lots.toml")
SEED = os.path.join("supabase", "seed.sql")
DIRECT_SUFFIXES = (".mp4", ".webm", ".mov", ".mkv", ".m4v")
SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


class LotError(Exception):
    """Понятная человеку ошибка пайплайна с подсказкой, что делать."""


def root_dir():
    """Корень репо: scripts/lot_add.py -> два уровня вверх."""
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def say(line=""):
    print(line, flush=True)


def creds(env_path):
    """(service key, base URL) без печати секретов."""
    dotenv = load_dotenv(env_path)
    return (
        resolve_service_key(dotenv),
        project_base(resolve("PUBLIC_SUPABASE_URL", dotenv)),
    )


def manifest_path(root):
    return os.path.join(root, MANIFEST)


def seed_path(root):
    return os.path.join(root, SEED)


def slugify(value):
    value = re.sub(r"[^a-z0-9]+", "-", (value or "").lower())
    return value.strip("-")


def default_slug(source):
    """Слаг из имени локального файла; из ссылки не выводится (нужен --slug)."""
    if not source or re.match(r"^https?://", source):
        return None
    stem = os.path.splitext(os.path.basename(source))[0]
    slug = slugify(stem)
    return "lot-privet-%s" % slug if slug else None


def video_url(base, slug):
    return "%s/storage/v1/object/public/%s/%s%s.webm" % (
        base,
        BUCKET,
        VIDEOS_DEST,
        slug,
    )


# ---------------------------------------------------------------------------
# Скачивание и медиа
# ---------------------------------------------------------------------------


def download_video(url, workdir):
    """yt-dlp во временную папку; прямая ссылка на файл — запасной urllib."""
    os.makedirs(workdir, exist_ok=True)
    existing = find_source(workdir)
    if existing:
        say("Видео уже скачано: %s" % existing)
        return existing

    out_tmpl = os.path.join(workdir, "source.%(ext)s")
    try:
        proc = subprocess.run(
            [
                "yt-dlp",
                "--no-playlist",
                "--no-progress",
                "-f",
                "bestvideo*+bestaudio/best",
                "--merge-output-format",
                "mp4",
                "-o",
                out_tmpl,
                url,
            ],
            capture_output=True,
            text=True,
        )
    except FileNotFoundError:
        proc = None
    if proc is not None and proc.returncode == 0:
        found = find_source(workdir)
        if found:
            say("Скачано (yt-dlp): %s" % found)
            return found

    # Прямая ссылка на медиафайл — качаем как есть (без разбора страницы).
    path = urllib.parse.urlsplit(url).path.lower()
    if path.endswith(DIRECT_SUFFIXES):
        try:
            return direct_download(url, workdir)
        except Exception as exc:  # noqa: BLE001 — показываем причину агенту
            raise LotError("не удалось скачать прямую ссылку: %s" % exc)

    if proc is None:
        raise LotError("не найден yt-dlp — установи его и повтори")
    tail = (proc.stderr or "").strip().splitlines()
    reason = tail[-1] if tail else "yt-dlp не справился"
    raise LotError("ссылка мёртвая/приватная или не поддержана: %s" % reason)


def direct_download(url, workdir):
    req = urllib.request.Request(url, headers={"User-Agent": "AlysQueZone/1.0"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        ext = os.path.splitext(urllib.parse.urlsplit(url).path)[1].lower() or ".mp4"
        target = os.path.join(workdir, "source" + ext)
        with open(target, "wb") as fh:
            while True:
                chunk = resp.read(1 << 20)
                if not chunk:
                    break
                fh.write(chunk)
    say("Скачано (прямая ссылка): %s" % target)
    return target


def find_source(workdir):
    if not os.path.isdir(workdir):
        return None
    for name in sorted(os.listdir(workdir)):
        if name.startswith("source.") and not name.endswith(".part"):
            full = os.path.join(workdir, name)
            if os.path.isfile(full) and os.path.getsize(full) > 0:
                return full
    return None


def run_ffmpeg(args):
    try:
        proc = subprocess.run(
            ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args],
            capture_output=True,
            text=True,
        )
    except FileNotFoundError:
        raise LotError("не найден ffmpeg — установи его и повтори")
    if proc.returncode != 0:
        tail = (proc.stderr or "").strip().splitlines()
        raise LotError("ffmpeg упал: %s" % (tail[-1] if tail else proc.returncode))
    return True


def measure_loudness(path):
    """(интегрированная громкость, истинный пик) или None, если звука нет.

    Замер EBU R128 с гейтингом тишины; видео не декодируется (`-vn`).
    """
    try:
        proc = subprocess.run(
            [
                "ffmpeg",
                "-hide_banner",
                "-nostats",
                "-i",
                path,
                "-vn",
                "-af",
                "loudnorm=print_format=json",
                "-f",
                "null",
                "-",
            ],
            capture_output=True,
            text=True,
        )
    except FileNotFoundError:
        raise LotError("не найден ffmpeg — установи его и повтори")
    if proc.returncode != 0:
        return None
    match = re.search(r'\{[^{}]*"input_i"[^{}]*\}', proc.stderr, re.S)
    if not match:
        return None
    try:
        data = json.loads(match.group(0))
        loudness = float(data["input_i"])
        peak = float(data["input_tp"])
    except (KeyError, ValueError, json.JSONDecodeError):
        return None
    if not math.isfinite(loudness) or not math.isfinite(peak):
        return None
    return loudness, peak


def gain_for(source):
    """Гейн до TARGET_LUFS по замеру исходника; None — нормализовать нечего.

    Гейн линейный: меняется только уровень, динамика и тембр остаются.
    Потолок пика важнее цели — если гейн в него упирается, клип останется
    тише, но без лимитера (на речи он звучит хуже).
    """
    measured = measure_loudness(source)
    if measured is None:
        say("Громкость исходника: звука нет или замер не удался — без нормализации")
        return None
    loudness, peak = measured
    gain = TARGET_LUFS - loudness
    ceiling = TARGET_TP - peak
    if gain > ceiling:
        say(
            "Пик не даёт поднять до %.1f LUFS: гейн %.1f dB (потолок %.1f dBTP)"
            % (TARGET_LUFS, ceiling, TARGET_TP)
        )
        gain = ceiling
    say(
        "Громкость исходника: %.1f LUFS, пик %.1f dBTP; гейн %+.1f dB"
        % (loudness, peak, gain)
    )
    return gain


def check_loudness(path):
    """Замер результата: промах — предупреждение, публикацию не блокирует."""
    measured = measure_loudness(path)
    if measured is None:
        say(
            "%s: замер громкости не удался — публикую как есть" % os.path.basename(path)
        )
        return
    loudness, peak = measured
    say("%s: %.1f LUFS, пик %.1f dBTP" % (os.path.basename(path), loudness, peak))
    miss = abs(loudness - TARGET_LUFS)
    if miss > LOUDNESS_TOLERANCE:
        say(
            "ПРЕДУПРЕЖДЕНИЕ: %s промахнулся мимо %.1f LUFS на %.1f LU — публикую как есть"
            % (os.path.basename(path), TARGET_LUFS, miss)
        )


def ready(path):
    """Готовый файл: существует и не пустой (кэш сборки в /tmp)."""
    return os.path.exists(path) and os.path.getsize(path) > 0


def build_triple(source, workdir, slug):
    """Тройка webm/mp4/webp: видео, совместимое с браузером, и постер.

    Звук обеих сборок приводится к TARGET_LUFS линейным гейном; промах —
    предупреждение, публикацию не блокирует.
    """
    os.makedirs(workdir, exist_ok=True)
    webm = os.path.join(workdir, slug + ".webm")
    mp4 = os.path.join(workdir, slug + ".mp4")
    webp = os.path.join(workdir, slug + ".webp")
    marker = os.path.join(workdir, LOUDNESS_MARKER)
    # Кэш старой сборки не знает про нормализацию — пересобираем оба видеофайла.
    fresh = os.path.exists(marker)
    rebuild = not fresh or not ready(webm) or not ready(mp4)
    audio_filter = []
    if rebuild:
        gain = gain_for(source)
        if gain is not None:
            audio_filter = ["-af", "volume=%.2fdB" % gain]
    if not ready(webm) or not fresh:
        say("Собираю %s…" % os.path.basename(webm))
        run_ffmpeg(
            [
                "-i",
                source,
                *audio_filter,
                "-c:v",
                "libvpx-vp9",
                "-b:v",
                "0",
                "-crf",
                "32",
                "-c:a",
                "libopus",
                webm,
            ]
        )
    if not ready(mp4) or not fresh:
        say("Собираю %s…" % os.path.basename(mp4))
        run_ffmpeg(
            [
                "-i",
                source,
                *audio_filter,
                "-c:v",
                "libx264",
                "-crf",
                "23",
                "-preset",
                "veryfast",
                "-c:a",
                "aac",
                "-movflags",
                "+faststart",
                mp4,
            ]
        )
    if not ready(webp):
        say("Собираю %s…" % os.path.basename(webp))
        run_ffmpeg(["-i", source, "-vframes", "1", "-q:v", "80", webp])
    if rebuild:
        with open(marker, "w", encoding="utf-8") as fh:
            fh.write("1\n")
    if audio_filter:
        check_loudness(webm)
        check_loudness(mp4)
    return [webm, mp4, webp]


# ---------------------------------------------------------------------------
# Публикация
# ---------------------------------------------------------------------------


def upload_triple(key, base, files):
    """Залив тройки в media/videos/ с проверкой публичного URL."""
    say("Заливаю в Storage (%s)…" % VIDEOS_DEST)
    dests = []
    for path in files:
        name = os.path.basename(path)
        dest = VIDEOS_DEST + name
        ok, status = upload_file(key, base, BUCKET, dest, path, None, True)
        say("%s -> %s/%s : %s" % (name, BUCKET, dest, status))
        if not ok:
            raise LotError("залив не удался: %s" % status)
        dests.append(dest)
    for dest in dests:
        ok, status = verify_public(base, BUCKET, dest)
        say("public %s/%s : %s" % (BUCKET, dest, status))
        if not ok:
            raise LotError("публичный URL не отвечает: %s" % status)


def toml_escape(value):
    return str(value).replace("\\", "\\\\").replace('"', '\\"')


def append_lot(root, slug, title, price, video_url):
    """Дописывает карточку в конец манифеста; уже существующую — пропускает."""
    path = manifest_path(root)
    with open(path, "r", encoding="utf-8") as fh:
        text = fh.read()
    if any(lot.get("slug") == slug for lot in lots_sync.manifest_lots(path)):
        say("Карточка уже в content/lots.toml (%s) — пропускаю" % slug)
        return
    if not text.endswith("\n"):
        text += "\n"
    block = '\n[[lots]]\nslug = "%s"\ntitle = "%s"\nprice = %d\nvideo_url = "%s"\n' % (
        toml_escape(slug),
        toml_escape(title),
        price,
        toml_escape(video_url),
    )
    with open(path, "a", encoding="utf-8") as fh:
        fh.write(block)
    say("Карточка добавлена: content/lots.toml (%s)" % slug)


def regenerate_seed(root):
    """Локальный сид не должен отставать от манифеста (db reset читает его)."""
    lots = lots_sync.read_manifest(manifest_path(root))
    lots_sync.write_seed(lots, seed_path(root))
    say("Сид обновлён: supabase/seed.sql (%d лотов)" % len(lots))


def check_args(slug, link, title, price):
    """Проверки до сети и тяжёлой работы: слаг, ссылка, заголовок и цена."""
    if not SLUG_RE.match(slug):
        raise LotError(
            "некорректный слаг: %s (только a-z, 0-9 и дефис: lot-privet-nick)" % slug
        )
    if not title:
        raise LotError("пустой --title")
    if "\n" in title:
        raise LotError("заголовок должен быть одной строкой")
    if price <= 0:
        raise LotError("--price должен быть больше нуля")
    if link:
        if not re.match(r"^https?://", link):
            raise LotError("--link ждёт http(s)-URL")
        if any(ch.isspace() for ch in link):
            raise LotError("--link не должен содержать пробелов или переводов строк")


def publish_lot(root, key, base, slug, title, price, url):
    """Карточка + сид + синк: лот появляется на витрине без деплоя."""
    check_args(slug, None, title, price)
    append_lot(root, slug, title, price, url)
    regenerate_seed(root)
    say("Синк контента (content/lots.toml -> public.lots)…")
    rc = lots_sync.sync_lots(
        lots_sync.read_manifest(manifest_path(root)), key, base, dry_run=False
    )
    if rc:
        raise LotError(
            "синк не прошёл — карточка уже в content/lots.toml, повтори: just lots-sync"
        )


def publish_video(root, key, base, slug, title, price, files):
    """Тройка в Storage + карточка + синк; возвращает публичный URL видео."""
    check_args(slug, None, title, price)
    upload_triple(key, base, files)
    url = video_url(base, slug)
    publish_lot(root, key, base, slug, title, price, url)
    return url


def archive_source(root, local):
    """Исходник из privets/ уезжает в privets/already added/ (как у звуков)."""
    privets = os.path.abspath(os.path.join(root, "privets"))
    source = os.path.abspath(local)
    rel = os.path.relpath(source, privets)
    if rel.startswith("..") or rel.split(os.sep)[0] == "already added":
        return
    already = os.path.join(privets, "already added")
    os.makedirs(already, exist_ok=True)
    shutil.move(source, os.path.join(already, os.path.basename(source)))
    say("исходник: privets/%s -> privets/already added/" % rel)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def check_new(slug, link, manifest, existing):
    """Гейты «уже есть»: слаг и ссылка не должны повторять живой лот."""
    if any(lot.get("slug") == slug for lot in manifest):
        raise LotError(
            "слаг уже в content/lots.toml (%s) — публикуй: just lots-sync" % slug
        )
    if slug in existing:
        raise LotError("лот с таким слагом уже в БД: %s" % slug)
    if link:
        known = list(manifest) + list(existing.values())
        for lot in known:
            if lot.get("video_url") == link:
                raise LotError("этот URL уже у лота %s" % lot.get("slug"))


def cmd_add(args):
    root = root_dir()
    if args.link and args.source:
        raise LotError("передай что-то одно: файл/ссылку на клип или --link")
    if not args.link and not args.source:
        raise LotError("нужен файл, ссылка на клип или --link на готовый URL")

    slug = args.slug or default_slug(args.source)
    if not slug:
        raise LotError("передай --slug: из ссылки слаг не выводится")
    title = (args.title or "").strip()
    check_args(slug, args.link, title, args.price)

    is_url = bool(args.source and re.match(r"^https?://", args.source))
    if args.source and not is_url and not os.path.isfile(args.source):
        raise LotError("нет файла: %s" % args.source)

    manifest = lots_sync.manifest_lots(manifest_path(root))
    key, base = creds(args.env)
    if not key or not base:
        print(
            "Нет ключа/URL: задай SUPABASE_SERVICE_ROLE_KEY и PUBLIC_SUPABASE_URL "
            "в .env"
        )
        return 1
    existing = lots_sync.fetch_existing(key, base)
    check_new(slug, args.link, manifest, existing)

    if args.link:
        publish_lot(root, key, base, slug, title, args.price, args.link)
        say("живой: %s" % args.link)
        return 0

    workdir = args.workdir or os.path.join(tempfile.gettempdir(), "alysque-lot-" + slug)
    if is_url:
        local = download_video(args.source, workdir)
        keep_source = None
    else:
        local = args.source
        keep_source = local

    try:
        triple = build_triple(local, workdir, slug)
    except LotError as exc:
        raise LotError("%s (workdir: %s)" % (exc, workdir))

    url = publish_video(root, key, base, slug, title, args.price, triple)
    if keep_source:
        archive_source(root, keep_source)
    say("живой: %s" % url)
    return 0


def build_parser():
    ap = argparse.ArgumentParser(
        description="Новый лот: медиа -> Storage -> content/lots.toml -> синк."
    )
    ap.add_argument("source", nargs="?", help="Локальный файл или URL клипа")
    ap.add_argument(
        "--link",
        default=None,
        help="Готовый публичный URL для карточки (хотлинк, без залива)",
    )
    ap.add_argument("--title", required=True, help="Заголовок карточки")
    ap.add_argument(
        "--slug",
        default=None,
        help="Слаг (по умолчанию lot-privet-<имя файла>; для ссылки обязателен)",
    )
    ap.add_argument("--price", type=int, default=DEFAULT_PRICE, help="Стартовая цена")
    ap.add_argument("--workdir", default=None, help="Папка сборки (по умолчанию /tmp)")
    ap.add_argument("--env", default=os.path.join(root_dir(), ".env"))
    return ap


def main(argv=None):
    args = build_parser().parse_args(argv)
    try:
        return cmd_add(args)
    except LotError as exc:
        print("ОШИБКА: %s" % exc)
        return 1
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    sys.exit(main())
