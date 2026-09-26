-- Заявки на привет (спека scratch/suggest-greeting/spec.md, тикет 08).
-- Чатерс, вошедший через Twitch, предлагает привет ссылкой на видео; заявка
-- получает человекочитаемый номер (#id) и уходит админу. Путь записи — прямой
-- INSERT под RLS (паттерн покупок): клиент шлёт только пользовательские поля,
-- а автора, статус, связи и нормализацию ссылки считает BEFORE-триггер.
--
-- Решения (тикеты 04/05): статусы new/accepted/rejected/duplicate меняет только
-- агент/админ через service_role; лимит — не больше 10 открытых заявок на
-- чатерса; ссылка — только https и хост из allowlist, хранится нормализованной
-- (lower-case host, без fragment и трекинга utm_*/si/igsh).
-- Применить: мёрж в main применит сам; руками на прод НЕ накатывать.

-- 0. Таблица: номер #N (identity), автор снимком ника, контент и служебные поля.
create table public.submissions (
  id bigint generated always as identity primary key,
  author_uid uuid null references auth.users (id) on delete set null,
  author_login text not null,
  title text not null,
  video_url text not null,
  comment text null,
  status text not null default 'new'
    check (status in ('new', 'accepted', 'rejected', 'duplicate')),
  lot_id bigint null references public.lots (id) on delete set null,
  rewarded_at timestamptz null,
  notified_at timestamptz null,
  created_at timestamptz not null default now(),
  decided_at timestamptz null
);
-- Лимит/«свои заявки» триггера и RLS-выборки ходят по (author_uid, status);
-- очередь админа — по свежим открытым.
create index submissions_author_status_idx on public.submissions (author_uid, status);
create index submissions_status_created_idx on public.submissions (status, created_at desc);

-- 1. Гранты + RLS: клиент видит/создаёт только свои; статус и связи — серверу.
revoke all on public.submissions from anon, authenticated;
grant select, insert on public.submissions to authenticated;
grant select, insert, update, delete on public.submissions to service_role;
grant usage, select on sequence public.submissions_id_seq
  to anon, authenticated, service_role;

alter table public.submissions enable row level security;

create policy submissions_select_own on public.submissions
  for select to authenticated
  using ((select auth.uid()) = author_uid);

create policy submissions_insert_own on public.submissions
  for insert to authenticated
  with check ((select auth.uid()) = author_uid);

-- 2. BEFORE INSERT: автор и нормализованная ссылка из сессии; серверные поля
-- (статус, связь с лотом, метки награды/уведомления, решение) клиенту недоступны.
-- Лимиты: title 1..80 (как maxlength формы), comment 0..500, video_url 1..2048.
create or replace function public.enforce_submission_rules()
returns trigger language plpgsql
security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_jwt jsonb := auth.jwt();
  v_login text;
  v_url text;
  v_base text;
  v_after_scheme text;
  v_authority text;
  v_host text;
  v_path text;
  v_query text;
  v_query_clean text := '';
  v_pair text;
  v_key text;
  c_max_open int := 10;
  c_title_max int := 80;
  c_comment_max int := 500;
  c_url_max int := 2048;
  c_hosts text[] := array[
    'clips.twitch.tv',
    'twitch.tv',
    'www.twitch.tv',
    'youtube.com',
    'www.youtube.com',
    'youtu.be',
    'streamable.com',
    'www.streamable.com',
    'medal.tv',
    'www.medal.tv',
    'vk.com',
    'vkvideo.ru',
    'cdns.memealerts.com'
  ];
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  -- Автор — из сессии/JWT, клиент подделать не может (как в enforce_purchase_rules).
  v_login := coalesce(
    v_jwt -> 'user_metadata' ->> 'user_name',
    v_jwt -> 'user_metadata' ->> 'preferred_username',
    v_jwt -> 'user_metadata' ->> 'name',
    v_jwt ->> 'email');
  NEW.author_uid := v_uid;
  NEW.author_login := coalesce(v_login, v_uid::text);

  -- Служебные поля задаёт только админ/сервер: клиент их не контролирует.
  -- created_at тоже серверное: иначе клиент подставит любое время и подделает
  -- очередь/аудит (у колонки только default now(), его можно перебить значением).
  NEW.status := 'new';
  NEW.lot_id := null;
  NEW.rewarded_at := null;
  NEW.notified_at := null;
  NEW.decided_at := null;
  NEW.created_at := now();

  -- Название обязательно; пустое после обрезки пробелов — отказ.
  if NEW.title is null then raise exception 'title required'; end if;
  NEW.title := btrim(NEW.title);
  if NEW.title = '' then raise exception 'title required'; end if;
  if length(NEW.title) > c_title_max then
    raise exception 'title too long: max %', c_title_max;
  end if;

  -- Комментарий опционален: пустое/пробельное превращаем в NULL.
  if NEW.comment is not null then
    NEW.comment := nullif(btrim(NEW.comment), '');
    if NEW.comment is not null and length(NEW.comment) > c_comment_max then
      raise exception 'comment too long: max %', c_comment_max;
    end if;
  end if;

  -- Ссылка: только https и хост из allowlist; храним нормализованный вид.
  if NEW.video_url is null then raise exception 'video url required'; end if;
  v_url := btrim(NEW.video_url);
  if v_url = '' then raise exception 'video url required'; end if;
  if length(v_url) > c_url_max then
    raise exception 'video url too long: max %', c_url_max;
  end if;
  if v_url !~* '^https://' then raise exception 'video url must be https'; end if;

  v_base := split_part(v_url, '#', 1);  -- fragment отбрасываем совсем
  if position('?' in v_base) > 0 then
    v_query := substring(v_base from position('?' in v_base) + 1);
    v_base := split_part(v_base, '?', 1);
  end if;

  v_after_scheme := substring(v_base from 9);  -- отрезаем 'https://' (8 знаков)
  v_authority := split_part(v_after_scheme, '/', 1);
  -- userinfo (логин@) и нестандартный порт — не наш случай, вежливый отказ.
  if position('@' in v_authority) > 0 then
    raise exception 'video url host not allowed';
  end if;
  if position(':' in v_authority) > 0 then
    if split_part(v_authority, ':', 2) not in ('', '443') then
      raise exception 'video url host not allowed';
    end if;
    v_authority := split_part(v_authority, ':', 1);
  end if;
  v_host := lower(v_authority);
  if not (v_host = any (c_hosts)) then
    raise exception 'video url host not allowed: %', v_host;
  end if;

  v_path := '';
  if position('/' in v_after_scheme) > 0 then
    v_path := substring(v_after_scheme from position('/' in v_after_scheme));
  end if;

  -- Трекинг (utm_*/si/igsh) выкидываем; остальные параметры (например, t=) храним.
  if v_query <> '' then
    foreach v_pair in array string_to_array(v_query, '&') loop
      v_key := lower(split_part(v_pair, '=', 1));
      if v_key = '' then continue; end if;
      if left(v_key, 4) = 'utm_' or v_key in ('si', 'igsh') then continue; end if;
      v_query_clean := v_query_clean || case when v_query_clean = '' then '' else '&' end || v_pair;
    end loop;
  end if;

  NEW.video_url := 'https://' || v_host || v_path ||
    case when v_query_clean <> '' then '?' || v_query_clean else '' end;

  -- Анти-спам: не больше 10 открытых ('new') заявок на чатерса.
  if (select count(*) from public.submissions as s
      where s.author_uid = v_uid and s.status = 'new') >= c_max_open then
    raise exception 'too many open submissions: max %', c_max_open;
  end if;

  return NEW;
end;
$$;
revoke execute on function public.enforce_submission_rules() from public, anon, authenticated;

create trigger trg_submissions_before_insert
  before insert on public.submissions
  for each row execute function public.enforce_submission_rules();
