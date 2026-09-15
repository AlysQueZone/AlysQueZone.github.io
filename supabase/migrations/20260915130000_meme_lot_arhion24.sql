-- Хотлинк-мем: привет arhion24 (MemeAlerts). Подпись «o7 arhion24»:
-- токен o7 фронт рисует 7TV-эмоутом канала (src/lib/emotes.ts).
INSERT INTO public.lots (slug, title, price, video_url) VALUES
  ('lot-meme-arhion24', 'o7 arhion24', 800, 'https://cdns.memealerts.com/p/69bcde52b57c1c9b432af084/0fcaba76-262b-4768-be63-9ae9daa7a390/alert_orig.webm')
ON CONFLICT (slug) DO UPDATE SET title = EXCLUDED.title, price = EXCLUDED.price, video_url = EXCLUDED.video_url;
