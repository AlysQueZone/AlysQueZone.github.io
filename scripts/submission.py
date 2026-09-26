#!/usr/bin/env python3
"""Приём заявки на привет: id -> лот на витрине (stdlib, без зависимостей).

Это агент-ориентированный пайплайн из docs/agents/submissions.md. Команда
делает механическую часть, а смысловые решения (это привет? дубликат?) —
за агентом: жёсткие ошибки и двусмысленности останавливают шаг с кодом 2,
ничего не публикуя.

Использование (из корня репо):
  python3 scripts/submission.py show 12            # что в заявке (только чтение)
  python3 scripts/submission.py fetch 12           # скачать и собрать медиа, СТОП
  python3 scripts/submission.py accept 12 --check  # то же (алиас fetch)
  python3 scripts/submission.py accept 12          # полный путь до лота на витрине
  python3 scripts/submission.py reject 12                     # статус rejected
  python3 scripts/submission.py reject 12 --status duplicate  # статус duplicate

Шаги accept: заявка -> yt-dlp во временную папку -> ffmpeg-тройка по
docs/agents/media-pipeline.md -> storage_upload.py в videos/<slug> -> [[lots]]
в content/lots.toml -> lots_sync.py -> RPC accept_submission -> выплата награды
(RPC pay_submission_reward). Заголовок берётся
из заявки с резолвом ника по реестру content/chatters.toml; слаг — новый
уникальный, привязан к номеру заявки (повторный прогон переиспользует свой).
Отказ ничего не публикует и не платит.

Ключ и ref: env SUPABASE_SERVICE_ROLE_KEY (алиасы SUPABASE_SECRET_KEY,
SERVICE_ROLE_KEY) и PUBLIC_SUPABASE_URL, иначе те же имена из .env файла.
Секреты НИКОГДА не печатаются. `yt-dlp` и `ffmpeg` — внешние инструменты.
"""

import argparse
import json
import os
import re
import subprocess
import sys
import tomllib
import urllib.error
import urllib.parse
import urllib.request

from lots_title import load_registry, squash, variants
from supabase_common import load_dotenv, project_base, resolve, resolve_service_key

# Код возврата «стоп, нужно решение человека» (мёртвая ссылка, дубликат,
# неоднозначный ник). Отличаем от технической ошибки (3).
EXIT_GATE = 2
EXIT_FAIL = 3

DEFAULT_PRICE = 800
OPEN_STATUSES = ("new",)


def root_dir():
    """Корень репо: scripts/submission.py -> два уровня вверх."""
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def say(line=""):
    print(line, flush=True)


def fail(message):
    say("ОШИБКА: %s" % message)
    return EXIT_FAIL


# ---------------------------------------------------------------------------
# Supabase REST (service_role)
# ---------------------------------------------------------------------------


def rest_request(key, method, url, payload=None, prefer=None):
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    headers = {"apikey": key, "Authorization": "Bearer " + key}
    if data is not None:
        headers["Content-Type"] = "application/json"
    if prefer:
        headers["Prefer"] = prefer
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.status, resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", "replace")[:400]
        return exc.code, body
    except urllib.error.URLError as exc:
        return 0, str(exc.reason)


class Config:
    """Ключ и базовый URL без печати секретов; путь к .env и корню репо."""

    def __init__(self, env_path):
        self.root = root_dir()
        dotenv = load_dotenv(env_path)
        self.key = resolve_service_key(dotenv)
        self.base = project_base(resolve("PUBLIC_SUPABASE_URL", dotenv))
        if not self.key or not self.base:
            raise SystemExit(
                "Нет ключа/URL: задай SUPABASE_SERVICE_ROLE_KEY и "
                "PUBLIC_SUPABASE_URL в окружении или в %s" % env_path
            )


def fetch_submission(cfg, sid):
    url = (
        "%s/rest/v1/submissions?id=eq.%d&select=id,author_uid,author_login,title,video_url,comment,status,lot_id,created_at"
        % (
            cfg.base,
            sid,
        )
    )
    status, body = rest_request(cfg.key, "GET", url)
    if status != 200:
        raise SystemExit("GET submission #%d: %s %s" % (sid, status, body))
    rows = json.loads(body)
    if not rows:
        raise SystemExit("Заявка #%d не найдена" % sid)
    return rows[0]


