-- Новые свои приветы (privets/ → Storage media/videos/, тройка webm/mp4/webp).
-- Источники: `Evilzerg57 double.mp4`, `OlyaCaramel.mp4`; Video URL — публичный Storage.
INSERT INTO public.lots (slug, title, price, video_url) VALUES
  ('lot-privet-evilzerg57-double', 'Двойной привет по цене одного Evilzerg57', 800, 'https://wsunalldyhuwfhlzwpyp.supabase.co/storage/v1/object/public/media/videos/lot-privet-evilzerg57-double.webm'),
  ('lot-privet-olyacaramel', 'Покупка OlyaCaramel', 800, 'https://wsunalldyhuwfhlzwpyp.supabase.co/storage/v1/object/public/media/videos/lot-privet-olyacaramel.webm')
ON CONFLICT (slug) DO UPDATE SET title = EXCLUDED.title, price = EXCLUDED.price, video_url = EXCLUDED.video_url;
