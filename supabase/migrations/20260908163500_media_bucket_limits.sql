-- [Стройка video-s3, ревью-фиксы] Лимиты бакета media (§1 спеки, по creating-buckets).
-- UPDATE идемпотентен (повторный прогон — no-op), применяется мержем в main
-- (Deploy to production). Заливка идёт service_role-скриптом, RLS не меняем.
update storage.buckets
set file_size_limit = 26214400, -- 25MB: хватает UI-звукам и будущим тройкам videos/
    allowed_mime_types = array['audio/mpeg', 'video/webm', 'video/mp4', 'image/webp']
where id = 'media';
