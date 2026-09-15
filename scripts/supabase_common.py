#!/usr/bin/env python3
"""Общие хелперы скриптов Supabase (stdlib, без зависимостей).

Секреты НИКОГДА не печатаются: наружу отдаём только ключ/URL базой.
Используется storage_upload.py и lots_sync.py.
"""

import os
import urllib.parse

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
