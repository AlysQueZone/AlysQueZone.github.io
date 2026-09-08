-- [Стройка video-s3, тикет 11] Маппинг 9 мем-лотов → MemeAlerts webm (§4 спеки).
-- Источник URL: scratch/video-s3/meme-mapping.md (webm целиком из таблицы,
-- проверены 2026-09-08; mp4/webp фронт выводит заменой хвоста alert_orig.webm).
-- Идемпотентна: каждый UPDATE guarded `and video_url is null` — повторный прогон
-- не затирает уже выставленные URL (в т.ч. будущие собственные video_url из Storage).
-- Требует колонку public.lots.video_url из миграции 07 (20260908114843_video_lots) —
-- имя файла с ts позже гарантирует порядок применения.
-- Применение: Deploy to production при мерже в main. НЕ применять к проду вручную.

update public.lots set video_url = 'https://cdns.memealerts.com/p/66961426e904cc2377372321/a24b3e2f-5f63-42bc-b40a-346eb305464d/alert_orig.webm' where slug = 'lot-meme-nyachos' and video_url is null;
update public.lots set video_url = 'https://cdns.memealerts.com/p/672ba6a81135f4340a61a4d0/6e47bcfc-453d-47da-8b6f-958c2a25bc4a/alert_orig.webm' where slug = 'lot-meme-optom' and video_url is null;
update public.lots set video_url = 'https://cdns.memealerts.com/p/64f8378906d68898c5b8e508/2d11fea1-bda2-493a-9774-510e15c6a589/alert_orig.webm' where slug = 'lot-meme-mass' and video_url is null;
update public.lots set video_url = 'https://cdns.memealerts.com/p/672ba6a81135f4340a61a4d0/debfc8c4-16a3-45b0-89ed-9b81f92100e6/alert_orig.webm' where slug = 'lot-meme-repeat' and video_url is null;
update public.lots set video_url = 'https://cdns.memealerts.com/p/66961426e904cc2377372321/0acec35f-0179-466e-a2ca-7995d46328ea/alert_orig.webm' where slug = 'lot-meme-remolol' and video_url is null;
update public.lots set video_url = 'https://cdns.memealerts.com/p/672ba6a81135f4340a61a4d0/fe6b3373-284a-438a-b6f7-041394b31c77/alert_orig.webm' where slug = 'lot-meme-salat' and video_url is null;
update public.lots set video_url = 'https://cdns.memealerts.com/p/649b210acfd0d2a8f427e00f/5d46287f-92a9-4897-a7cb-dbd4449e8d15/alert_orig.webm' where slug = 'lot-meme-quevizar' and video_url is null;
update public.lots set video_url = 'https://cdns.memealerts.com/p/649b210acfd0d2a8f427e00f/1870f6b6-c0d7-45c9-b39f-f7c00c5220b7/alert_orig.webm' where slug = 'lot-meme-myth' and video_url is null;
update public.lots set video_url = 'https://cdns.memealerts.com/p/66961426e904cc2377372321/cdd80a79-9dd9-4a44-a5a7-016de293f8d6/alert_orig.webm' where slug = 'lot-meme-evilzeg' and video_url is null;
