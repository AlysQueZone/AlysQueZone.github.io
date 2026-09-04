Status: resolved
Type: research
Blocked by: none

## Question

Какой бесплатный деплой за 0₽/мес выбрать для статического фейк-UI AlysQueZone, чтобы он точно открывался из России одной командой без ops?

Сравнить минимум: GitHub Pages (известен как открывающийся), Cloudflare Pages, Vercel, Netlify (+ запасные: GitLab Pages, Surge, Render static). Для каждого: 0₽-лимиты, деплой-команда, preview, кастомный домен позже, доступность из РФ (что известно на 2026, что надо проверить руками).

Ответ должен дать один рекомендованный вариант + один запасной + точную команду деплоя для стека из тикета 03. AFK, без человека.

## Answer

Дата исследования: 2026-09-04. Все факты — из свежих первичных источников (доки + постмортемы 2025–2026), не из памяти.

### Сравнение (0₽, статика)

| Вариант | 0₽-лимиты (2026) | Деплой одной командой | Preview | Кастомный домен | Доступность из РФ (2026) |
|---|---|---|---|---|---|
| **GitHub Pages ✅ рекомендовано** | Сайт ≤1 ГБ, bandwidth soft 100 ГБ/мес, builds soft 10/час (Jekyll-пайплайн; на custom Actions-workflow лимит 10/час не действует, тратятся Actions-минуты — для public-репо бесплатно), таймаут деплоя 10 мин. Источник: docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits | `npm run deploy` (см. команду ниже) или автодеплой пушем в main через Actions | Нативного preview на каждый PR нет (только деплой веток); workaround — артефакт Actions или Surge-preview на PR | Да, бесплатно + HTTPS (Settings → Pages → Custom domain + CNAME) | **Лучший из бесплатных зарубежных.** Тотального блока нет; май 2026 — деградация: OONI via «Вёрстка» 5–7.05.2026: 10–16% битых соединений (фон 4%), РКН «не ограничивает» (Meduza 08.05.2026; habr.com/ru/articles/1047444: точечный троттлинг/DPI, напр. тест Ростелеком 14.06.2026 — 99% OK). Standing preference «GitHub Pages точно ок» подтверждается как наименьшее зло |
| Cloudflare Pages ❌ | Free: 500 сборок/мес, 1 сборка за раз, ≤20 000 файлов, файл ≤25 МБ, ~100 кастомных доменов/проект, безлимит сайтов/запросов/трафика статики. Источник: developers.cloudflare.com/pages/platform/limits/, pages.cloudflare.com | `npx wrangler pages deploy ./dist` или автодеплой из Git; preview-URL на каждый коммит — безлимит | Да, лучшее | Да | **Исключён как основной.** Официально: с 09.06.2025 провайдеры РФ (Ростелеком, МТС, Мегафон, Вымпелком, МГТС) троттлят всё за Cloudflare до первых 16 КБ — «most web navigation impossible», вне контроля CF (blog.cloudflare.com/russian-internet-users-are-unable-to-access-the-open-internet/, 26.06.2025). Подтверждено полем: Habr Q&A 1409242 (03.2026) — и основной домен, и *.pages.dev недоступны/медленны из РФ |
| Vercel (Hobby $0) ❌ | Hobby: ~100 ГБ Fast Data Transfer, 100 деплоев/день, preview на каждый пуш, non-commercial. Источник: vercel.com/docs/limits, /docs/plans/hobby, /docs/plans | `npx vercel --prod` или автодеплой из Git | Да, лучшее | Да | **Исключён.** 2025–2026 массовые жалобы: shared-IP *.vercel.app попадают в реестр РКН по одному сайту и утягивают соседей; кастомные домены на 76.76.21.x — ERR_CONNECTION_RESET/TIMEOUT из РФ (community.vercel.com: custom-domains-not-working-from-russia; bbqp.pro blocked Dec 2025; qna.habr.com/q/1408104 Jan 2026; threads Feb 2026 «vercel и netlify заблокированы в РФ»). Сам Vercel советует посетителям VPN при страновых блоках |
| Netlify (Free $0) ❌ | Free (credit-based с 04.09.2025 для новых акков): 300 кредитов/мес, hard limit — при исчерпании сайты pause до следующего цикла, докупить нельзя. Preview безлимитные, кастомный домен + SSL free. Источник: docs.netlify.com (credit-based-pricing-plans, how-credits-work), netlify.com/pricing | `npx netlify deploy --prod --dir=dist` или автодеплой из Git | Да (unlimited deploy previews) | Да | **Исключён.** Прямой тест 03.2026 (Habr Q&A 1409242): в режиме DNS-only (трафик напрямую на Netlify, без прокси CF) сайт «перестал открываться полностью» из РФ — вывод автора: IP Netlify заблокированы на уровне провайдеров |
| GitLab Pages (запасной №2) | Free: статика из CI, лимиты упираются в CI-минуты/хранилище тарифа; кастомный домен + TLS free; preview через review apps (надо писать job) | Только через `.gitlab-ci.yml` (pages job с `public/`), одной CLI-команды нет | Только самописный review-app | Да | Отдельных свежих сообщений о блоке gitlab.io нет, риск-профиль как у GitHub (США), но без «16-КБ занавеса» CF. Держать как git-зеркало |
| **Surge.sh ✅ запасной №1** | Free: unlimited publishing, кастомный домен + basic SSL free, лимит проекта 10 100 файлов / 450 МБ. Источник: surge.sh/pricing, surge.sh/docs/cli/publishing, /docs/platform/plans | `npx surge ./dist <домен>` — буквально одна команда, без Git | Нет нативного PR-preview; workaround — деплой каждого PR на отдельный субдомен вручную | Да, free | Свежих сообщений о блоке surge.sh в РФ не найдено; мелкий провайдер вне фокуса ТСПУ/CF-истории. Риск остаётся (США), но независим от инфры GitHub — годится как аварийный выход |
| Render Static (отклонён) | Static free (CDN, кастомный домен + TLS, single-service preview), но упирается в общие included bandwidth/pipeline-минуты воркспейса (на Free ~ единицы ГБ/мес). Источник: render.com/docs/free | Только из Git (нет one-shot CLI как у Surge) | Single-service preview | Да | Зарубежный CDN (в тредах 2025–2026 упоминается рядом с Vercel/Hetzner/DO/OVH среди пострадавших от троттлинга), sleep-история free web-сервисов + меньше трафика, чем у Pages. Хуже обоих финалистов |

