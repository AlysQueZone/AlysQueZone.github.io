#!/usr/bin/env python3
"""Поиск автора привета по фразе из чата VOD (stdlib, без зависимостей).

Когда файл/карточка не даёт ника, а ник надо резолвить: ищем в чате VOD
характерную фразу из привета (или её часть), печатаем, кто её сказал, и канон
ника из реестра `content/chatters.toml`.

Использование (из корня репо):
  python3 scripts/chatters_find.py --vod 2888034815 "надеюсь меня не переедут"
  python3 scripts/chatters_find.py --vod 2888034815 --until 1800 "переедут"
  python3 scripts/chatters_find.py --chat chat.json "фраза"

Совпадение — по нормализованной подстроке: регистр, пунктуация и эмоуты не
важны. Печатает время (мм:сс), display-имя, login и канон по реестру.
Никаких секретов не требует; `--vod` тянет чат анонимным GQL (см.
docs/agents/twitch-sources.md).
"""

import argparse
import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import chatters_sync as cs  # noqa: E402
import lots_title as lt  # noqa: E402


def fetch_vod_messages(video_id, max_pages=None, until=0):
    """Скачивает чат VOD и возвращает сообщения с текстом (пагинация как в sync).

    until > 0 — остановиться, как только дошли до этой секунды (первый отрезок).
    """
    seen = {}
    offset = 0
    pages = 0
    while True:
        try:
            edges, has_next = cs.gql_page(video_id, offset)
        except SystemExit as exc:
            if not seen or "service error" not in str(exc):
                raise
            break
        pages += 1
        last = offset
        for edge in edges:
            node = edge.get("node") or {}
            nid = node.get("id")
            if not nid or nid in seen:
                continue
            seen[nid] = node
            last = max(last, int(node.get("contentOffsetSeconds") or 0))
        print("  VOD %s: страница %d, всего %d" % (video_id, pages, len(seen)))
        if not edges or not has_next or last + 1 <= offset:
            break
        if until and last >= until:
            print("  VOD %s: дошли до %ds — стоп" % (video_id, until))
            break
        offset = last + 1
        if max_pages and pages >= max_pages:
            print("  VOD %s: стоп по --max-pages %d" % (video_id, max_pages))
            break
        time.sleep(0.4)

    out = []
    for node in seen.values():
        comm = node.get("commenter") or {}
        frags = (node.get("message") or {}).get("fragments") or []
        text = "".join(f.get("text", "") for f in frags)
        if not text:
            continue
        out.append(
            {
                "at": int(node.get("contentOffsetSeconds") or 0),
                "display": comm.get("displayName") or comm.get("login") or "?",
                "login": comm.get("login") or "?",
                "text": text,
            }
        )
    return out


def messages_from_dump(data):
    """Компакт `messages` или нативный `comments` -> список сообщений."""
    out = []
    if isinstance(data.get("messages"), list):
        for m in data["messages"]:
            text = m.get("text") or ""
            if text:
                out.append(
                    {
                        "at": int(m.get("t") or 0),
                        "display": m.get("user") or m.get("login") or "?",
                        "login": m.get("login") or "?",
                        "text": text,
                    }
                )
        return out
    if isinstance(data.get("comments"), list):
        for m in data["comments"]:
            comm = m.get("commenter") or {}
            msg = m.get("message") or {}
            frags = msg.get("fragments") or []
            text = msg.get("body") or "".join(f.get("text", "") for f in frags)
            if text:
                out.append(
                    {
                        "at": int(float(m.get("content_offset_seconds") or 0)),
                        "display": comm.get("display_name") or comm.get("name") or "?",
                        "login": comm.get("name") or "?",
                        "text": text,
                    }
                )
        return out
    raise SystemExit("Не понял форму дампа: нет ни messages, ни comments")


def norm(value):
    """Сравнительная форма: нижний регистр, без пунктуации, одиночные пробелы."""
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s]", " ", value.lower())).strip()


def stamp(seconds):
    return "%d:%02d" % (seconds // 60, seconds % 60)


def canon_of(login, registry):
    """Канон ника по реестру; None, если не найден или неоднозначен."""
    matches, _ = lt.find_matches(login, registry)
    nicks = lt.unique_nicks(matches)
    return nicks[0] if len(nicks) == 1 else None


def main():
    ap = argparse.ArgumentParser(
        description="Найти автора привета по фразе из чата VOD."
    )
    ap.add_argument("phrase", help="Фраза или её часть (регистр/пунктуация не важны)")
    ap.add_argument("--vod", action="append", default=[], help="ID VOD; чат скачается")
    ap.add_argument(
        "--chat",
        action="append",
        default=[],
        help="Готовый chat.json (можно несколько)",
    )
    ap.add_argument(
        "--until",
        type=int,
        default=0,
        help="Искать только до этой секунды VOD (0 — весь чат)",
    )
    ap.add_argument(
        "--registry",
        default=lt.DEFAULT_REGISTRY,
        help="Реестр ников (по умолчанию content/chatters.toml)",
    )
    ap.add_argument(
        "--max-pages", type=int, default=0, help="Лимит страниц GQL (диагностика)"
    )
    args = ap.parse_args()

    if not args.chat and not args.vod:
        raise SystemExit("Нужен --chat <json> или --vod <id>")

    pool = {}
    for path in args.chat:
        try:
            with open(path, "r", encoding="utf-8") as fh:
                data = json.load(fh)
        except FileNotFoundError:
            raise SystemExit("Нет дампа: %s" % path)
        for msg in messages_from_dump(data):
            pool["%s:%s" % (path, msg["text"])] = msg
    for vid in args.vod:
        for msg in fetch_vod_messages(vid, max_pages=args.max_pages, until=args.until):
            pool["%s:%s:%s" % (vid, msg["at"], msg["login"])] = msg

    needle = norm(args.phrase)
    if not needle:
        raise SystemExit("Пустая фраза")

    hits = [
        m
        for m in pool.values()
        if needle in norm(m["text"]) and (not args.until or m["at"] <= args.until)
    ]
    hits.sort(key=lambda m: m["at"])

    if not hits:
        print("Совпадений нет: %s" % args.phrase)
        print("Ищи более короткий/характерный кусок фразы либо другой VOD.")
        return 1

    registry = lt.load_registry(args.registry)
    seen = set()
    for m in hits:
        key = (m["at"], m["login"])
        if key in seen:
            continue
        seen.add(key)
        canon = canon_of(m["login"], registry)
        where = " → канон: %s" % canon if canon else " → в реестре нет (сверь руками)"
        print("[%s] @%s (%s)%s" % (stamp(m["at"]), m["display"], m["login"], where))
        print("    %s" % m["text"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
