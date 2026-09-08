Status: resolved
Type: research
Blocked by: 01

## Question

Какой стек выбрать для фейк-UI (лендинг + биржа + карточка привета на хардкод-JSON), если юзер не шарит и делегировал выбор агенту?

Кандидаты: Astro + TS + Tailwind (рекомендация), Next.js static export, Vite + React SPA, чистый HTML/CSS. Учесть: 0₽ деплой из тикета 01, открытие из РФ, скорость лендинга, простота хардкод-данных, путь к будущему бэку, DX для одного дева + зрителей.

Ответ — один стек + версия + структура папок + почему не остальные. AFK. Дождаться закрытия 01.

## Answer

Дата исследования: 2026-09-04. Все версии/факты — из свежих первичных источников (доки Astro/Tailwind/Vite/Next, npm, релизы GitHub), не из памяти.

### Решение: Astro + TypeScript + Tailwind CSS (через Vite-плагин)

| Пакет | Версия (pin на 2026-09-04) | Источник |
|---|---|---|
| `astro` | `^7.2.9` (stable, релиз 27.08.2026; доки подтверждают линейку 7.2.x как latest) | `astrobuild.eu/en/releases` (live из withastro/astro), `docs.astro.build/en/upgrade-astro` |
| `tailwindcss` | `^4.3.3` (stable, релиз 16.07.2026) | `github.com/tailwindlabs/tailwindcss/releases`, `tailwindcss.com/blog` |
| `@tailwindcss/vite` | `^4.3.x` (та же линейка, что `tailwindcss`) | `tailwindcss.com` + `@tailwindcss/vite` поддерживает Vite 8 с v4.2.2 (`#19790`) |
| `@astrojs/check` / `typescript` | `typescript ^5` (≥5.7; Next 16 требует минимум 5.1, Astro-гайды рекомендуют 5.7+) | `nextjs.org/docs/app/guides/upgrading/version-16`, Astro tutorial 2026 |
| `gh-pages` | `^6.3.0` (latest) | `github.com/tschaub/gh-pages/releases` |
| Node | 22 LTS (Astro 6+ дропнул Node 18/20; раннеры GitHub Actions в 2026 — Node 24) | Astro tutorial 2026 (`tech-insider.org`), Andy Nguyen guide 05.2026 |

Важное изменение 2025–2026: официальная интеграция `@astrojs/tailwind` **deprecated** — предпочтительный путь Tailwind 4 в Astro это Vite-плагин (`@tailwindcss/vite`) по styling-гайду (`docs.astro.build/en/guides/integrations-guide/tailwind` → redirect на `/en/guides/styling/#tailwind`). Конфиг Tailwind v3 (`tailwind.config.js`) отменён — дизайн-токены живут в CSS через `@theme` (CSS-first config, движок Oxide). Значит бренд-токены тикета 02 (`#9146FF`/`#0E0E10`/пивное золото) кладутся прямо в `src/styles/global.css` через `@theme`, без JS-конфига.

Почему Astro под критерии тикета:
- **Пара с GitHub Pages:** дефолтный артефакт Astro — `dist/`, команда `astro build` (`docs.astro.build/en/guides/deploy`: Build Command `astro build`, Publish directory `dist`); у Astro есть офиц. гайды деплоя и на GitHub Pages, и на Surge (`/en/guides/deploy/github`, `/en/guides/deploy/surge`) — оба исхода тикета 01 покрыты из коробки. Sub-path project site закрывается одной строкой `base: '/<repo>/'` в `astro.config.mjs`.
- **РФ/статика:** чистый статический HTML в `dist/`, ноль обязательных внешних рантаймов/CDN — открывается везде, где открывается Pages (см. тикет 01).
- **Скорость лендинга:** Astro рендерит `.astro`-компоненты в статический HTML на билде и по дефолту шипает **zero JS**; интерактив (модалка «Потратить N Пивкойнов?», тост, localStorage-баланс из тикета 04) — точечные `<script>`-острова/`client:*` только там, где нужно, без React-рантайма на каждой странице.
- **Хардкод-JSON + localStorage:** `data/lots.json` импортируется напрямую в `.astro`/`.ts` с типами из схемы тикета 04 (`id, title, owner, price, rarity, history[], clipUrl?, meme?`); валидацию при желании — zod из `astro:zod`, валидация на билде падает до деплоя. localStorage-кошелёк (старт 1000) — один модуль `src/lib/wallet.ts`, без стейт-менеджера.
- **DX одного дева + зрителей:** файловый роутинг `src/pages` (лендинг/биржа/карточка = три файла), контент рядом с кодом, MD-дружелюбность для будущих копирайтов; зритель может прислать PR с одним JSON-лотом или одной `.astro`-страницей без понимания React.
- **Путь к бэку:** Astro 7 — тот же Vite 8 под капотом (`astro.build/blog/whats-new-june-2026`: Astro 7 + Vite 8), позже добавляются endpoints/actions/SSR-адаптер и любой UI-фреймворк островами (`/en/guides/endpoints`, `/en/guides/actions`, `/en/guides/framework-components`) без переписывания страниц.

