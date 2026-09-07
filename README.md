# AlysQueZone

Шуточная биржа приветов Twitch-канала [alysque](https://www.twitch.tv/alysque).

Стример здоровается с чатом — его привет это ценность. Чатерсы выставляют приветы на биржу и перепродают их за пивкойны.

## Тех

- MVP: статичный сайт на Astro, без бэка. Кошелёк и «Мои приветы» хранятся в localStorage.
- Полностью вайбкодится через <https://github.com/mattpocock/skills>

## Локальный запуск

Нужны Node.js 18+ и npm.

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

## TODO и идеи

- [ ] подключение репо к supabase. Там есть кнопка "Deploy to production Apply changes to your production database when you merge into your configured production GitHub branch". Стоит ее включить? Она будет применять миграции в случае если они не были применены вручную?
- [ ] emoji 🪙 не отображается у некоторых.
- [ ] сменить слово "кулдаун" на что-то понятное.
- [ ] кулдаун должен быть на самой кнопке покупки(кулдаун должен отображать реальное значение).
- [ ] Мне не нравится что у нас кулдан на любую покупку.
- [ ] "мои приветы" должны быть подключены к информации из бд.
- [ ] Звук и уведомление когда твой привет выкупили(WS).

---

- https://cdns.memealerts.com/p/64ceae64bde979e95d878442/30feb2e2-3eed-4878-8f80-895746b46d32/alert_orig.webm
- Добавить звуки для колеса:
  - https://cdns.memealerts.com/p/66bb271a732c61af9b72709c/bb8289ea-5bab-4c34-8af5-a9a36855f7c4/alert_orig.webm
  - https://cdns.memealerts.com/p/64beee9c05b8e6cffeefb79c/8c860fa5-2f38-4e49-b6b7-91c4c9a539e5/alert_orig.webm
    пусть они играют случайно.
- колесо пусть крутиться на 1 секунду дольше
- Список чатерсов(чтобы ники не путать)
- Переехать на s3 supabase вместо хранения в репозитории
- Заменить аудио-приветы на видео-приветы
