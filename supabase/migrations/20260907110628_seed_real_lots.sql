-- Тикет 12 (shared-state): замена прототипного сида реальными лотами каталога.
-- Источник метаданных: data/lots.json (slug = статичный id лота).
-- Базовая история перепродаж остаётся в статике lots.json; в БД история изначально пуста
-- (таблица purchases наполняется живыми покупками через триггеры).
-- ЛУК (luk-legend): is_locked = true. owner_uid/owner_twitch_id = null (чистый старт).
-- Применение: npx supabase db push (пароль БД из локального .env, руками).

-- 1. Удалить прототипные лоты (purchases чистятся каскадом через on delete cascade).
delete from public.lots where slug like 'proto-%';

-- 2. Сид реальных лотов. ON CONFLICT DO NOTHING: повторный прогон не затрёт
-- живых владельцев/цен, купленных после первого сида.
insert into public.lots (slug, title, price, owner_login, is_locked) values
  ('lot-gedo-sleepy', 'Спящий привет от Gedo0', 250, 'Gedo0', false),
  ('lot-gedo-uvernulya', 'Привет, который увернулся', 300, 'Gedo0', false),
  ('lot-gedo-flat', 'Квартира в Москве (приму в дар)', 800, 'Gedo0', false),
  ('lot-evil-friendship', 'Дружба за 2 привета', 400, 'evilzerg57', false),
  ('lot-cool-holst', 'Привет, который не купишь за 14 рублей', 350, 'coolbeback', false),
  ('lot-gribo-calendar', 'Календарный привет', 300, 'gRiBoCheQuE', false),
  ('lot-vandal-privet', 'Привет онлайновсеие чуваки', 600, 'VandaLQuE', false),
  ('lot-rush-podelu', 'Привет мне по делу', 200, 'andRushQuE', false),
  ('lot-las-skum', 'Скум на привет', 150, 'las1que', false),
  ('lot-andrew-37', 'Привет от Андрюши №37', 100, 'Андрюша №37', false),
  ('luk-legend', 'ЛУК — хозяин не менялся', 9999, 'aLySQuE', true),
  ('lot-meme-nyachos', 'Здраствуйте, nyanyachos', 1200, 'bEnDQuEt', false),
  ('lot-meme-optom', 'Привет сразу всем (оптом)', 700, 'foxindique', false),
  ('lot-meme-mass', 'Массовый привет (коты одобряют)', 800, 'coolbeback', false),
  ('lot-meme-repeat', 'Второй повторный привет', 650, 'ShidouQuE', false),
  ('lot-meme-remolol', 'Привет для remolol', 750, 'remololpro', false),
  ('lot-meme-salat', 'Привет для Салата', 750, 'spiritbanbanban', false),
  ('lot-meme-quevizar', 'Привет для Quevizar', 850, 'foxindique', false),
  ('lot-meme-myth', 'Миф о бесплатном пивете', 1000, 'Onghanntto', false),
  ('lot-meme-evilzeg', 'Привет Evilzeg', 900, 'evilzerg57', false)
on conflict (slug) do nothing;
