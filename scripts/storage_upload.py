#!/usr/bin/env python3
"""Универсальная заливка файлов в Supabase Storage (stdlib, без зависимостей).

Использование:
  python3 scripts/storage_upload.py --bucket media --dest sounds/ a.mp3 b.mp3
  python3 scripts/storage_upload.py --bucket media --dest videos/ --dir /tmp/out/
  python3 scripts/storage_upload.py --bucket media --dest sounds/ --dir /tmp/out/ --pattern "*.mp3"

Ключ и ref: env SUPABASE_SERVICE_ROLE_KEY (алиасы SUPABASE_SECRET_KEY,
SERVICE_ROLE_KEY) и PUBLIC_SUPABASE_URL, иначе те же имена из .env файла
(по умолчанию ./.env — запускать из корня репо). Секреты НИКОГДА не печатаются:
в выводе только имена файлов и HTTP-статусы.
"""

import argparse
import fnmatch
import mimetypes
import os
import sys
import urllib.error
import urllib.request

from supabase_common import load_dotenv, ref_from_url, resolve, resolve_service_key


def upload_file(key, base, bucket, dest, path, content_type, upsert):
    with open(path, "rb") as fh:
        data = fh.read()
    if not content_type:
        content_type = mimetypes.guess_type(path)[0] or "application/octet-stream"
    url = "%s/storage/v1/object/%s/%s" % (base, bucket, dest)
    headers = {
        "Authorization": "Bearer " + key,
        "apikey": key,
        "Content-Type": content_type,
    }
    if upsert:
        headers["x-upsert"] = "true"
    req = urllib.request.Request(url, data=data, method="POST", headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return True, str(resp.status)
    except urllib.error.HTTPError as exc:
        try:
            body = exc.read().decode("utf-8", "replace")[:300]
        except Exception:
            body = "<unreadable>"
        return False, "%s %s" % (exc.code, body)


def verify_public(base, bucket, dest):
    url = "%s/storage/v1/object/public/%s/%s" % (base, bucket, dest)
    req = urllib.request.Request(url, headers={"Range": "bytes=0-0"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return True, str(resp.status)
    except urllib.error.HTTPError as exc:
        return False, str(exc.code)


def main():
    ap = argparse.ArgumentParser(description="Upload files to Supabase Storage.")
    ap.add_argument("--bucket", required=True)
    ap.add_argument(
        "--dest",
        default="",
        help="Префикс в бакете, напр. sounds/ (файл ложится внутрь)",
    )
    ap.add_argument("--dir", default=None, help="Каталог с файлами для заливки")
    ap.add_argument(
        "--pattern", default="*", help="Маска файлов в --dir (по умолчанию *)"
    )
    ap.add_argument(
        "--ref", default=None, help="Project ref (иначе из PUBLIC_SUPABASE_URL)"
    )
    ap.add_argument("--env", default=os.path.join(os.getcwd(), ".env"))
    ap.add_argument("--content-type", default=None)
    ap.add_argument("--no-upsert", action="store_true")
    ap.add_argument("--no-verify", action="store_true")
    ap.add_argument("files", nargs="*", help="Файлы для заливки")
    args = ap.parse_args()

    dotenv = load_dotenv(args.env)
    key = resolve_service_key(dotenv)
    if not key:
        print(
            "Нет ключа: задай SUPABASE_SERVICE_ROLE_KEY в окружении или в %s" % args.env
        )
        return 1
    ref = args.ref or ref_from_url(resolve("PUBLIC_SUPABASE_URL", dotenv) or "")
    if not ref:
        print("Нет ref: передай --ref или задай PUBLIC_SUPABASE_URL")
        return 1
    base = "https://%s.supabase.co" % ref

    targets = list(args.files)
    if args.dir:
        for entry in sorted(os.listdir(args.dir)):
            if fnmatch.fnmatch(entry, args.pattern):
                full = os.path.join(args.dir, entry)
                if os.path.isfile(full):
                    targets.append(full)
    if not targets:
        print("Нечего заливать")
        return 1

    ok = True
    dests = []
    for path in targets:
        dest = (args.dest + os.path.basename(path)).lstrip("/")
        good, status = upload_file(
            key, base, args.bucket, dest, path, args.content_type, not args.no_upsert
        )
        print("%s -> %s/%s : %s" % (os.path.basename(path), args.bucket, dest, status))
        ok = good and ok
        dests.append(dest)
    if not args.no_verify:
        for dest in dests:
            good, status = verify_public(base, args.bucket, dest)
            print("public %s/%s : %s" % (args.bucket, dest, status))
            ok = good and ok
    print("OK" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