### Решение

- **Основной: GitHub Pages (public-репо).** Единственный вариант, одновременно: 0₽ без капканов (нет pause за кредиты как у Netlify), открывается из РФ лучше всех зарубежных (нет системного блока как у CF/Vercel/Netlify), деплой одной командой, кастомный домен потом бесплатно.
- **Запасной: Surge.sh.** Независимая от GitHub инфра, деплой одной командой за минуту, 0₽. Хранить в README, использовать если GitHub ляжет/задеградирует или нужен срочный preview-URL для зрителей.

### Точная команда деплоя (стек-агностик; тикет 03 ещё open, команда работает для любого стека со статическим `dist/` — Astro/Vite/Next-export)

Разовый сетап (после `npm create` любого стека, вывод сборки — `dist/`):

```bash
npm i -D gh-pages
```

В `package.json` добавить:

```json
{ "scripts": { "build": "<команда сборки стека, напр. astro build / vite build>", "deploy": "npm run build && gh-pages -d dist" } }
```

Дальше каждый деплой — одна команда:

```bash
npm run deploy
```

URL: `https://<user>.github.io/<repo>/` (для project site; выставить `base`/`basePath` стека в `/<repo>/`). Альтернатива без npm — официальный Actions-workflow (`actions/deploy-pages` на пуш в main, Environment: github-pages); итог тот же. Запасной деплой: `npx --yes surge ./dist alysquezone.surge.sh`.

Preview-стратегия: у Pages нативного PR-preview нет → preview для зрителей делать через запасной: `npx surge ./dist pr-<N>-alysque.surge.sh`.

### Что проверить руками после первого деплоя (AFK-чеклист для build-агента)

1. `curl -I https://<user>.github.io/<repo>/` + открыть с МТС/Ростелеком/мобильного интернета без VPN.
2. Прогнать URL через check-host.net (точки RU).
3. Если доля fails как в мае 2026 (OONI 10–16%) — повторить позже/с другого провайдера; при тотальной недоступности — переключить зрителей на Surge-зеркало и зафиксировать в тикете.
