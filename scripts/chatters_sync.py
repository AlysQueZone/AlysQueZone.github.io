#!/usr/bin/env python3
"""Синк ников чатерсов из чата VOD в content/chatters.toml (stdlib, без зависимостей).

Использование (из корня репо):
  python3 scripts/chatters_sync.py --chat chat.json     # из готового дампа
  python3 scripts/chatters_sync.py --vod 2864275043     # скачать чат анонимным GQL
  python3 scripts/chatters_sync.py --chat a.json --chat b.json
  python3 scripts/chatters_sync.py --dry-run

Правила записи:
  - новый ник (ключ: id, иначе login) -> добавляется;
  - существующий -> nick обновляется, если в источнике другое display-имя;
  - aliases скрипт НИКОГДА не трогает — их дописывает агент вручную;
  - повторный прогон на том же источнике ничего не меняет (идемпотентно),
    поэтому файл перезаписывается только при реальных изменениях.

Вход бывает двух форм: компакт `{videoID, messages:[{t,user,login,text}]}` и нативный
TwitchDownloader `{comments:[{commenter:{display_name,name,_id}}]}`. Обе нормализуются
в один вид. Стример и известные боты исключаются (см. EXCLUDE), плюс `--exclude login,...`.
"""

import argparse
import json
import os
import sys
import time
import tomllib
import urllib.error
import urllib.request

DEFAULT_FILE = os.path.join("content", "chatters.toml")

# Стример (по глоссарию не чатерс) и ники с ботоподозрением; сравнивается по login.
EXCLUDE = {"alysque", "lysb0t", "bot_91"}

GQL_URL = "https://gql.twitch.tv/gql"
GQL_CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko"
GQL_HASH = "b70a3591ff0f4e0313d126c6a1502d79a1c02baebb288227c582044aa76adf6a"

HEADER = """\
# Реестр ников чатерсов alysque — источник правды для написания ников в карточках.
# Синк: `just chatters-sync --chat <chat.json>` либо `--vod <id>`; новые ники
# добавляются идемпотентно по login/id. Поле `aliases` скрипт не трогает: агенту
# можно и нужно дописывать туда варианты написания (кириллица, опечатки), когда
# он резолвит ник для карточки. `id` — числовой Twitch user id, если источник дал.
# Порядок записей задаёт скрипт (по login); править руками — только `aliases`.\
"""


def toml_str(value):
    out = str(value).replace("\\", "\\\\").replace('"', '\\"')
    out = out.replace("\n", "\\n").replace("\r", "\\r").replace("\t", "\\t")
    return '"%s"' % out


def render(chatters):
    blocks = [HEADER, ""]
    for c in chatters:
        blocks.append("[[chatters]]")
        blocks.append("nick = %s" % toml_str(c["nick"]))
        blocks.append("login = %s" % toml_str(c["login"]))
        if c.get("aliases"):
            aliases = ", ".join(toml_str(a) for a in c["aliases"])
            blocks.append("aliases = [%s]" % aliases)
        if c.get("id"):
            blocks.append("id = %s" % toml_str(c["id"]))
        blocks.append("")
    return "\n".join(blocks)


def load_existing(path):
    if not os.path.exists(path):
        return []
    with open(path, "rb") as fh:
        data = tomllib.load(fh)
    out = []
    for c in data.get("chatters", []):
        nick, login = c.get("nick"), c.get("login")
        if not nick or not login:
            raise SystemExit("Запись без nick/login: %r" % (c,))
        out.append(
            {
                "nick": str(nick),
                "login": str(login),
                "aliases": [str(a) for a in (c.get("aliases") or [])],
                "id": str(c["id"]) if c.get("id") else "",
            }
        )
    return out


