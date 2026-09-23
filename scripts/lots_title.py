#!/usr/bin/env python3
"""Рекомендуемый title для новой карточки лота из имени файла привета (stdlib).

Использование (из корня репо):
  python3 scripts/lots_title.py privets/Onghanntto.mp4
  python3 scripts/lots_title.py Onghanntto        # путь и расширение не обязательны
  python3 scripts/lots_title.py privets/Evilzerg57 double.mp4

Ник берётся из имени файла и сверяется с реестром ников content/chatters.toml
(ник/login/алиасы, без учёта регистра и разделителей). Правило — docs/agents/chatters.md:
в title пишем канон из реестра. Если кандидатов несколько — скрипт не гадает, а
показывает их; если совпадений нет — отдаёт имя файла с пометкой, что ник надо
сверить руками. Печатает готовый title: `Привет <ник>`.

Секретов не требует; только читает манифест реестра.
"""

import argparse
import os
import sys
import tomllib

DEFAULT_REGISTRY = os.path.join("content", "chatters.toml")


def load_registry(path):
    """Читает реестр ников; возвращает список записей с nick/login/aliases."""
    try:
        with open(path, "rb") as fh:
            data = tomllib.load(fh)
    except FileNotFoundError:
        raise SystemExit("Нет реестра ников: %s" % path)
    out = []
    for entry in data.get("chatters", []):
        nick = entry.get("nick")
        login = entry.get("login")
        if not nick or not login:
            raise SystemExit("Запись без nick/login: %r" % (entry,))
        out.append(
            {
                "nick": str(nick),
                "login": str(login),
                "aliases": [str(a) for a in (entry.get("aliases") or [])],
            }
        )
    return out


def stem_of(raw):
    """Имя файла -> основа без каталога и расширения."""
    return os.path.splitext(os.path.basename(raw))[0].strip()


def squash(value):
    """Сравнительная форма: нижний регистр без разделителей и пунктуации."""
    return "".join(ch for ch in value.lower() if ch.isalnum())


def variants(chatter):
    """Все написания ника: nick, login и алиасы."""
    return [chatter["nick"], chatter["login"], *chatter["aliases"]]


def find_matches(stem, registry):
    """Кандидаты из реестра: сначала точные совпадения, потом вхождения."""
    exact = [c for c in registry if any(squash(v) == squash(stem) for v in variants(c))]
    if exact:
        return exact, "exact"
    lowered = stem.lower()
    squashed = squash(stem)
    partial = [
        c
        for c in registry
        if any(
            len(v) >= 3
            and (v.lower() in lowered or squashed in squash(v) or squash(v) in squashed)
            for v in variants(c)
        )
    ]
    return partial, "partial"


def unique_nicks(chatters):
    seen = []
    for c in chatters:
        if c["nick"] not in seen:
            seen.append(c["nick"])
    return seen


def main():
    ap = argparse.ArgumentParser(
        description="Рекомендуемый title карточки по имени файла и реестру ников."
    )
    ap.add_argument("file", help="Имя файла привета, напр. privets/Onghanntto.mp4")
    ap.add_argument(
        "--registry",
        default=DEFAULT_REGISTRY,
        help="Реестр ников (по умолчанию content/chatters.toml)",
    )
    args = ap.parse_args()

    stem = stem_of(args.file)
    if not stem:
        raise SystemExit("Пустое имя файла: %r" % args.file)

    registry = load_registry(args.registry)
    matches, kind = find_matches(stem, registry)
    nicks = unique_nicks(matches)

    if not nicks:
        print("Ник из файла: %s" % stem)
        print(
            "Реестр: совпадений нет — сверь написание руками (docs/agents/chatters.md)."
        )
        print("title: Привет %s" % stem)
        return 1

    if len(nicks) > 1:
        print("Ник из файла: %s" % stem)
        print("Реестр: неоднозначно — кандидаты: %s" % ", ".join(nicks))
        print("title: <выбери канон и повтори>")
        return 2

    nick = nicks[0]
    login = matches[0]["login"]
    print("Ник из файла: %s" % stem)
    print(
        "Реестр: %s (login: %s)%s"
        % (nick, login, "" if kind == "exact" else " — по вхождению")
    )
    print("title: Привет %s" % nick)
    return 0


if __name__ == "__main__":
    sys.exit(main())
