## Destination

Спека запуска AlysQueZone: выбран деплой за 0₽ с открытием из РФ + структура лендинга с брендингом alysque + MVP как фейк-UI биржи на хардкоде + стек + порядок работ. После карты можно кодить без дополнительных решений.

## Notes

- Домен: шуточная «биржа приветов» twitch-канала alysque. Чатерс — зритель чата. Привет — факт приветствия стримером чатерса в эфире. Биржа — витрина перепродаж приветов (фейк). Валюта — Пивкойны, у нового открывшего по умолчанию 1000.
- Skills для сессий: `grilling` + `domain-modeling` для решений с человеком; `research` для AFK-фактов (деплой, брендинг, стек); `prototype` для фейк-UI. Глоссарий — `CONTEXT.md` (создается лениво по domain-modeling, пока читать нечего).
- Standing preferences: бюджет строго 0₽/мес; сервис обязан открываться из России (GitHub Pages точно ок, остальное проверять); бэкенда нет — UI фейкает бэкенд на хардкод-JSON; реальные ники чатерсов использовать можно; референсы брендинга — https://www.twitch.tv/alysque + https://t.me/alysque; стек выбирает агент (юзер не шарит); экраны MVP-фейка зафиксированы: лендинг + биржа + карточка привета (корзина/профиль — нет).
- Трекер: local-markdown, эта карта — `.scratch/alysque-launch/map.md`, тикеты — `.scratch/alysque-launch/issues/NN-<slug>.md`.

## Decisions so far

- [Деплой 0₽ с открытием из РФ](.scratch/alysque-launch/issues/01-deploy-0ruble-ru-accessible.md): основной GitHub Pages (`npm run deploy` → gh-pages -d dist), запасной Surge.sh; Cloudflare/Vercel/Netlify исключены (блок/троттлинг из РФ 2025–2026).
- [Брендинг-референс alysque](.scratch/alysque-launch/issues/02-branding-refs.md): Twitch-base `#9146FF`/`#0E0E10` + арбуз/пиво-акценты из лора ЧПЗ, тон «СТРИМ ВКЛЮЧИЛСЯ, А ТЫ?», hero — чемодан «продам привет», ники `pepelnayaa`/`nyamuras`/`justdavidcool` ок, `Guit88man`/`bradhi` спорны.
- [Экономика Пивкойнов и контент биржи](.scratch/alysque-launch/issues/04-pivkoiny-economy-content.md): схема лота + 10 лотов (100-500 / 600-1200 / ЛУК not_for_sale), фейк-покупка через localStorage со старта 1000, ники — все реальные по максимуму, без дисклеймера; глоссарий в `CONTEXT.md`.
- [Выбор стека](.scratch/alysque-launch/issues/03-stack-choice.md): Astro 7.2.9 + TS + Tailwind 4.3.3 (Vite-плагин, `@theme`-токены) → `dist/`, `base: '/<repo>/'`, `npm run deploy` через gh-pages 6.3.0; Next/Vite-SPA/голый HTML отклонены (тяжёлые костыли / SPA-хаки роутинга / нет компонентов).
- [Прототип лендинга и биржи](.scratch/alysque-launch/issues/05-landing-birzha-prototype.md): throwaway `.scratch/alysque-launch/prototype/birzha-prototype.html`, 3 варианта через `?variant=A/B/C` (сетка / строки / чат-лента) на реальных 10 лотах; ждет выбора победителя человеком.
- [Реальные чаттерсы из VOD](.scratch/alysque-launch/issues/07-real-chatters-from-vod.md): VOD 2864275043, 3662 сообщения / 175 ников, топ LYSB0T/spiritbanbanban/coolbeback, que-топ foxindique/VandaLQuE/ShidouQuE, 10 черновиков лотов (research/chatters.md).
- [Финальная спека и порядок build-работ](.scratch/alysque-launch/issues/06-final-spec-build-order.md): победитель A, buy-flow «всё в localStorage» + «Мои приветы» (термин в `CONTEXT.md`), теплые акценты, кодят субагенты, только GitHub Pages без Surge; выход — `spec.md` + build-тикеты 08–12.

## Not yet specified
- Кастомный домен и SEO/шаринг в чат Twitch/Telegram — позже, пока fog.

## Out of scope

- Настоящий бэкенд, auth, платежи, база данных — MVP это фейк-UI без бэка.
- Интеграция с Twitch API / EventSub для настоящих приветов — только хардкод.
- Корзина, профиль пользователя, личные кабинеты — не в этом MVP (см. Q6).
- Мобильное приложение.
