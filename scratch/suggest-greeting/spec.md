# Спека: «Предложить привет»

> Решения зафиксированы картой [`map.md`](map.md) (тикеты `issues/01…07`), отчёты — в [`research/`](research/),
> выбранный UI — [`prototype/suggest-greeting-ui.html`](prototype/suggest-greeting-ui.html) (вариант E).
> Спека — вход для нарезки на тикеты реализации; кода фичи пока нет.

## 1. Суть

Чатерс, вошедший через Twitch, предлагает привет для биржи: **название**, **ссылку на видео**, необязательный
**комментарий**. Заявка получает номер `#N` и уходит админу в Telegram. Админ по номеру запускает агента,
который собирает карточку лота. Принятая заявка приносит отправителю **+500 Пивкойнов сразу** и **3% с первых
трёх перекупов**; отправитель указывается на странице лота как **«Привет добавил: <ник>»**. Загрузки файлов
нет — только ссылка.

## 2. Сценарий

1. Под витриной `/lots/` — тихая ссылка «Не нашёл свой привет? Предложи →»; по клику раскрывается секция:
   слева форма, справа информация.
2. Гость может заполнить поля, но отправка предлагает «▶ Войти через Twitch» (вход нужен, чтобы начислить
   награду и дать авторство).
3. Отправка → серверный BEFORE-триггер валидирует и пишет строку `submissions` (`status = 'new'`) →
   AFTER-триггер шлёт админу сообщение в Telegram.
4. Клиент показывает «Заявка #N улетела админу».
5. Админ решает: пересылает `#N` агенту → `just submission <id>` (или `just submission-reject <id>`).
6. Агент собирает лот по медиа-пайплайну, связывает его с заявкой, ставит `accepted` и начисляет +500.
7. При следующем заходе отправитель один раз видит всплывашку «🎉 Твоя заявка #N принята — привет на бирже!».
8. Лот живёт обычной жизнью: с первых трёх перекупов 3% цены сделки уходят автору заявки.

## 3. UI (вариант E)

- **Точка входа**: свёрнутая тихая ссылка под сеткой «Все лоты» на `/lots/`; раскрывается/сворачивается по
  клику. Модалок нет; разметка — в прототипе.
- **Форма (левая колонка)**: «Название привета»; «Ссылка на видео» (подпись «Twitch clip / YouTube / MemeAlerts
  и т.д.»); «Комментарий» (placeholder «В этом VOD на 15:01 отличный привет»); кнопка отправки. Для гостя —
  кнопка входа; рядом с ней пометка «🔒 Войти через Twitch нужно, чтобы начислить награду и получить авторство».
- **Инфо (правая колонка)**: краткая инструкция («Предлагаемое видео должно быть по смыслу похоже на уже
  существующие приветы»); «🍺 За принятый привет начисляются Пивкойны»; «✍️ В карточке лота будешь указан как
  „Привет добавил: <ник>“».
- **Состояния**: отправка (disabled + скелетон), успех («Заявка #N улетела админу»), ошибки (не тот хост,
  не вошёл, лимит заявок). Точные тексты — на согласование (см. §10).
- Клиентская логика — новый `src/lib/submissions.ts` (создание, чтение своих принятых, метка «показано»),
  по правилам проекта: данные и гейты — серверные, клиент только показывает.

## 4. Схема данных

### 4.1. Таблица `public.submissions`

```sql
create table public.submissions (
  id          bigint generated always as identity primary key,  -- он же #N
  author_uid  uuid null references auth.users (id) on delete set null,
  author_login text not null,                                   -- снимок ника
  title       text not null check (char_length(title) between 3 and 120),
  video_url   text not null,
  comment     text null check (comment is null or char_length(comment) <= 500),
  status      text not null default 'new' check (status in ('new','accepted','rejected','duplicate')),
  lot_id      bigint null references public.lots (id) on delete set null,
  rewarded_at timestamptz null,                                 -- разовая награда выплачена
  notified_at timestamptz null,                                 -- всплывашка о принятии показана
  created_at  timestamptz not null default now(),
  decided_at  timestamptz null
);
```

