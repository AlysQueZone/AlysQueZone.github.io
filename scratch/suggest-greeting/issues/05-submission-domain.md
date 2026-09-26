# Домен и схема заявок: термины, статусы, приём файлов

Status: resolved
Type: grilling
Blocked by: 02, 04

## Question

Какая модель у заявки на привет и как она живёт в схеме?

- Термины: как называем заявку и чатерса, который предложил привет. Подпись в UI уже решена владельцем: **«Привет добавил: <ник>»** (вместо «Автор привета»/«Находчик» — их не используем). Что уезжает в `CONTEXT.md`.
- Поля заявки: id для Telegram (человекочитаемый: serial или короткий), uid и ник, название привета, ссылка и/или `storage_path`, комментарий, статус, даты, связь с лотом-результатом, признак выплаченной награды.
- Статусы и переходы: новая → принята / отклонена / дубликат; что видно отправителю. Гранты + RLS + sequence по шаблону `docs/agents/supabase.md` (новая таблица — гранты в той же миграции).
- Приём файлов: **решено владельцем — в v1 загрузки нет, только ссылка** (research 02 дал безопасный рецепт бакета `submissions`, если понадобится позже). Что попадает в схему и спеку.
- Показ: подпись **«Привет добавил: <ник>»** на странице лота (только карточка лота, не `/lots/`) — где именно в карточке.
- Ответ: таблица(ы) + политики + термины + подпись в UI.

## Comments

Ответы владельца (26.09.2026):

- Термин: **«Заявка»**; награда — **«Награда за принятый привет»** (в правилах: «За принятый привет: +500 и 3% с первых 3 перекупов»).
- Запись заявки: (a) прямой insert под RLS «свои» + BEFORE-триггер: https, allowlist хостов, длины, лимит **10 открытых заявок на одного чатерса**; id — серийный `#N` (его шлём в Telegram).
- Статусы: (a) `new / accepted / rejected / duplicate`, меняет только агент/админ; отправителю статус в v1 не показываем.
- Подпись «Привет добавил: <ник>» — только в подробностях карточки лота (`/lot/?id=...`), в `/lots/` и списках не показываем.

Открыто: **уведомление отправителя о принятии** — владелец просит подумать и выбрать простое; варианты в обсуждении (всплывашка при заходе / список «Мои заявки» / колокольчик / бегущая строка).

## Answer

Термины: **«Заявка»**, **«Награда за принятый привет»**; подпись — «Привет добавил: <ник>».

### Таблица `public.submissions`

- `id bigint generated always as identity` — он же человекочитаемый `#N` для Telegram и агента.
- `author_uid uuid null references auth.users (id) on delete set null`, `author_login text not null` (снимок ника для подписи).
- `title text not null`, `video_url text not null`, `comment text null`.
- `status text not null default 'new' check (status in ('new','accepted','rejected','duplicate'))`, `created_at timestamptz`, `decided_at timestamptz null`.
- `lot_id bigint null references public.lots (id) on delete set null` — связь с принятым лотом (роялти, статус).
- `rewarded_at timestamptz null` — идемпотентность разовой награды (тикет 04).
- `notified_at timestamptz null` — всплывашка о принятии показана (см. ниже).
- Гранты + RLS + `usage` на sequence — по шаблону `docs/agents/supabase.md`: `revoke all` от anon; `grant select, insert on public.submissions to authenticated`; `grant … to service_role`; sequence — `usage, select`. RLS: select/insert только свои (`author_uid = auth.uid()`); update/delete клиенту нет.

### Путь записи — вариант (a)

- Клиент делает прямой `insert` под RLS; BEFORE-триггер `enforce_submission_rules`: uid обязателен; `video_url` — только https и хост из allowlist (Twitch, YouTube, MemeAlerts, Medal, Streamable, VK), нормализация (lower-case host, без fragment и utm); длины `title`/`comment`; **не больше 10 открытых заявок** (`status = 'new'`) на одного чатерса. AFTER — уведомление в Telegram (транспорт — тикет 01, состав — тикет 06).
- Правила серверные; клиентские проверки — только для UX.

### Статусы и что видит отправитель

- `new → accepted / rejected / duplicate`; меняет только агент/админ через `service_role` (скрипт/SQL/пайплайн). Список своих заявок со статусами в v1 не делаем.

### Награда, роялти и подпись на лоте

- Принятие: идемпотентный RPC `pay_submission_reward(p_submission_id)` (`service_role`): статус `accepted`, связь с лотом, +500 (`submission_bonus`), `rewarded_at`.
- Роялти 3% с первых 3 перекупов из комиссии — в `apply_purchase` + `royalty_rate()`. Чтобы покупке и странице лота не читать чужие заявки (RLS «только свои»), автор денормализуется на лот: `lots.suggested_by_uid uuid null`, `lots.suggested_by_login text null` (заполняются при принятии).
- «Привет добавил: <ник>» — только в подробностях карточки лота (`/lot/?id=…`); в `/lots/` и списках не показываем.

### Уведомление о принятии — всплывашка с серверной меткой

- localStorage не годится: метка per-browser → на другом устройстве/после чистки те же принятые заявки покажутся снова (у колокольчика это осознанный лимит, нам не подходит).
- Решение: `submissions.notified_at` + RPC `mark_submissions_notified(p_ids bigint[])` (`security definer`, только свои заявки, `grant execute to authenticated`). При загрузке клиент берёт свои `accepted`-заявки с `notified_at is null`, показывает всплывающее уведомление («🎉 Твоя заявка #12 принята — привет на бирже!») и вызывает RPC. Повтор между браузерами исключён; если RPC не дошёл (оффлайн) — покажется в следующий заход.
- Колокольчик как канал — не сейчас: универсальной архитектуры уведомлений в проекте нет (`outbid-notice.ts` — про перекупы: Realtime по смене владельца `lots`, история из `purchases`, непрочитанное в localStorage per-uid); встраивание — отдельный рефактор, вынесен в не-цели.
