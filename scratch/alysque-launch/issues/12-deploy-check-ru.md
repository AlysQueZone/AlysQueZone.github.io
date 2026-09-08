Status: resolved
Blocked by: 09, 10, 11

## Task

Деплой на GitHub Pages без Surge (решение человека): `npm run deploy` (build + `gh-pages -d dist`), открыть `https://<user>.github.io/<repo>/` без VPN с российских carriers (МТС/Ростелеком/мобильный) + прогнать через check-host.net (точки RU). При тотальной недоступности — зафиксировать здесь фактом (бэкапа Surge нет по решению). Чеклист деталей — в Answer тикета 01.

## Acceptance

- Прод-URL открывается, все 3 экрана кликаются, баланс/покупка работают на проде.

## Done

Дата: 2026-09-04. Прод-URL (на тот момент): project-pages сайт, позже переехал на `https://alysquezone.github.io/` (тикет 21).

Деплой: `npm install` не требовался (node_modules на месте), `npm run build`
проходит (14 страниц). Репозиторий был создан пустым
(origin не был настроен — `gh-pages` падал с `Failed to get remote.origin.url`),
ветка `main` на origin НЕ пушилась — улетел только билд в `gh-pages`.
Pages включён на ветку `gh-pages` (source `/`).

Деплой-фиксы (не код страниц, только plumbing, закоммичены рядом):
- `public/.nojekyll` (новый, пустой): без него Pages прогонял ветку через Jekyll
  и резал `_astro/` (все JS/CSS давали 404, сайт был нестилизован и мёртв).
- `package.json` `deploy`: добавлен флаг `--dotfiles` (`gh-pages -d dist` по
  умолчанию не публикует dotfiles, и `.nojekyll` не улетал).

curl (2026-09-04 ~17:50 UTC):
- `GET /AlysQueZone/` → 200, `content-type: text/html; charset=utf-8`; в HTML есть
  hero («БИРЖА ПРИВЕТОВ», «Стрим включился, а ты?», «продам привет»).
- `GET /AlysQueZone/lots/` → 200; в HTML есть лоты (Gedo0, ЛУК, «Скум на привет»).
- `GET /AlysQueZone/lots/lot-las-skum/` → 200 (заголовок, цена 150, кнопка «Купить»).
- `GET /AlysQueZone/ne-suschestvuet/` → 404 (кастомная 404 работает).
- `_astro/*.js` → 200 `application/javascript`, `_astro/*.css` → 200 `text/css`.

check-host.net (`check-http`, 2 прогона, ~17:44 и ~17:45 UTC):
- ru2 (Moscow, AS210644) → OK 200 (~0.13s) — оба прогона.
- ru3 (Saint Petersburg, AS210644) → OK 200 (~0.05–0.11s) — оба прогона.
- ru1 (Moscow, AS14576) → Connect timeout — оба прогона.
Итог: 2/3 RU-точек открывают прод, тотального блока нет (картина как в тикете 01:
точечная деградация, не блок). request_id: `4a0344bck847`, `4a034ad8k8d1`.

Headless e2e на проде (chromium + playwright-core):
- лендинг/биржа/карточка — 200, hero и карточка видны;
- клик «Купить» → модалка «Потратить 150 Пивкойнов? Владелец: las1que»;
- «Да, забираю» → баланс 1000→850, `pivkoiny_inventory=["lot-las-skum"]`,
  тост «ЗАБРАЛ! Привет твой: Скум на привет»;
- ЛУК — кнопка `disabled` «НЕ ПРОДАЕТСЯ». Acceptance тикета выполнен.

Известный остаток (НЕ мой скоуп — код тикета 11, не правил): на всех 11
страницах `lots/*` инлайн-`<script>` без `type="module"` содержит
`import {...} from '../../lib/wallet.ts'` → `SyntaxError` в консоли, локальная
история/владелец на карточках не перерисовываются. На покупку не влияет
(модалка — отдельный module-бандл). Нужен отдельный фикс тикета 11
(перенести `import` наверх или в module-скрипт).