def add_incoming(pool, nick, login, uid):
    """Копит нормализованные записи, дедупя по login (id подтягивает, если был)."""
    if not login:
        return
    key = login.lower()
    cur = pool.get(key)
    if cur is None:
        pool[key] = {
            "nick": nick or login,
            "login": login,
            "aliases": [],
            "id": uid or "",
        }
        return
    if nick and nick != cur["nick"]:
        cur["nick"] = nick
    if uid and not cur["id"]:
        cur["id"] = uid


def from_dump(data, pool):
    """Компакт `messages` или нативный `comments` -> пул."""
    if isinstance(data.get("messages"), list):
        for m in data["messages"]:
            add_incoming(pool, m.get("user"), m.get("login"), m.get("id"))
        return
    if isinstance(data.get("comments"), list):
        for m in data["comments"]:
            comm = m.get("commenter") or {}
            add_incoming(
                pool,
                comm.get("display_name"),
                comm.get("name"),
                comm.get("_id"),
            )
        return
    raise SystemExit("Не понял форму дампа: нет ни messages, ни comments")


def gql_page(video_id, offset):
    body = {
        "operationName": "VideoCommentsByOffsetOrCursor",
        "variables": {"videoID": str(video_id), "contentOffsetSeconds": offset},
        "extensions": {"persistedQuery": {"version": 1, "sha256Hash": GQL_HASH}},
    }
    req = urllib.request.Request(
        GQL_URL,
        data=json.dumps(body).encode("utf-8"),
        headers={"Client-Id": GQL_CLIENT_ID, "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise SystemExit(
            "GQL %s: %s" % (exc.code, exc.read().decode("utf-8", "replace")[:200])
        )
    except urllib.error.URLError as exc:
        raise SystemExit("GQL недоступен: %s" % exc.reason)
    if payload.get("errors"):
        raise SystemExit(
            "GQL ошибка: %s" % json.dumps(payload["errors"], ensure_ascii=False)[:300]
        )
    comments = ((payload.get("data") or {}).get("video") or {}).get("comments") or {}
    edges = comments.get("edges") or []
    has_next = bool((comments.get("pageInfo") or {}).get("hasNextPage"))
    return edges, has_next


def fetch_vod(video_id, max_pages=None):
    """Скачивает чат VOD, пагинируя по contentOffsetSeconds (курсор упирается в integrity-check)."""
    seen = {}
    offset = 0
    pages = 0
    while True:
        try:
            edges, has_next = gql_page(video_id, offset)
        except SystemExit as exc:
            # За концом VOD Twitch отдаёт service error вместо пустых edges: если данные
            # уже собраны, это конец, а не сбой.
            if not seen:
                raise
            print("  VOD %s: конец чата (%s)" % (video_id, exc))
            break
        pages += 1
        fresh = 0
        last = offset
        for edge in edges:
            node = edge.get("node") or {}
            nid = node.get("id")
            if not nid or nid in seen:
                continue
            seen[nid] = node
            fresh += 1
            last = max(last, int(node.get("contentOffsetSeconds") or 0))
        print(
            "  VOD %s: страница %d, +%d сообщений (всего %d)"
            % (video_id, pages, fresh, len(seen))
        )
        if not edges or not has_next or last + 1 <= offset:
            break
        offset = last + 1
        if max_pages and pages >= max_pages:
            print("  VOD %s: стоп по --max-pages %d" % (video_id, max_pages))
            break
        time.sleep(0.4)
    pool = {}
    for node in seen.values():
        comm = node.get("commenter") or {}
        add_incoming(pool, comm.get("displayName"), comm.get("login"), comm.get("id"))
    return pool


def merge(existing, incoming):
    """Добавляет/обновляет записи; aliases не трогает. Возвращает (добавлено, обновлено)."""
    by_id = {e["id"]: e for e in existing if e["id"]}
    by_login = {e["login"].lower(): e for e in existing}
    added, updated = 0, 0
    for inc in incoming.values():
        cur = by_id.get(inc["id"]) if inc["id"] else None
        if cur is None:
            cur = by_login.get(inc["login"].lower())
        if cur is None:
            existing.append(inc)
            by_login[inc["login"].lower()] = inc
            if inc["id"]:
                by_id[inc["id"]] = inc
            added += 1
            print("+ %s (%s)" % (inc["nick"], inc["login"]))
            continue
        changed = []
        if inc["nick"] and inc["nick"] != cur["nick"]:
            changed.append("nick %s -> %s" % (cur["nick"], inc["nick"]))
            cur["nick"] = inc["nick"]
        if inc["id"] and not cur["id"]:
            cur["id"] = inc["id"]
            by_id[inc["id"]] = cur
            changed.append("id %s" % inc["id"])
        if (
            inc["id"]
            and cur["id"] == inc["id"]
            and inc["login"].lower() != cur["login"].lower()
        ):
            by_login.pop(cur["login"].lower(), None)
            by_login[inc["login"].lower()] = cur
            changed.append("login -> %s" % inc["login"])
            cur["login"] = inc["login"]
        if changed:
            updated += 1
            print("~ %s: %s" % (cur["nick"], ", ".join(changed)))
    return added, updated


def main():
    ap = argparse.ArgumentParser(
        description="Sync chatter nicks into content/chatters.toml."
    )
    ap.add_argument(
        "--file",
        default=DEFAULT_FILE,
        help="Реестр (по умолчанию content/chatters.toml)",
    )
    ap.add_argument(
        "--chat",
        action="append",
        default=[],
        help="Готовый chat.json (можно несколько)",
    )
    ap.add_argument(
        "--vod", action="append", default=[], help="ID VOD; чат скачается анонимным GQL"
    )
    ap.add_argument(
        "--exclude",
        default="",
        help="Доп. login-ы через запятую (кроме стримера и ботов)",
    )
    ap.add_argument(
        "--max-pages", type=int, default=0, help="Лимит страниц GQL (диагностика)"
    )
    ap.add_argument("--dry-run", action="store_true", help="Показать план без записи")
    args = ap.parse_args()

    if not args.chat and not args.vod:
        raise SystemExit("Нужен --chat <json> или --vod <id>")

    exclude = set(EXCLUDE)
    exclude |= {x.strip().lower() for x in args.exclude.split(",") if x.strip()}

    incoming = {}
    for path in args.chat:
        try:
            with open(path, "r", encoding="utf-8") as fh:
                data = json.load(fh)
        except FileNotFoundError:
            raise SystemExit("Нет дампа: %s" % path)
        before = len(incoming)
        from_dump(data, incoming)
        print("chat %s: +%d ников" % (path, len(incoming) - before))
    for vid in args.vod:
        before = len(incoming)
        incoming.update(fetch_vod(vid, max_pages=args.max_pages))
        print("vod %s: +%d ников" % (vid, len(incoming) - before))

    filtered = {k: v for k, v in incoming.items() if k not in exclude}
    skipped = sorted(set(incoming) - set(filtered))
    if skipped:
        print("исключены: %s" % ", ".join(skipped))

    chatters = load_existing(args.file)
    added, updated = merge(chatters, filtered)
    chatters.sort(key=lambda c: (c["login"].lower(), c["nick"]))

    output = render(chatters)
    old = ""
    if os.path.exists(args.file):
        with open(args.file, "r", encoding="utf-8") as fh:
            old = fh.read()

    print("итог: +%d новых, ~%d обновлений, всего %d" % (added, updated, len(chatters)))
    if args.dry_run:
        print("dry-run: файл не тронут")
        return 0
    if output == old:
        print("изменений нет — файл не переписываю")
        return 0
    os.makedirs(os.path.dirname(args.file) or ".", exist_ok=True)
    with open(args.file, "w", encoding="utf-8") as fh:
        fh.write(output)
    print("записано: %s" % args.file)
    return 0


if __name__ == "__main__":
    sys.exit(main())
