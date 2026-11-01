#!/usr/bin/env python3
"""Локальный вход для проверки залогиненных экранов (stdlib, без зависимостей).

Колокол, гамба и покупка живут только при uid != null, а preview и живой сайт
ходят в прод гостем. Скрипт поднимает на локальном Supabase двух dev-юзеров,
перекуп-фикстуру и пишет сессию продавца в файл — её кладёт в localStorage
agent-browser (ключ печатается).

Использование (из корня репо; локальный стек уже поднят — just run-local):
  python3 scripts/dev_auth.py

Ключи локального стека берутся из `supabase status -o env` и НИКОГДА не
печатаются. Не локальный API или пустой status — стоп: прод не трогаем.
"""

import json
import os
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request

SELLER = {
    "email": "dev-seller@alysque.local",
    "login": "dev-seller",
    "password": "alysque-dev",
}
BUYER = {
    "email": "dev-buyer@alysque.local",
    "login": "dev-buyer",
    "password": "alysque-dev",
}
LOT_SLUG = "dev-outbid-lot"
LOT_TITLE = "Привет dev-лот"
LOT_PRICE = 100
DEV_BALANCE = 100_000
SESSION_PATH = os.path.join(tempfile.gettempdir(), "alysque-dev-session.json")


def root_dir():
    """Корень репо: scripts/dev_auth.py -> два уровня вверх."""
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def say(line=""):
    print(line, flush=True)


def die(message):
    say("ОШИБКА: %s" % message)
    raise SystemExit(3)


# ---------------------------------------------------------------------------
# Локальный Supabase: URL и ключи из status, без печати секретов
# ---------------------------------------------------------------------------


