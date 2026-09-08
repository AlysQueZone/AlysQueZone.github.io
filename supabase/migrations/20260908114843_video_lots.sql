-- [Стройка video-s3, тикет 07] Видеополя лотов, снос ЛУКа, бакет media.
-- Спека: scratch/video-s3/spec.md §1. Идемпотентна к живым данным:
-- повторный прогон не затирает живых владельцев/цен (guard NOT EXISTS purchases,
-- ON CONFLICT DO NOTHING, IF NOT EXISTS).
-- Применение: Deploy to production при мерже в main. НЕ применять к проду вручную.
-- RLS и storage-политики НЕ трогаем: lots_select_public покрывает новые колонки,
-- заливка идёт через Dashboard и обходит RLS.

-- 1. Новые колонки. Дефолт rarity='common' — чтобы пройти на живых строках.
alter table public.lots add column if not exists video_url text null;
alter table public.lots add column if not exists rarity text not null default 'common'
  check (rarity in ('common', 'rare', 'legendary'));
alter table public.lots add column if not exists meme_text text null;

-- 2. Backfill rarity/meme_text по слагу из data/lots.json (luk-legend пропускаем —
-- его строка сносится шагом 4). Лотам без мема в JSON правим только rarity,
-- meme_text не трогаем (уже null), чтобы повторный прогон не затирал правки.
update public.lots set rarity = 'common', meme_text = '😴' where slug = 'lot-gedo-sleepy';
update public.lots set rarity = 'common' where slug = 'lot-gedo-uvernulya';
update public.lots set rarity = 'rare' where slug = 'lot-gedo-flat';
update public.lots set rarity = 'common' where slug = 'lot-evil-friendship';
update public.lots set rarity = 'common' where slug = 'lot-cool-holst';
update public.lots set rarity = 'common' where slug = 'lot-gribo-calendar';
update public.lots set rarity = 'rare' where slug = 'lot-vandal-privet';
update public.lots set rarity = 'common' where slug = 'lot-rush-podelu';
update public.lots set rarity = 'common' where slug = 'lot-las-skum';
update public.lots set rarity = 'common', meme_text = 'МНОГОУВАЖАЕМЫЕ АНДРЕИ' where slug = 'lot-andrew-37';
update public.lots set rarity = 'rare', meme_text = '@nyanyachos' where slug = 'lot-meme-nyachos';
update public.lots set rarity = 'rare', meme_text = 'оптовый привет' where slug = 'lot-meme-optom';
update public.lots set rarity = 'rare', meme_text = 'массовый привет' where slug = 'lot-meme-mass';
update public.lots set rarity = 'rare', meme_text = 'повторный привет' where slug = 'lot-meme-repeat';
update public.lots set rarity = 'rare', meme_text = 'привет для remolol' where slug = 'lot-meme-remolol';
update public.lots set rarity = 'rare', meme_text = 'привет для Салата' where slug = 'lot-meme-salat';
update public.lots set rarity = 'rare', meme_text = 'привет для Quevizar' where slug = 'lot-meme-quevizar';
update public.lots set rarity = 'rare', meme_text = 'миф о бесплатном пивете' where slug = 'lot-meme-myth';
update public.lots set rarity = 'rare', meme_text = 'привет Evilzeg' where slug = 'lot-meme-evilzeg';

-- 3. Обнулить сид-владельцев только у лотов без живых покупок.
-- Лоты с покупками (живые владельцы/цены) не трогаем.
update public.lots set owner_uid = null, owner_twitch_id = null, owner_login = null
  where not exists (select 1 from public.purchases where lot_id = lots.id);

-- 4. Снос ЛУКа: строка, колонка, ветка триггера.
delete from public.lots where slug = 'luk-legend';
alter table public.lots drop column if exists is_locked;

-- Переписан enforce_purchase_rules() без v_locked: убраны select is_locked
-- и exception 'is not for sale'. Пауза per-(user,lot) 30с, кап 10 покупок/10мин,
-- цена ceil +10% и кап цены — без изменений.
create or replace function public.enforce_purchase_rules()
returns trigger language plpgsql
security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_jwt jsonb := auth.jwt();
  v_twitch_id text;
  v_login text;
  v_price bigint;
  c_cooldown interval := interval '30 seconds';
  c_max_per_window int := 10;
  c_window interval := interval '10 minutes';
  c_max_price bigint := 1000000000;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  select l.price into v_price
    from public.lots as l where l.id = NEW.lot_id for update;
  if not found then raise exception 'lot % not found', NEW.lot_id; end if;

  v_twitch_id := coalesce(
    v_jwt -> 'user_metadata' ->> 'provider_id',
    v_jwt -> 'user_metadata' ->> 'sub');
  v_login := coalesce(
    v_jwt -> 'user_metadata' ->> 'user_name',
    v_jwt -> 'user_metadata' ->> 'preferred_username',
    v_jwt -> 'user_metadata' ->> 'name',
    v_jwt ->> 'email');
  if v_twitch_id is null then raise exception 'no twitch identity in jwt'; end if;
  NEW.buyer_uid := v_uid;
  NEW.buyer_twitch_id := v_twitch_id;
  NEW.buyer_login := coalesce(v_login, v_uid::text);

  NEW.price_paid := ceil(v_price * 1.1)::bigint;
  if NEW.price_paid <= v_price then NEW.price_paid := v_price + 1; end if;
  if NEW.price_paid > c_max_price then raise exception 'price cap reached'; end if;

  -- Пауза per-(user,lot): только моя последняя покупка ЭТОГО лота.
  if exists (select 1 from public.purchases
             where buyer_uid = v_uid and lot_id = NEW.lot_id
               and created_at > now() - c_cooldown) then
    raise exception 'cooldown: wait %', c_cooldown;
  end if;
  if (select count(*) from public.purchases
      where buyer_uid = v_uid and created_at > now() - c_window) >= c_max_per_window then
    raise exception 'rate limit: max % per %', c_max_per_window, c_window;
  end if;

  return NEW;
end;
$$;
revoke execute on function public.enforce_purchase_rules() from public, anon, authenticated;

-- 5. Публичный бакет под UI-звуки (sounds/*.mp3) и будущие свои видео (videos/).
insert into storage.buckets (id, name, public) values ('media', 'media', true)
  on conflict (id) do nothing;