### Структура папок

```text
/
├── astro.config.mjs        # site + base: '/<repo>/' (project site Pages)
├── package.json            # scripts: dev/build/preview/deploy (см. ниже)
├── public/                 # favicon, og-картинки (хотлинки Twitch-CDN из тикета 02, бинарники не коммитить)
├── data/
│   └── lots.json           # 10 лотов строго по схеме тикета 04
└── src/
    ├── pages/
    │   ├── index.astro         # лендинг (hero «продам привет», как это работает, топ, CTA на биржу)
    │   ├── lots/
    │   │   ├── index.astro     # биржа (сетка лотов)
    │   │   └── [id].astro      # карточка привета (getStaticPaths по data/lots.json)
    │   └── 404.astro           # кастомная 404 для Pages
    ├── components/
    │   ├── LotCard.astro       # карточка лота в сетке
    │   ├── BuyModal.astro      # модалка «Потратить N Пивкойнов?» (client-скрипт)
    │   ├── Toast.astro         # тост в тоне канала
    │   └── Header.astro / Footer.astro
    ├── layouts/
    │   └── BaseLayout.astro    # <head>, тёмный фон #0E0E10, CTA #9146FF, плашка «это шутка, приветы бесценны»
    ├── styles/
    │   └── global.css          # @import "tailwindcss" + @theme (бренд-токены тикета 02)
    └── lib/
        ├── lots.ts             # типы Lot/History по схеме 04 + загрузка lots.json
        └── wallet.ts           # localStorage-баланс, старт 1000 Пивкойнов
```

Роутов ровно три по скоупу карты (лендинг + биржа + карточка); корзины/профиля нет (out of scope карты).

### Сборка/деплой в связке с gh-pages (тикет 01)

```bash
npm i -D gh-pages@^6.3.0
```

`astro.config.mjs`:
```js
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://<user>.github.io',
  base: '/<repo>/',
  vite: { plugins: [tailwindcss()] },
});
```

`package.json`:
```json
{ "scripts": {
  "dev": "astro dev",
  "build": "astro build",
  "preview": "astro preview",
  "deploy": "npm run build && gh-pages -d dist"
} }
```

Деплой — `npm run deploy` (URL `https://<user>.github.io/<repo>/`). Запасной Surge из тикета 01 без изменений: `npx --yes surge ./dist alysquezone.surge.sh` (у Astro есть офиц. Surge-гайд). Preview для зрителей — тоже через Surge (`pr-<N>-alysque.surge.sh`), т.к. у Pages нет нативного PR-preview.

### Почему не остальные (по 1 строке)

- **Next.js static export (`next@16.3.4` Active LTS 08.2026, `output: 'export'` + `basePath`/`assetPrefix` + `images.unoptimized` + `trailingSlash`, вывод по дефолту `out/`, а не `dist/`):** тянет React-рантайм и кучу экспортных костылей ради трёх статических страниц без единой серверной фичи — оверхед без выгоды.
- **Vite + React SPA (`vite@8.2.2` stable 20.08.2026, `base: '/<repo>/'`):** один `index.html` — хуже первый paint/SEO-шаринг лендинга в TG и нативный роутинг `/lots/:id` на Pages только через SPA-хаки (404-редиректы), а интерактива (модалка + тост) на целый SPA не тянет.
- **Чистый HTML/CSS:** ноль сборки сегодня, но нет компонентов/типов под схему лотов из тикета 04 (копипаста карточек ×10), DX для зрителей-контрибьюторов хуже и путь к будущему бэку — переписывание с нуля вместо добавления Astro-endpoints.