- **Гранты + RLS + sequence** — по шаблону `docs/agents/supabase.md` (30.10.2026 гранты не выдаются автоматом):
  `revoke all … from anon, authenticated`; `grant select, insert on public.submissions to authenticated`;
  `grant select, insert, update, delete … to service_role`; `grant usage, select on sequence
public.submissions_id_seq to authenticated, service_role`; `enable row level security`.
  Политики: `select` и `insert` — только свои (`author_uid = auth.uid()`); update/delete клиенту нет.
- **BEFORE-триггер `enforce_submission_rules`** (паттерн покупок): `auth.uid()` обязателен; `author_uid` и
  `author_login` берутся из сессии/JWT (как в `enforce_purchase_rules`); `status/lot_id/rewarded_at/notified_at`
  клиент задать не может (перезаписываются); `video_url` — только `https` и хост из allowlist (Twitch,
  YouTube, MemeAlerts, Medal, Streamable, VK), нормализация (lower-case host, без fragment и utm); длины
  полей; **не больше 10 открытых заявок** (`status = 'new'`) на одного чатерса.
- **AFTER-триггер** — уведомление в Telegram (§6).

### 4.2. Связь с лотом и подпись

- При принятии агент заполняет у лота `suggested_by_uid` и `suggested_by_login` (новые nullable-колонки
  `public.lots`) — чтобы страница лота и триггер покупки не читали чужие заявки (RLS заявок «только свои»).
- Вью `lots_with_next_price` отдаёт `suggested_by_login` (состав колонок меняется → `DROP VIEW + CREATE`, не
  `CREATE OR REPLACE` — правило `docs/agents/supabase.md`).
- «Привет добавил: <ник>» показывается **только в подробностях карточки лота** (`/lot/?id=…`), не в `/lots/`.

### 4.3. Деньги: награда и роялти (тикет 04)

- **Разово +500** при принятии: RPC `pay_submission_reward(p_submission_id bigint)` — `security definer`,
  идемпотентный (`rewarded_at is null` + `for update`), только `service_role` (`revoke … from public, anon,
authenticated; grant execute … to service_role`). Пишет `ledger` источником `submission_bonus` (+500 автору).
  Если `author_uid` удалён — выплаты нет (профиль «потерянному» uid не создаём).
- **Роялти 3% с первых 3 перекупов** (сделки с продавцом; первый забор — без роялти) — в `apply_purchase`
  - ставка в `royalty_rate()` (по образцу `commission_rate()`, revoke от клиента). Продавец получает как
    сегодня (цена − 7%); комиссия делится: 3% → автору (`royalty_credit`), остаток — `commission_burn`.
    В правилах: «комиссия 7%: 4% сгорает + 3% автору». Дальше 3-го перекупа роялти нет.
- Леджер: строки `submission_bonus` (разово) и `royalty_credit` (роялти). Инвариант «баланс = сумма движений»
  держится; `manual_adjustment` — служебный источник компенсаций (миграция `20260926120000`).

## 5. Статусы

`new → accepted / rejected / duplicate`; меняет **только** агент/админ через `service_role`
(`just submission` / `just submission-reject`). Отправителю статусы не показываем; отклонённые и дубликаты
остаются в таблице как история.

## 6. Telegram

- Транспорт — вариант A тикета 01: AFTER-триггер заявки → функция в непубличной схеме `private` (security
  definer, `search_path = ''`) → `net.http_post` (pg_net) в `api.telegram.org`; секреты `telegram_bot_token`
  и `telegram_admin_chat_id` — в Supabase Vault (в git не попадают); доставка at-most-once; сбой уведомления
  не откатывает заявку (обёртка в `exception`).
- Шаблон сообщения — см. тикет 06 (`#id` первым, без превью ссылки; комментарий — строкой, если есть).
- Настройка (человек): @BotFather `/newbot` → `/start` боту → `getUpdates` за `chat_id` → секреты в Vault;
  локально секретов нет — функция тихо ничего не шлёт.