def fetch_lots(cfg):
    url = "%s/rest/v1/lots?select=slug,title,video_url" % cfg.base
    status, body = rest_request(cfg.key, "GET", url)
    if status != 200:
        raise SystemExit("GET lots: %s %s" % (status, body))
    return json.loads(body)


def fetch_decided_submissions(cfg, sid):
    """Заявки, уже решённые по ссылке (кроме текущей): accepted/duplicate."""
    url = (
        "%s/rest/v1/submissions?id=neq.%d&status=in.(accepted,duplicate)"
        "&select=id,status,video_url,title" % (cfg.base, sid)
    )
    status, body = rest_request(cfg.key, "GET", url)
    if status != 200:
        raise SystemExit("GET submissions: %s %s" % (status, body))
    return json.loads(body)


def fetch_lot_id(cfg, slug):
    url = "%s/rest/v1/lots?slug=eq.%s&select=id" % (
        cfg.base,
        urllib.parse.quote(slug, safe=""),
    )
    status, body = rest_request(cfg.key, "GET", url)
    if status != 200:
        raise SystemExit("GET lot %s: %s %s" % (slug, status, body))
    rows = json.loads(body)
    if not rows:
        raise SystemExit("Лот %s не найден после синка" % slug)
    return int(rows[0]["id"])


# ---------------------------------------------------------------------------
# Отчёт по заявке и резолв ника
# ---------------------------------------------------------------------------


def report_submission(sub):
    say("Заявка #%d" % sub["id"])
    say(
        "  автор:      @%s (%s)"
        % (sub.get("author_login") or "?", sub.get("author_uid") or "—")
    )
    say("  название:   %s" % sub.get("title"))
    say("  ссылка:     %s" % sub.get("video_url"))
    comment = sub.get("comment")
    if comment:
        say("  комментарий: %s" % comment)
    say("  статус:     %s" % sub.get("status"))
    if sub.get("lot_id"):
        say("  лот:        #%s" % sub["lot_id"])
    say("  создана:    %s" % sub.get("created_at"))


def replace_variants(title, chatter):
    """Заменить все написания ника на канон (без учёта регистра).

    Возвращает (title, заменённые), где «заменённые» — реально встреченные
    варианты, отличные от канона: их человеку нужно дописать в aliases
    (docs/agents/chatters.md).
    """
    names = sorted(
        {v for v in variants(chatter) if len(squash(v)) >= 3},
        key=len,
        reverse=True,
    )
    if not names:
        return title, []
    pattern = re.compile("|".join(re.escape(n) for n in names), re.IGNORECASE)
    replaced = []

    def _sub(match):
        found = match.group(0)
        if squash(found) != squash(chatter["nick"]):
            replaced.append(found)
        return chatter["nick"]

    return pattern.sub(_sub, title), replaced


def resolve_title(title, registry):
    """Резолв ника в заголовке по реестру.

    Возвращает (title, nick, candidates, kind, replaced), где kind:
      exact/partial — ник найден и канонизирован;
      ambiguous     — кандидатов несколько, решает человек;
      none          — совпадений нет (заголовок как есть, сверь руками);
    replaced — написания-варианты, заменённые на канон (для подсказки про aliases).
    """
    tokens = re.findall(r"[0-9A-Za-zА-Яа-яЁё_]+", title)
    exact = {}
    for c in registry:
        if any(squash(t) == squash(v) for v in variants(c) for t in tokens):
            exact[c["nick"]] = c
    if len(exact) == 1:
        c = next(iter(exact.values()))
        canon, replaced = replace_variants(title, c)
        return canon, c["nick"], [], "exact", replaced
    if len(exact) > 1:
        return title, None, sorted(exact), "ambiguous", []

    sq = squash(title)
    partial = {}
    for c in registry:
        for v in variants(c):
            sv = squash(v)
            if len(sv) >= 4 and sv in sq:
                partial[c["nick"]] = c
                break
    if len(partial) == 1:
        c = next(iter(partial.values()))
        canon, replaced = replace_variants(title, c)
        return canon, c["nick"], [], "partial", replaced
    if len(partial) > 1:
        return title, None, sorted(partial), "ambiguous", []
    return title, None, [], "none", []