def local_config():
    try:
        done = subprocess.run(
            ["./node_modules/.bin/supabase", "status", "-o", "env"],
            cwd=root_dir(),
            capture_output=True,
            text=True,
            timeout=60,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        die("supabase status не запустился: %s" % exc)
    if done.returncode != 0:
        die("локальный Supabase не поднят — сначала just run-local (или just db-up)")

    env = {}
    for line in done.stdout.splitlines():
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        env[key.strip()] = value.strip().strip('"')

    base = (env.get("API_URL") or env.get("SUPABASE_URL") or "").rstrip("/")
    anon = env.get("PUBLISHABLE_KEY") or env.get("ANON_KEY") or ""
    service = env.get("SERVICE_ROLE_KEY") or env.get("SECRET_KEY") or ""
    if not base or not anon or not service:
        die("supabase status не отдал API_URL/PUBLISHABLE_KEY/SERVICE_ROLE_KEY")

    host = urllib.parse.urlparse(base).hostname or ""
    if host not in ("127.0.0.1", "localhost"):
        die("API_URL не локальный (%s) — прод не трогаем" % host)
    return base, anon, service


# ---------------------------------------------------------------------------
# HTTP (stdlib)
# ---------------------------------------------------------------------------


def call(method, url, key, payload=None, token=None, prefer=None, timeout=30):
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    headers = {"apikey": key, "Authorization": "Bearer " + (token or key)}
    if data is not None:
        headers["Content-Type"] = "application/json"
    if prefer:
        headers["Prefer"] = prefer
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8", "replace")
            return resp.status, (json.loads(body) if body else None)
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", "replace")[:400]
    except urllib.error.URLError as exc:
        return 0, str(exc.reason)


def expect(result, ok, what):
    status, payload = result
    if status not in ok:
        die("%s: %s %s" % (what, status, payload))
    return payload


# ---------------------------------------------------------------------------
# Шаги: юзеры, баланс, лот, покупка, сессия
# ---------------------------------------------------------------------------


def user_of(payload):
    if isinstance(payload, dict) and "user" in payload:
        return payload["user"]
    return payload


def find_user(base, service, email):
    """Один юзер по email: список всех падает на локальных строках без
    confirmation_token (легаси-бэкап), а фильтр отдаёт только совпадение."""
    data = expect(
        call(
            "GET",
            "%s/auth/v1/admin/users?filter=%s"
            % (base, urllib.parse.quote(email, safe="")),
            service,
        ),
        (200,),
        "GET admin/users?filter",
    )
    users = data.get("users", []) if isinstance(data, dict) else data
    for user in users:
        if isinstance(user, dict) and user.get("email") == email:
            return user
    return None


def ensure_user(base, service, spec):
    meta = {"provider_id": spec["login"], "user_name": spec["login"]}
    known = find_user(base, service, spec["email"])
    if known:
        uid = known["id"]
        user = user_of(
            expect(
                call(
                    "PUT",
                    "%s/auth/v1/admin/users/%s" % (base, uid),
                    service,
                    {"password": spec["password"], "user_metadata": meta},
                ),
                (200,),
                "PUT admin/users/%s" % spec["login"],
            )
        )
    else:
        user = user_of(
            expect(
                call(
                    "POST",
                    "%s/auth/v1/admin/users" % base,
                    service,
                    {
                        "email": spec["email"],
                        "password": spec["password"],
                        "email_confirm": True,
                        "user_metadata": meta,
                    },
                ),
                (200, 201),
                "POST admin/users/%s" % spec["login"],
            )
        )
    if not isinstance(user, dict) or not user.get("id"):
        die("admin API не вернул id для %s" % spec["login"])
    return dict(user, login=spec["login"])


def set_balance(base, service, uid, balance):
    data = expect(
        call(
            "PATCH",
            "%s/rest/v1/profiles?user_id=eq.%s" % (base, uid),
            service,
            {"balance": balance},
            prefer="return=representation",
        ),
        (200, 204),
        "PATCH profiles/%s" % uid,
    )
    if isinstance(data, list) and not data:
        expect(
            call(
                "POST",
                "%s/rest/v1/profiles" % base,
                service,
                {"user_id": uid, "balance": balance},
                prefer="return=representation",
            ),
            (200, 201),
            "POST profiles/%s" % uid,
        )


def ensure_lot(base, service, seller):
    rows = expect(
        call(
            "GET",
            "%s/rest/v1/lots?slug=eq.%s&select=id" % (base, LOT_SLUG),
            service,
        ),
        (200,),
        "GET lots/%s" % LOT_SLUG,
    )
    fields = {
        "title": LOT_TITLE,
        "price": LOT_PRICE,
        "owner_uid": seller["id"],
        "owner_login": seller["login"],
        "purchase_count": 0,
    }
    if isinstance(rows, list) and rows:
        lot_id = rows[0]["id"]
        expect(
            call("PATCH", "%s/rest/v1/lots?id=eq.%s" % (base, lot_id), service, fields),
            (200, 204),
            "PATCH lots/%s" % LOT_SLUG,
        )
        return lot_id
    lot = expect(
        call(
            "POST",
            "%s/rest/v1/lots" % base,
            service,
            dict(fields, slug=LOT_SLUG),
            prefer="return=representation",
        ),
        (200, 201),
        "POST lots/%s" % LOT_SLUG,
    )
    return lot[0]["id"]


def sign_in(base, anon, spec):
    session = expect(
        call(
            "POST",
            "%s/auth/v1/token?grant_type=password" % base,
            anon,
            {"email": spec["email"], "password": spec["password"]},
        ),
        (200,),
        "вход %s" % spec["login"],
    )
    if not isinstance(session, dict) or not session.get("access_token"):
        die("вход %s не вернул сессию" % spec["login"])
    return session


def main():
    base, anon, service = local_config()
    seller = ensure_user(base, service, SELLER)
    buyer = ensure_user(base, service, BUYER)
    set_balance(base, service, seller["id"], DEV_BALANCE)
    set_balance(base, service, buyer["id"], DEV_BALANCE)

    lot_id = ensure_lot(base, service, seller)
    expect(
        call("DELETE", "%s/rest/v1/purchases?lot_id=eq.%s" % (base, lot_id), service),
        (200, 204),
        "DELETE purchases/%s" % LOT_SLUG,
    )

    buyer_session = sign_in(base, anon, BUYER)
    purchase = expect(
        call(
            "POST",
            "%s/rest/v1/purchases?select=price_paid,buyer_login,seller_login" % base,
            anon,
            {"lot_id": lot_id, "buyer_uid": buyer["id"]},
            token=buyer_session["access_token"],
            prefer="return=representation",
        ),
        (200, 201),
        "покупка dev-лота",
    )
    row = purchase[0] if isinstance(purchase, list) and purchase else purchase
    if not isinstance(row, dict):
        die("покупка не вернула строку")

    session = sign_in(base, anon, SELLER)
    with open(SESSION_PATH, "w", encoding="utf-8") as fh:
        json.dump(session, fh, ensure_ascii=False)
    os.chmod(SESSION_PATH, 0o600)

    host = urllib.parse.urlparse(base).hostname or ""
    storage_key = "sb-%s-auth-token" % host.split(".")[0]
    say("Локальный вход готов: %s" % SELLER["email"])
    say(
        "Фикстура: %s забрал «%s» за %s 🍺"
        % (
            row.get("buyer_login") or BUYER["login"],
            LOT_TITLE,
            row.get("price_paid") or "?",
        )
    )
    say("Ключ localStorage: %s" % storage_key)
    say("Сессия: %s" % SESSION_PATH)
    say(
        'Дальше: agent-browser storage local set %s "$(cat %s)"'
        % (storage_key, SESSION_PATH)
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
