# Защита записи залогиненных без своего сервера

Type: research
Status: resolved
Blocked by: 04

## Question

Решение по identity — только Twitch-auth (anon-записи нет, см. тикеты про Twitch-auth и про идентичность покупателя). Вопрос пересобран: как защищаем запись Владельца от злоупотреблений залогиненных без своего сервера? Векторы: спам «купи-перекупи» одним аккаунтом (накрутка цены +10% и захламление истории хвостом ~50), угон/расшаривание сессии, вандальный ник. Какие механизмы реально доступны на Supabase Free: RLS `TO authenticated WITH CHECK`, rate-limit (pg_cron-чистки? триггер-функции с `SECURITY INVOKER`?), капча/Turnstile на статике, ревизии с откатом? Что ломается первым и сколько стоит (пауза проекта, egress, потёртые данные)?

## Answer

Дизайн: клиент делает только `INSERT purchases`, всё остальное считают триггеры БД — готовый SQL в `.scratch/shared-state/research/05-write-protection.sql` (таблицы `lots`/`purchases`, RLS: select всем, insert только `TO authenticated WITH CHECK (auth.uid() = buyer_uid)`, update/delete политик нет; `BEFORE INSERT`: server-side цена +10% ceil, identity из `auth.jwt()` (клиентские значения перезаписываются), блок ЛУКа (`is_locked`), кулдаун 90с + кап 10 покупок/10мин на аккаунт, кап цены; `AFTER INSERT`: применить владельца/цену + обрезка хвоста до 50). Turnstile к записи без сервера не привязать (только через Edge Function) — не берём. Остаточные риски: Sybil (N Twitch-аккаунтов = N×лимит, лечится откатом), гонка кулдауна при параллельных INSERT, угон JWT из localStorage, вандальный Twitch-ник (только ручной откат). Ломается первым Realtime/concurrent (200 коннектов, веер сообщений), не диск; деньги $0 (Free режет/паузит, не выставляет счёт). Откат — только человек в дашборде (`service_role`), SQL в том же файле, админ-RLS-ролей не заводим. Открытая проверка для прототипа: сверить рантаймом ключи JWT-claims twitch-identity (`getUser()`-лог) и зафиксировать контракт. Полный разбор — в истории сессии research (subagent ses_f89ee9887ffeLggzePznJY4UPn).
