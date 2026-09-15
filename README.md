# AlysQueZone

Шуточная биржа приветов Twitch-канала [alysque](https://www.twitch.tv/alysque).

Стример здоровается с чатом — его привет это ценность. Чатерсы выставляют приветы на биржу и перепродают их за пивкойны.

> В РФ часть Supabase заблокирована, поэтому сайт работает только с VPN.

## Тех

- Статический сайт на Astro (GitHub Pages): вёрстка статична, витрина и лоты читают Supabase в браузере.
- Полностью вайбкодится через <https://github.com/mattpocock/skills>

## Локальный запуск

Нужны Node.js 18+ и npm.

Плюс `PUBLIC_SUPABASE_URL` и `PUBLIC_SUPABASE_PUBLISHABLE_KEY` в `.env` (шаблон — `.env.example`) — без них сайт не соберётся.

```bash
npm install
npm run dev
```

Открыть http://localhost:4321

## Ещё команды

```bash
npm run build    # сборка в dist/
npm run preview  # предпросмотр сборки
```
