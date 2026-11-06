#!/usr/bin/env python3
"""Выравнивание громкости уже опубликованных приветов.

По умолчанию dry-run: скачивает, меряет и печатает план. `--apply` —
перекодирует только звук и заливает обратно в тот же ключ Storage; видео
копируется, URL не меняются. Хотлинки (`--link`, memealerts) пропускаются.

Секреты НИКОГДА не печатаются: ключ и ref берём из env/.env, как lot_add.
"""

import argparse
import os
import shutil
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request

import lot_add
import lots_sync
from storage_upload import upload_file, verify_public
from supabase_common import load_dotenv, project_base, resolve, resolve_service_key

BUCKET = lot_add.BUCKET
PUBLIC_PREFIX = "/storage/v1/object/public/%s/" % BUCKET


def storage_key(url):
    """Ключ объекта в бакете media или None для чужого URL."""
    path = urllib.parse.urlsplit(url).path
    if PUBLIC_PREFIX not in path:
        return None
    return path.split(PUBLIC_PREFIX, 1)[1]


def public_url(base, key):
    return "%s/storage/v1/object/public/%s/%s" % (base, BUCKET, key)


def base_url(env_path):
    """Публичный адрес проекта; для dry-run ключ не нужен."""
    base = project_base(resolve("PUBLIC_SUPABASE_URL", load_dotenv(env_path)))
    if not base:
        raise SystemExit("Нет PUBLIC_SUPABASE_URL: задай в .env")
    return base


def service_key(env_path):
    key = resolve_service_key(load_dotenv(env_path))
    if not key:
        raise SystemExit("Нет SUPABASE_SERVICE_ROLE_KEY: задай в .env")
    return key


def download(url, path):
    req = urllib.request.Request(url, headers={"User-Agent": "AlysQueZone/1.0"})
    with urllib.request.urlopen(req, timeout=120) as resp, open(path, "wb") as fh:
        shutil.copyfileobj(resp, fh)


def remux(path, out, gain, ext):
    """Видео копируется, звук перекодируется в родной кодек контейнера."""
    audio = (
        ["-c:a", "libopus", "-b:a", "96k"]
        if ext == ".webm"
        else ["-c:a", "aac", "-b:a", "128k"]
    )
    args = [
        "-i",
        path,
        "-map",
        "0:v:0",
        "-map",
        "0:a:0",
        "-c:v",
        "copy",
        "-af",
        "volume=%.2fdB" % gain,
        *audio,
    ]
    if ext == ".mp4":
        args += ["-movflags", "+faststart"]
    lot_add.run_ffmpeg(args + [out])


def targets(lots, only_slug):
    """Пары (slug, ключ Storage) для webm и mp4; хотлинки отсеиваются."""
    seen = set()
    result = []
    for lot in lots:
        if only_slug and lot["slug"] != only_slug:
            continue
        key = storage_key(lot.get("video_url") or "")
        if not key:
            continue
        stem = os.path.splitext(key)[0]
        for ext in (".webm", ".mp4"):
            candidate = stem + ext
            if candidate not in seen:
                seen.add(candidate)
                result.append((lot["slug"], candidate))
    return result


def process(key, base, key_service, workdir, apply):
    """Один файл: замер -> гейн -> remux -> залив. Возвращает статус."""
    ext = os.path.splitext(key)[1].lower()
    if ext not in (".webm", ".mp4"):
        return "skip"
    local = os.path.join(workdir, "src-" + key.replace("/", "-"))
    try:
        download(public_url(base, key), local)
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            print("%s: нет файла — пропускаю" % key)
            return "skip"
        print("%s: скачать не вышло: %s" % (key, exc.code))
        return "error"
    except urllib.error.URLError as exc:
        print("%s: скачать не вышло: %s" % (key, exc.reason))
        return "error"

    measured = lot_add.measure_loudness(local)
    if measured is None:
        print("%s: звука нет или замер не удался — пропускаю" % key)
        return "skip"
    loudness, peak = measured
    if abs(loudness - lot_add.TARGET_LUFS) <= lot_add.LOUDNESS_TOLERANCE:
        print("%s: уже %.1f LUFS — пропускаю" % (key, loudness))
        return "skip"

    gain = lot_add.TARGET_LUFS - loudness
    ceiling = lot_add.TARGET_TP - peak
    capped = gain > ceiling
    if capped:
        gain = ceiling
    note = " (упёрся в пик)" if capped else ""
    if not apply:
        print(
            "план  %s: %.1f -> %.1f LUFS, гейн %+.1f dB%s"
            % (key, loudness, lot_add.TARGET_LUFS, gain, note)
        )
        return "plan"

    out = os.path.join(workdir, "norm-" + key.replace("/", "-"))
    try:
        remux(local, out, gain, ext)
    except lot_add.LotError as exc:
        print("%s: %s" % (key, exc))
        return "error"
    after = lot_add.measure_loudness(out)
    if after is None:
        print("%s: замер результата не удался — не заливаю" % key)
        return "error"
    after_i, after_tp = after
    if abs(after_i - lot_add.TARGET_LUFS) > lot_add.LOUDNESS_TOLERANCE:
        print(
            "ПРЕДУПРЕЖДЕНИЕ: %s после обработки %.1f LUFS (промах %.1f LU) — всё равно заливаю"
            % (key, after_i, abs(after_i - lot_add.TARGET_LUFS))
        )
    ok, status = upload_file(key_service, base, BUCKET, key, out, None, True)
    if not ok:
        print("%s: залив не удался: %s" % (key, status))
        return "error"
    ok, status = verify_public(base, BUCKET, key)
    if not ok:
        print("%s: публичный URL не отвечает: %s" % (key, status))
        return "error"
    print(
        "готово %s: %.1f -> %.1f LUFS, пик %.1f dBTP"
        % (key, loudness, after_i, after_tp)
    )
    return "done"


def build_parser():
    ap = argparse.ArgumentParser(
        description="Выровнять громкость опубликованных приветов до %.1f LUFS."
        % lot_add.TARGET_LUFS
    )
    ap.add_argument(
        "--apply",
        action="store_true",
        help="перекодировать и залить (без флага — только план)",
    )
    ap.add_argument("--slug", default=None, help="только один лот")
    ap.add_argument("--env", default=os.path.join(lot_add.root_dir(), ".env"))
    return ap


def main(argv=None):
    args = build_parser().parse_args(argv)
    root = lot_add.root_dir()
    lots = lots_sync.manifest_lots(lot_add.manifest_path(root))
    base = base_url(args.env)
    key_service = service_key(args.env) if args.apply else None
    items = targets(lots, args.slug)
    if not items:
        print("Нет наших видео в манифесте — нечего делать")
        return 0
    print("%s: %d файлов" % ("залив" if args.apply else "dry-run", len(items)))
    workdir = tempfile.mkdtemp(prefix="alysque-norm-")
    counts = {"plan": 0, "done": 0, "skip": 0, "error": 0}
    try:
        for _, key in items:
            status = process(key, base, key_service, workdir, args.apply)
            counts[status] += 1
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
    print(
        "Итог: %d в плане, %d залито, %d пропущено, %d ошибок"
        % (counts["plan"], counts["done"], counts["skip"], counts["error"])
    )
    return 1 if counts["error"] else 0


if __name__ == "__main__":
    sys.exit(main())
