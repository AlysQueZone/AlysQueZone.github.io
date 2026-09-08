# Бесплатные shared-хранилища без своего сервера с доступом из РФ

Type: research
Status: resolved

## Question

Какие чужие free-tier хранилища/KV с записью из браузерного JS подходят под все три условия сразу: (а) без своего сервера (только статика Astro на GitHub Pages), (б) 0₽/мес на наших объёмах (десятки лотов, редкие записи «купил»), (в) открываются из России без VPN прямо сейчас? Кандидаты к проверке: Cloudflare Workers + KV/D1, Supabase, Firebase RTDB/Firestore, Upstash Redis/REST, JSONBin/njson/pantry-подобные, Yandex Cloud (YDB/Serverless), Ably/Pusher/Convex и т.п. Для каждого: free-лимиты записи/чтения, нужна ли регистрация/карта, светится ли ключ в клиенте, CORS с GitHub Pages, факт доступности из RU (не заявление в доке, а проверяемый сигнал 2025–2026), отвал при превышении лимита.

## Answer

Финалисты: Supabase free (EU-Central, anon-key + RLS, открывается из РФ без VPN) — основной; Yandex Cloud Gateway+Function+YDB Serverless (100% RU, 0₽ в квоте) — запасной. Вычеркнуты: Cloudflare (троттлинг 16KB из РФ с 09.06.2025), Firebase (стоп RU sign-ups, VPN/антифрод billing), Upstash/JSONBin/Pantry (write-токен светится в клиенте — только stub), Ably/Pusher/Convex (транспорт, не хранилище). Риски: пауза Supabase после недели тишины, egress 5GB, RLS-аудит обязателен, фронт держать на GitHub Pages без CF-прокси. Полная таблица — в истории сессии charting (subagent ses_f8a1460efffeQZsnOdL0bMZbF1).
