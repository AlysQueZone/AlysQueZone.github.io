## Destination

Решение + спека: можно ли сделать общего динамического Владельца лотов (последний нажавший «Купить») без своего сервера, бесплатно и с открытием из РФ — и если да, то на чём (сервис), с какой моделью данных, идентичностью покупателя, UX гонок и fallback на localStorage. После карты кодим без новых решений.

## Notes

- Домен: шуточная Биржа приветов канала alysque. Лот — товар с ценой и историей; Владелец — чатерс/стример, за которым сейчас числится лот; Чатерс — зритель чата; Пивкойн — валюта (старт 1000, сейчас в localStorage); Мои приветы — выкупленное «тобой». Глоссарий — `CONTEXT.md`, не дрейфовать в синонимы.
- Skills для сессий: `grilling` + `domain-modeling` для решений с человеком; `research` для AFK-фактов (сервисы, доступность из РФ, лимиты); `prototype` для дешёвого фейк-UI общей покупки. При любой работе с Supabase (схема, RLS, клиент, прототип) обязательно подключать `supabase` + `supabase-postgres-best-practices` (RLS на каждую exposed-таблицу, `TO anon` вместо `auth.role()`, publishable-ключ в клиент, `service_role`/DSN/пароль — никогда в браузер). Ход по `docs/agents/issue-tracker.md` (Wayfinding operations).
- Standing preferences: своего сервера нет и не будет; строго 0₽/мес; всё обязано открываться из России (GitHub Pages — эталон, остальное проверять фактами, не верой); сайт — статика Astro на GitHub Pages, секреты в клиентском JS светятся всем; бэкенд-логика только через чужой free-tier с анонимной записью.
- Трекер: local-markdown, эта карта — `scratch/shared-state/map.md`, тикеты — `scratch/shared-state/issues/NN-<slug>.md`.

## Decisions so far

- [Бесплатные shared-хранилища без своего сервера с доступом из РФ](scratch/shared-state/issues/04-ru-free-backend-candidates.md): Supabase free — основной финалист, Yandex Cloud Gateway+YDB — запасной; Cloudflare/Firebase вычеркнуты (блок из РФ).
- [Что именно делаем общим](scratch/shared-state/issues/01-scope-what-is-shared.md): общие Владелец + история (хвост ~50) + цена (+10% за покупку); балансы/Мои приветы локальные (баланс — косметика); ЛУК непродаваем глобально; офлайн — ошибка + запрет покупки; локальное не мигрируем.
- [Twitch-auth с минимальным скопом](scratch/shared-state/issues/07-twitch-auth-minimal-scope.md): условно берём — опциональный вход через Supabase Auth (секрет в Supabase, скоп пустой/openid, ~4–6ч); identity = стабильный twitch_id, login — снапшот; гости — самозаявленный ник; обязательный логин запрещён.
- [Кто такой покупатель без auth](scratch/shared-state/issues/02-buyer-identity-without-auth.md): гибрид отвергнут — только Twitch-auth, гостей нет; identity = twitch_id, показ — login-снапшот; логин с возвратом к лоту, долгая сессия, витрина открыта всем, покупка только с сессией.
- [UX гонок и свежести Владельца](scratch/shared-state/issues/03-shared-ux-races.md): свежесть — Realtime-подписка + refetch при открытии/фокусе; гонка — last-write-wins, проигравший перекупает по новой цене; успех только после confirm сервера.
- [Защита записи залогиненных без своего сервера](scratch/shared-state/issues/05-anon-write-protection.md): клиент только INSERT, всё считают триггеры (server-side +10%, identity из JWT, блок ЛУКа, кулдаун 90с, кап хвоста 50); SQL в research/05-write-protection.sql; Turnstile без сервера не привязать; откат — только дашборд.
- [Twitch 2FA на российский номер](scratch/shared-state/issues/08-twitch-2fa-ru-number.md): системный блок SMS 2FA для +7 с 22.03.2023 (не частная проблема); путь — SMS-шаг на не-RU real-SIM + сразу TOTP-приложение, номер оставить recovery-якорем.
- [Прототип общей покупки на одном кандидате](scratch/shared-state/issues/06-shared-buy-prototype.md): вердикт — работает (2 аккаунта/2 браузера: вход, INSERT, server-side цена, блок ЛУКа, Realtime, JWT claims ок); таблицы не забыть в `supabase_realtime`; кулдаун прод — 30с.

## Not yet specified

- Модерация и жалобы: откат вандальной покупки залогиненным, бан.
- Приватность: twitch_id/login в shared-таблице — публичны по построению, ок ли.
- Масштаб: десятки лотов сейчас, что будет при сотнях.

## Out of scope

- Свой сервер/VPS/докер/прокси — запрещено условиями усилия.
- Платные тарифы BaaS — запрещено бюджетом 0₽.
- Полноценный auth (Twitch OAuth), платежи, корзина, личные кабинеты — не в этом усилии.
- Мобильное приложение.