def alias_hint(replaced, nick):
    """Подсказка дописать варианты в aliases реестра (реестр правит человек)."""
    if not replaced or not nick:
        return None
    listed = ", ".join("'%s'" % r for r in dict.fromkeys(replaced))
    return (
        "Подсказка: допиши вариант %s в aliases ника '%s' в content/chatters.toml "
        "(docs/agents/chatters.md)." % (listed, nick)
    )


# ---------------------------------------------------------------------------
# Слаг
# ---------------------------------------------------------------------------


def slugify(value):
    value = re.sub(r"[^a-z0-9]+", "-", (value or "").lower())
    return value.strip("-")


def manifest_info(path):
    """{slug: title} из content/lots.toml (для уникальности и повторного запуска)."""
    try:
        with open(path, "rb") as fh:
            data = tomllib.load(fh)
    except FileNotFoundError:
        return {}
    out = {}
    for lot in data.get("lots", []):
        if lot.get("slug"):
            out[str(lot["slug"])] = str(lot.get("title") or "")
    return out


def choose_slug(explicit, sub, taken, manifest):
    """Слаг привязан к заявке.

    Базовый слаг всегда включает id заявки, поэтому он уникален для заявки:
    повторный прогон ТОЙ ЖЕ заявки находит свой слаг в манифесте/БД и
    переиспользует его, а разные заявки (даже один автор с одинаковым
    заголовком) получают разные лоты. Совпадение с уже существующим слагом
    считаем прошлым прогоном этой же заявки, а не коллизией.
    """
    if explicit:
        if explicit in taken:
            raise SystemExit("Слаг уже занят: %s" % explicit)
        return explicit

    # id заявки в слаге делает его нашим и разводит разные заявки.
    return "lot-sub-%s-%d" % (slugify(sub.get("author_login")) or "author", sub["id"])


# ---------------------------------------------------------------------------
# Дубликаты
# ---------------------------------------------------------------------------


def normalized_url(url):
    try:
        parts = urllib.parse.urlsplit(url or "")
        return (parts.scheme.lower(), parts.netloc.lower(), parts.path.rstrip("/"))
    except ValueError:
        return (None, None, None)


def find_duplicates(sub, lots):
    """Возвращает (по ссылке, по названию): списки лотов-кандидатов."""
    want_url = normalized_url(sub.get("video_url"))
    want_title = (sub.get("title") or "").strip().casefold()
    by_url = []
    by_title = []
    for lot in lots:
        if (
            want_url != (None, None, None)
            and normalized_url(lot.get("video_url")) == want_url
        ):
            by_url.append(lot)
        if want_title and (lot.get("title") or "").strip().casefold() == want_title:
            by_title.append(lot)
    return by_url, by_title


def find_decided_duplicates(sub, decided):
    """Ранее решённые заявки (accepted/duplicate) на ту же нормализованную ссылку.

    Нужны потому, что у опубликованных пайплайном лотов `lots.video_url` —
    Storage-URL, а исходная ссылка осталась только в `submissions`.
    """
    want_url = normalized_url(sub.get("video_url"))
    if want_url == (None, None, None):
        return []
    return [s for s in decided if normalized_url(s.get("video_url")) == want_url]


# ---------------------------------------------------------------------------
# Скачивание и медиа
# ---------------------------------------------------------------------------


class GateStop(Exception):
    """Мягкая остановка: нужно решение человека (код 2)."""


DIRECT_SUFFIXES = (".mp4", ".webm", ".mov", ".mkv", ".m4v")


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
        raise GateStop("не найден yt-dlp — установи его и повтори")
    if proc.returncode == 0:
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
            raise GateStop("не удалось скачать прямую ссылку: %s" % exc)

    tail = (proc.stderr or "").strip().splitlines()
    reason = tail[-1] if tail else "yt-dlp не справился"
    raise GateStop("ссылка мёртвая/приватная или не поддержана: %s" % reason)


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
        raise GateStop("не найден ffmpeg — установи его и повтори")
    if proc.returncode != 0:
        tail = (proc.stderr or "").strip().splitlines()
        raise GateStop("ffmpeg упал: %s" % (tail[-1] if tail else proc.returncode))
    return True


