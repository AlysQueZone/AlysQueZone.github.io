#!/usr/bin/env python3
"""Общие хелперы скриптов Supabase (stdlib, без зависимостей).

Секреты НИКОГДА не печатаются: наружу отдаём только ключ/URL базой.
Используется storage_upload.py, lots_sync.py и sounds_sync.py.
"""

import json
import os
import urllib.error
import urllib.parse
import urllib.request

KEY_NAMES = ("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY", "SERVICE_ROLE_KEY")


def load_dotenv(path):
    """Читает .env в словарь. Отсутствие файла — не ошибка."""
    values = {}
    try:
        with open(path, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                name, _, value = line.partition("=")
                values[name.strip()] = value.strip().strip("'\"")
    except FileNotFoundError:
        pass
    return values


def resolve(name, dotenv):
    """Окружение важнее .env; плейсхолдеры вида [...] не считаются значением."""
    value = os.environ.get(name)
    if value and value.strip():
        return value.strip()
    value = dotenv.get(name)
    if value and value.strip() and not value.startswith("["):
        return value
    return None


def resolve_service_key(dotenv):
    for name in KEY_NAMES:
        key = resolve(name, dotenv)
        if key:
            return key
    return None


def ref_from_url(url):
    try:
        host = urllib.parse.urlparse(url).hostname or ""
        if host.endswith(".supabase.co"):
            return host[: -len(".supabase.co")]
    except Exception:
        pass
    return None


def project_base(url):
    """https://<ref>.supabase.co из PUBLIC_SUPABASE_URL либо None."""
    ref = ref_from_url(url or "")
    return "https://%s.supabase.co" % ref if ref else None


def request_json(key, method, url, payload=None, prefer=None):
    """REST-запрос к PostgREST; возвращает (status, body). Тело ошибки урезано."""
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
        return exc.code, exc.read().decode("utf-8", "replace")[:300]