## 7. Пайплайн агента

- Документ — новый `docs/agents/submissions.md` + указатель в `AGENTS.md`; `media-pipeline.md` не дублируем.
- `just submission <id>` (`scripts/submissions.py`): читает заявку; скачивает видео по ссылке локально
  (`yt-dlp`/`ffmpeg`); проверяет, что это по смыслу привет; собирает тройку media и карточку
  `content/lots.toml` по `media-pipeline.md` (заголовок — из заявки с резолвом ника по `docs/agents/chatters.md`;
  слаг — новый уникальный); `just lots-sync`; связывает `lot_id`, пишет `suggested_by_*`; ставит `accepted`;
  вызывает `pay_submission_reward`.
- `just submission-reject <id>`: `rejected` (или `duplicate`, если привет уже на бирже), без выплаты.
- **Отказ — всегда решение человека**: при проблемах (мёртвая/приватная ссылка, не похоже на привет,
  дубликат) агент останавливается и докладывает.

## 8. Уведомление отправителя о принятии

- Всплывающее уведомление при заходе, **метка на сервере** (localStorage не годится: метка per-browser →
  повторы на другом устройстве).
- Клиент при загрузке берёт свои `accepted`-заявки с `notified_at is null`, показывает всплывашку и вызывает
  RPC `mark_submissions_notified(p_ids bigint[])` (`security definer`, только свои, `grant execute to
authenticated`). Если вызов не дошёл — покажется в следующий заход.
- Универсального центра уведомлений не делаем (колокольчик — про перекупы; отдельный рефактор) — не-цель.

## 9. Витрина и правила

- «Правила биржи» (`src/components/RulesModal.astro`): пункт «Как предложить привет» + «За принятый привет:
  +500 и 3% с первых трёх перекупов (комиссия 7%: 4% сгорает, 3% автору)».
- Бегущая строка (`src/layouts/BaseLayout.astro`, шаблон без сделок) — упоминание механики.
- `CONTEXT.md`: новые термины **«Заявка»** и **«Награда за принятый привет»**; `docs/agents/economy.md` —
  строка, что награда вошла в «живые правила».

## 10. Края и анти-спам

- Дубликат/повторная заявка — выплата одна (привязана к id заявки); заявка на привет, который уже на бирже,
  отклоняется как `duplicate` без награды.
- Аккаунт автора удалён — `author_uid = null`; выплаты прекращаются, разовая не откатывается.
- Самофарм: лимит **10 открытых заявок** на чатерса; ручное принятие — основной барьер. Ужесточаем, если
  станет реальной проблемой.
- Права на видео и NSFW — человеческий гейт при принятии (агент останавливается и спрашивает).
- Судьба отклонённых заявок (чистка/архив) — открытый вопрос, решается при реализации.

## 11. Не-цели

- Загрузка файлов в Storage (безопасный рецепт — в research 02, если понадобится позже).
- Мини-админка, Telegram-бот с кнопками, автоматическое принятие.
- Анонимные заявки без логина; награда поприветствованному чатерсу; публичная очередь/голосование;
  список «Мои заявки» со статусами; универсальный центр уведомлений.

## 12. Порядок реализации (черновик для `to-tickets`)

1. Миграция: `submissions` + гранты/RLS/sequence + BEFORE-триггер.
2. Миграция: `lots.suggested_by_uid/login` + `DROP/CREATE` вью `lots_with_next_price`.
3. Миграция: Telegram-триггер (`private` + pg_net) + runbook Vault.
4. Миграция: `royalty_rate()`, правка `apply_purchase`, RPC `pay_submission_reward`,
   `mark_submissions_notified`.
5. Клиент: форма E, успех/ошибки, всплывашка о принятии, подпись на странице лота, правила + бегущая строка.
6. Пайплайн: `docs/agents/submissions.md` + указатель, `just submission` / `submission-reject`,
   `scripts/submissions.py`.
7. Человек: бот у @BotFather, `/start`, `chat_id` в Vault.