def build_triple(source, workdir, slug):
    """Тройка webm/mp4/webp по docs/agents/media-pipeline.md (кэш по наличию)."""
    webm = os.path.join(workdir, slug + ".webm")
    mp4 = os.path.join(workdir, slug + ".mp4")
    webp = os.path.join(workdir, slug + ".webp")
    if not os.path.exists(webm):
        say("Собираю %s…" % os.path.basename(webm))
        run_ffmpeg(
            [
                "-i",
                source,
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
    if not os.path.exists(mp4):
        say("Собираю %s…" % os.path.basename(mp4))
        run_ffmpeg(
            [
                "-i",
                source,
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
    if not os.path.exists(webp):
        say("Собираю %s…" % os.path.basename(webp))
        run_ffmpeg(["-i", source, "-vframes", "1", "-q:v", "80", webp])
    return [webm, mp4, webp]


# ---------------------------------------------------------------------------
# Публикация
# ---------------------------------------------------------------------------


def upload_videos(cfg, files):
    cmd = [
        sys.executable,
        os.path.join(cfg.root, "scripts", "storage_upload.py"),
        "--bucket",
        "media",
        "--dest",
        "videos/",
        *files,
    ]
    say("Заливаю в Storage (videos/)…")
    proc = subprocess.run(cmd, cwd=cfg.root)
    if proc.returncode != 0:
        raise SystemExit("storage_upload.py завершился с кодом %d" % proc.returncode)


def toml_escape(value):
    return str(value).replace("\\", "\\\\").replace('"', '\\"')


def append_lot(cfg, slug, title, price, video_url):
    path = os.path.join(cfg.root, "content", "lots.toml")
    with open(path, "r", encoding="utf-8") as fh:
        text = fh.read()
    if slug in manifest_info(path):
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


def run_lots_sync(cfg):
    say("Синк контента (scripts/lots_sync.py)…")
    proc = subprocess.run(
        [sys.executable, os.path.join(cfg.root, "scripts", "lots_sync.py")],
        cwd=cfg.root,
    )
    if proc.returncode != 0:
        raise SystemExit("lots_sync.py завершился с кодом %d" % proc.returncode)


def call_accept(cfg, sid, lot_id):
    status, body = rest_request(
        cfg.key,
        "POST",
        "%s/rest/v1/rpc/accept_submission" % cfg.base,
        {"p_submission_id": sid, "p_lot_id": lot_id},
    )
    if status not in (200, 204):
        raise SystemExit("accept_submission #%d: %s %s" % (sid, status, body))
    say("Заявка #%d принята, связана с лотом id=%d" % (sid, lot_id))


def call_reward(cfg, sid):
    """Выплата награды автору: только после accept, идемпотентна на сервере."""
    status, body = rest_request(
        cfg.key,
        "POST",
        "%s/rest/v1/rpc/pay_submission_reward" % cfg.base,
        {"p_submission_id": sid},
    )
    if status not in (200, 204):
        raise SystemExit("pay_submission_reward #%d: %s %s" % (sid, status, body))

    outcome = ""
    text = (body or "").strip()
    if text:
        try:
            outcome = str(json.loads(text))
        except ValueError:
            outcome = text.strip('"')
    messages = {
        "paid": "Награда за заявку #%d выплачена (+500 и 3%% с первых 3 перекупов)"
        % sid,
        "already": "Награда за заявку #%d уже выплачена — повторно не платим" % sid,
        "no_account": "У автора заявки #%d нет счёта — выплаты нет" % sid,
    }
    say(messages.get(outcome, "Награда за заявку #%d обработана" % sid))


def call_reject(cfg, sid, status_name):
    status, body = rest_request(
        cfg.key,
        "POST",
        "%s/rest/v1/rpc/reject_submission" % cfg.base,
        {"p_submission_id": sid, "p_status": status_name},
    )
    if status not in (200, 204):
        raise SystemExit("reject_submission #%d: %s %s" % (sid, status, body))
    say("Заявка #%d помечена как %s (выплат нет)" % (sid, status_name))


# ---------------------------------------------------------------------------
# Команды
# ---------------------------------------------------------------------------


def suggest_title(sub, explicit):
    if explicit:
        return explicit, None, [], "manual", []
    registry = load_registry(os.path.join(root_dir(), "content", "chatters.toml"))
    return resolve_title(sub.get("title") or "", registry)


def stop_ambiguous(candidates):
    say("STOP: ник в заголовке неоднозначен — кандидаты: %s" % ", ".join(candidates))
    say('Спроси человека и передай готовый заголовок: --title "…"')
    return EXIT_GATE


def prepare(cfg, sub, args):
    """Локальная подготовка: заголовок, слаг, скачивание, медиа-тройка."""
    title, nick, candidates, kind, replaced = suggest_title(sub, args.title)
    if candidates:
        return None, stop_ambiguous(candidates)

    existing = fetch_lots(cfg)
    dup_url, dup_title = find_duplicates(sub, existing)
    if dup_url:
        say("STOP: этот клип уже на бирже — дубликат.")
        for lot in dup_url:
            say("  %s — %s" % (lot["slug"], lot["title"]))
        say("Откажи командой: just submission-reject %d --status duplicate" % sub["id"])
        return None, EXIT_GATE
    dup_decided = find_decided_duplicates(
        sub, fetch_decided_submissions(cfg, sub["id"])
    )
    if dup_decided:
        say("STOP: на этот клип уже есть решённая заявка — дубликат.")
        for other in dup_decided:
            mark = (
                "принята"
                if other.get("status") == "accepted"
                else "отклонена как дубликат"
            )
            say("  заявка #%s — %s (%s)" % (other["id"], other.get("title"), mark))
        say("Откажи командой: just submission-reject %d --status duplicate" % sub["id"])
        return None, EXIT_GATE
    if dup_title:
        say("ВНИМАНИЕ: лот с точно таким названием уже есть — проверь на дубликат:")
        for lot in dup_title:
            say("  %s — %s" % (lot["slug"], lot["title"]))

    say("Заголовок: %s" % title)
    if kind == "exact":
        say("Ник по реестру: %s" % nick)
    elif kind == "partial":
        say("Ник по реестру: %s (по вхождению)" % nick)
    elif kind == "none":
        say(
            "Ник в реестре не найден — сверь написание руками (docs/agents/chatters.md)."
        )
    else:
        say("Заголовок задан вручную.")
    hint = alias_hint(replaced, nick)
    if hint:
        say(hint)

    manifest_path = os.path.join(cfg.root, "content", "lots.toml")
    manifest = manifest_info(manifest_path)
    slug = choose_slug(args.slug, sub, {lot["slug"] for lot in existing}, manifest)
    say("Слаг: %s" % slug)

    workdir = args.workdir or os.path.join("/tmp", "alysque-submission-%d" % sub["id"])
    source = download_video(sub["video_url"], workdir)
    triple = build_triple(source, workdir, slug)
    return {"title": title, "slug": slug, "workdir": workdir, "triple": triple}, None


def print_review(ctx):
    say()
    say("Готово к проверке (ничего не опубликовано):")
    say("  исходник: %s" % find_source(ctx["workdir"]))
    for path in ctx["triple"]:
        size = os.path.getsize(path) if os.path.exists(path) else 0
        say("  медиа:    %s (%.1f МБ)" % (path, size / (1 << 20)))
    say("  слаг:     %s" % ctx["slug"])
    say("  заголовок: %s" % ctx["title"])
    say()
    say("Посмотри клип. Если это привет и не дубликат — публикуй полным проходом")
    say("(just submission <id>). Если нет — откажи:")
    say("  just submission-reject <id> [--status duplicate]")


def cmd_show(cfg, args):
    sub = fetch_submission(cfg, args.submission_id)
    report_submission(sub)
    title, nick, candidates, kind, replaced = suggest_title(sub, None)
    say("  заголовок:  %s" % title)
    if candidates:
        say("  ник:        неоднозначно — %s" % ", ".join(candidates))
    elif nick:
        say("  ник:        %s (%s)" % (nick, kind))
    else:
        say("  ник:        в реестре не найден — сверь руками")
    hint = alias_hint(replaced, nick)
    if hint:
        say("  %s" % hint)
    return 0


def cmd_fetch(cfg, args):
    sub = fetch_submission(cfg, args.submission_id)
    report_submission(sub)
    if sub.get("status") not in OPEN_STATUSES:
        return fail("заявка уже не новая (status=%s)" % sub.get("status"))
    ctx, code = prepare(cfg, sub, args)
    if ctx is None:
        return code
    print_review(ctx)
    return 0


def cmd_accept(cfg, args):
    sub = fetch_submission(cfg, args.submission_id)
    report_submission(sub)
    if sub.get("status") not in OPEN_STATUSES:
        return fail("заявка уже не новая (status=%s)" % sub.get("status"))

    ctx, code = prepare(cfg, sub, args)
    if ctx is None:
        return code
    if args.check:
        print_review(ctx)
        return 0

    upload_videos(cfg, ctx["triple"])
    video_url = "%s/storage/v1/object/public/media/videos/%s.webm" % (
        cfg.base,
        ctx["slug"],
    )
    append_lot(cfg, ctx["slug"], ctx["title"], args.price, video_url)
    run_lots_sync(cfg)
    lot_id = fetch_lot_id(cfg, ctx["slug"])
    call_accept(cfg, sub["id"], lot_id)
    call_reward(cfg, sub["id"])
    say(
        "Готово: лот %s (id=%d) на витрине, заявка #%d принята"
        % (ctx["slug"], lot_id, sub["id"])
    )
    return 0


def cmd_reject(cfg, args):
    if args.status not in ("rejected", "duplicate"):
        return fail("--status принимает только rejected или duplicate")
    sub = fetch_submission(cfg, args.submission_id)
    report_submission(sub)
    status = sub.get("status")
    if status == "accepted":
        return fail("заявка уже принята — отказ не применяем")
    if status in ("rejected", "duplicate"):
        say("Заявка #%d уже решена (status=%s) — ничего не меняю" % (sub["id"], status))
        return 0
    call_reject(cfg, sub["id"], args.status)
    return 0


def add_common(sub):
    sub.add_argument("submission_id", type=int, help="номер заявки (#N)")

    sub.add_argument("--env", default=os.path.join(root_dir(), ".env"))
    sub.add_argument(
        "--workdir", default=None, help="Временная папка (по умолчанию /tmp/…)"
    )


def build_parser():
    parser = argparse.ArgumentParser(
        prog="submission",
        description="Приём заявки на привет: id -> лот на витрине",
    )
    subs = parser.add_subparsers(dest="command", required=True)

    p_accept = subs.add_parser(
        "accept", help="Полный путь (или --check: стоп после сборки)"
    )
    p_accept.add_argument("submission_id", type=int)
    p_accept.add_argument("--env", default=os.path.join(root_dir(), ".env"))
    p_accept.add_argument("--workdir", default=None)
    p_accept.add_argument(
        "--price", type=int, default=DEFAULT_PRICE, help="Стартовая цена"
    )
    p_accept.add_argument(
        "--slug", default=None, help="Слаг вручную (иначе уникальный новый)"
    )
    p_accept.add_argument(
        "--title", default=None, help="Заголовок вручную (обход резолва)"
    )
    p_accept.add_argument(
        "--check", action="store_true", help="Остановиться перед публикацией"
    )
    p_accept.set_defaults(func=cmd_accept)

    p_fetch = subs.add_parser("fetch", help="Скачать и собрать медиа, остановиться")
    add_common(p_fetch)
    p_fetch.add_argument("--price", type=int, default=DEFAULT_PRICE)
    p_fetch.add_argument("--slug", default=None)
    p_fetch.add_argument("--title", default=None)
    p_fetch.set_defaults(func=cmd_fetch)

    p_show = subs.add_parser("show", help="Показать заявку и заголовок (чтение)")
    add_common(p_show)
    p_show.set_defaults(func=cmd_show)

    p_reject = subs.add_parser("reject", help="Отклонить заявку без выплаты")
    add_common(p_reject)
    p_reject.add_argument(
        "--status",
        default="rejected",
        choices=("rejected", "duplicate"),
        help="rejected (по умолчанию) или duplicate",
    )
    p_reject.set_defaults(func=cmd_reject)

    return parser


def main(argv):
    argv = list(argv)
    commands = {"accept", "fetch", "show", "reject"}
    # `just submission <id>` и `just submission <id> --check` — короткий вход.
    if argv and argv[0] not in commands and argv[0] not in ("-h", "--help"):
        argv = ["accept"] + argv

    parser = build_parser()
    args = parser.parse_args(argv)

    try:
        cfg = Config(args.env)
        return args.func(cfg, args)
    except GateStop as exc:
        say("STOP: %s" % exc)
        return EXIT_GATE
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
