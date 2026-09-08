## Destination

Спека в `scratch/pivkoiny-backend/spec.md`, готовая к реализации без новых решений: пивкойны живут в БД (баланс на Supabase Auth UID), гамба крутится на бэке на проверенной математике, кнопка перекупа берёт актуальную цену из БД.

## Notes

- Домен: шуточная Биржа приветов канала alysque. Пивкойн — валюта (старт 1000, сейчас localStorage в `src/lib/wallet.ts`); Гамба — рулетка добычи пивкойнов (сейчас клиент: 50/40/10, +1000/мимо/+100000, `src/components/GambaModal.astro`); Лот — товар с ценой; Перекуп — повторная покупка по +10% (сейчас клиент считает `Math.ceil(price*1.1)` в `src/lib/outbid-notice.ts`, сервер считает цену в триггере `enforce_purchase_rules`). Глоссарий — `CONTEXT.md`, не дрейфовать в синонимы.
- Skills для сессий: `grilling` + `domain-modeling` для решений с человеком; `research` для AFK-фактов; `prototype` для дешёвого фейк-UI; при любой работе с Supabase обязательно `supabase` + `supabase-postgres-best-practices` (схема только миграциями, RLS на каждую exposed-таблицу, бэкенд-логика на supabase, не в клиенте). Ход по `docs/agents/issue-tracker.md` (Wayfinding operations).
- Standing preferences: решено — баланс на Supabase Auth UID (не Twitch login); стартовый баланс 1000 сохранить; своего сервера нет, бэкенд-логика — на supabase; преддеплой-гейт `npm run build` + клики в `preview`; коммитить готовое самому.
- Трекер: local-markdown, эта карта — `scratch/pivkoiny-backend/map.md`, тикеты — `scratch/pivkoiny-backend/issues/NN-<slug>.md`.

## Decisions so far

- [Математика казино для гамбы](scratch/pivkoiny-backend/issues/01-casino-math.md): готовая слот-схема, ставка 100, RTP 90% (0/100/500), daily-календарь без сброса streak, сброс цен отклонён (факты — в ветке `research/casino-math`).
- [Аудит клиентской экономики](scratch/pivkoiny-backend/issues/02-client-economy-audit.md): баланс в localStorage, сервер авторитетен только по цене покупки; переезжает всё денежное (баланс, гейт, списание/начисление, RNG, таблица выплат, next-цена), клиент оставляет показ и анимации.
- [Форма supabase](scratch/pivkoiny-backend/issues/03-supabase-shape.md): ledger append-only — истина + серверный кэш баланса; спин — RPC, покупка — расширить текущие триггеры; RLS на каждую таблицу; цена/баланс — select + Realtime; миграции profiles → ledger → spins → daily → purchase-money → price-feed (набросок — в ветке `research/supabase-shape`).
- [Источники и стоки экономики](scratch/pivkoiny-backend/issues/04-economy-sources-sinks.md): старт 1000, Ежедневный вход по календарю 100–500 без сброса streak, sink — только edge 10%, комиссии нет, сброс цен похоронен.
- [Модель ставок гамбы](scratch/pivkoiny-backend/issues/05-gamba-stake-model.md): ставка 100, таблица A (0/100/500, RTP 90%), без лимитов (только антибот rate-limit), прозрачный дисплей, дружелюбный гейт при балансе < 100.

## Not yet specified

- Миграция существующих localStorage-балансов в БД: переносить, суммировать или сбросить всем на 1000.
- Античит и двойные траты: идемпотентность спина/покупки, защита от подкрутки шансов на клиенте, rate limits.
- Поведение гостей без сессии и офлайна: что видит незалогиненный, что происходит с балансом при потере сети.
- Экономика в динамике: куда уходят пивкойны (синки), что держит цены от убегания в бесконечность при +10% за перекуп.
- UX баланса и цены: где показывать, как часто рефетчить, что делать при гонке (цена ушла пока жал).
- План миграций и отката: порядок таблиц/триггеров/функций, как тестировать на бранче перед мёржем в main.

## Out of scope

- Реальные деньги, вывод пивкойнов, платежи — не в этом усилии.
