# AlysQueZone

Шуточная биржа приветов Twitch-канала [alysque](https://www.twitch.tv/alysque).

## Тех

- Статический сайт на Astro (GitHub Pages): вёрстка статична, витрина и лоты читают Supabase в браузере.
- Полностью вайбкодится через нижеупомянутые скиллы.

## Локальный запуск

Нужны Node.js 22.12+ и pnpm (12+).

Плюс `PUBLIC_SUPABASE_URL` и `PUBLIC_SUPABASE_PUBLISHABLE_KEY` в `.env` (шаблон — `.env.example`) — без них сайт не соберётся.

```bash
pnpm install
pnpm dev
```

Открыть <http://localhost:4321>

### С локальной базой

`just` поднимает Supabase в Docker, накатывает миграции и заливает карточки из `content/lots.toml`, а затем запускает dev против локальной БД:

```bash
just run-local   # db-up + dev на локальной БД
just db-up       # только поднять БД и до-накатить миграции
just db-reset    # чистая БД: миграции + сид (данные теряются)
just dev-stop    # остановить dev-сервер
just db-stop     # остановить БД
just stop        # остановить dev, preview и локальную БД
```

Вход через Twitch работает и локально: в `.env` нужны `TWITCH_APP_CLIENT_ID` и `TWITCH_APP_CLIENT_SECRET`, а в Twitch-приложении — redirect `http://localhost:54321/auth/v1/callback`.

Уведомления в Telegram тоже работают локально: `TELEGRAM_BOT_TOKEN` и `TELEGRAM_ADMIN_CHAT_ID` из `.env` заливаются в локальный Vault (`just db-vault`; автоматически в `run-local` и после `db-reset`).

После `just db-reset` локальные сессии устаревают (БД чистая) — выйди и войди через Twitch заново.

## Ещё команды

```bash
pnpm build    # сборка в dist/
pnpm preview  # предпросмотр сборки
```

## AI Скиллы

Скиллы лежат в `.agents/skills/` — актуальный список и описание каждого смотри там.

- **Инженерные** — из [mattpocock/skills](https://github.com/mattpocock/skills): интервью и запись решений, спека и тикеты, TDD, ревью, разбор багов, ресёрч, хендофф.
- **Веб-платформа** — `modern-web-guidance` от [GoogleChrome](https://github.com/GoogleChrome/modern-web-guidance): актуальные практики HTML/CSS и клиентского JS (`<dialog>`, popover, container queries, CWV, доступность). Агент сверяется с ним до вёрстки, чтобы не тащить устаревшие паттерны.
- **База данных** — `supabase` и `supabase-postgres-best-practices`: схема, RLS, миграции и правила работы с Postgres.
- **Свои** — `alysque-*`: лоты, звуки колеса, заявки на привет, релиз.

Искать готовый скилл под задачу — `find-skills`; как писать свои — `writing-for-agents`.

**Дизайн и оформление** — `DESIGN.md` в корне: палитра, типографика, компоненты и анти-паттерны. Это единственный источник стиля: меняешь цвет — правишь таблицу там же и блок `@theme` в `src/styles/global.css`. Хекс в любом другом месте роняет `just test`.

### Пример

На карточке лота дублируется цена — хочется убрать.

1. «Используй `grill-with-docs`: давай решим, как убрать дублирование цены на карточке.» Агент задаёт вопросы и записывает решения в `GLOSSARY.md` и `docs/adr/`.
2. «Теперь `implement`.» Агент собирает тикет, пишет тесты, код, прогоняет `code-review` и коммитит.
3. Если непонятно, как это должно выглядеть: «Прочитай `DESIGN.md` и предложи варианты карточки.»

Коротко: вместо заучивания команд достаточно назвать скилл — агент сделает остальное.
