-- Видео-мемы only: удалить 10 лотов без video_url + дроп meme_text/rarity + 12 новых лотов.
DELETE FROM public.purchases
WHERE lot_id IN (SELECT id FROM public.lots WHERE slug IN (
  'lot-andrew-37','lot-cool-holst','lot-evil-friendship','lot-gedo-flat','lot-gedo-sleepy',
  'lot-gedo-uvernulya','lot-gribo-calendar','lot-las-skum','lot-rush-podelu','lot-vandal-privet'
));
DELETE FROM public.lots WHERE slug IN (
  'lot-andrew-37','lot-cool-holst','lot-evil-friendship','lot-gedo-flat','lot-gedo-sleepy',
  'lot-gedo-uvernulya','lot-gribo-calendar','lot-las-skum','lot-rush-podelu','lot-vandal-privet'
);
DROP VIEW IF EXISTS public.lots_with_next_price;
ALTER TABLE public.lots DROP COLUMN IF EXISTS meme_text;
ALTER TABLE public.lots DROP COLUMN IF EXISTS rarity;
CREATE VIEW public.lots_with_next_price AS
SELECT
  l.slug,
  l.title,
  l.video_url,
  l.price,
  l.owner_login,
  l.owner_uid,
  l.updated_at,
  LEAST(GREATEST(CEIL(l.price * 1.1)::bigint, l.price + 1), 1000000000) AS next_price
FROM public.lots AS l;
ALTER VIEW public.lots_with_next_price SET (security_invoker = true);
REVOKE ALL ON public.lots_with_next_price FROM anon, authenticated;
GRANT SELECT ON public.lots_with_next_price TO anon, authenticated;
INSERT INTO public.lots (slug, title, price, video_url) VALUES
  ('lot-privet-4deli', 'Привет 4Deli', 800, 'https://wsunalldyhuwfhlzwpyp.supabase.co/storage/v1/object/public/media/videos/lot-privet-4deli.webm'),
  ('lot-privet-axel', 'Привет Axel', 800, 'https://wsunalldyhuwfhlzwpyp.supabase.co/storage/v1/object/public/media/videos/lot-privet-axel.webm'),
  ('lot-privet-coolbeback', 'Привет Coolbeback', 800, 'https://wsunalldyhuwfhlzwpyp.supabase.co/storage/v1/object/public/media/videos/lot-privet-coolbeback.webm'),
  ('lot-privet-revixit', 'Привет Revixit', 800, 'https://wsunalldyhuwfhlzwpyp.supabase.co/storage/v1/object/public/media/videos/lot-privet-revixit.webm'),
  ('lot-privet-sooblonde', 'Привет Sooblonde', 800, 'https://wsunalldyhuwfhlzwpyp.supabase.co/storage/v1/object/public/media/videos/lot-privet-sooblonde.webm'),
  ('lot-privet-spirit', 'Привет Spiritbanbanban', 800, 'https://wsunalldyhuwfhlzwpyp.supabase.co/storage/v1/object/public/media/videos/lot-privet-spirit.webm'),
  ('lot-privet-vandalque', 'Привет VandalQuE', 800, 'https://wsunalldyhuwfhlzwpyp.supabase.co/storage/v1/object/public/media/videos/lot-privet-vandalque.webm'),
  ('lot-meme-ne-mem', 'Привет я не мем', 800, 'https://cdns.memealerts.com/p/64ceae64bde979e95d878442/d9700c9e-e658-49b6-ae98-8ca1b3da9350/alert_orig.webm'),
  ('lot-meme-bradhi', 'Грубый привет от Брадхи', 800, 'https://cdns.memealerts.com/p/64ceae64bde979e95d878442/708a27b8-3213-4b8d-aead-2190c17ad493/alert_orig.webm'),
  ('lot-meme-assistant', 'Привет, я ваш виртуальный помощник', 800, 'https://cdns.memealerts.com/p/64ceae64bde979e95d878442/30feb2e2-3eed-4878-8f80-895746b46d32/alert_orig.webm'),
  ('lot-meme-avrora', 'Привет Аврора', 800, 'https://cdns.memealerts.com/p/67192f892e1f470e296d67ca/7fb39f55-2e3a-42aa-80fd-95a0835d3e09/alert_orig.webm'),
  ('lot-meme-monakh', 'Доброе утро Монах', 800, 'https://cdns.memealerts.com/p/694ade20c4649c766c8e3d80/70c03e18-173a-4d8e-8cb3-22b7507dce86/alert_orig.webm')
ON CONFLICT (slug) DO UPDATE SET title = EXCLUDED.title, price = EXCLUDED.price, video_url = EXCLUDED.video_url;
