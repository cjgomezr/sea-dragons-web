-- Fijar una publicación arriba del feed (issue #592, RF-3 de
-- `docs/prd/e22-rediseno-noticias.md`).
--
-- `pinned_at` dice desde cuándo está fijada y `pinned_until` hasta cuándo,
-- nula si no tiene fecha de fin. La caducidad se calcula al leer (D7): una
-- fijada cuyo `pinned_until` ya pasó cuenta como no fijada, y nada la limpia
-- hasta que alguien fija otra.
--
-- Solo cabe una por club (D1), y eso lo garantiza el índice único parcial, no
-- la aplicación. Fijar y desfijar van por dos funciones `security definer`
-- que comprueban dentro que quien llama es Admin y hacen la sustitución en una
-- sola transacción. Como `0047`, sólo las llama `service_role`: el servidor
-- pasa el club y el id de quien llama, que salen de su sesión.
--
-- Nadie escribe estas columnas con su sesión: `authenticated` sólo tiene
-- `select` sobre `news_posts` desde `0029_news_posts.sql`.

alter table public.news_posts
  add column if not exists pinned_at timestamptz,
  add column if not exists pinned_until timestamptz;

-- Una fecha de fin sin fijado no significa nada, y una retirada no se fija.
-- `do` porque `add constraint` no admite `if not exists`, y producción
-- reaplica el histórico entero en cada merge.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'news_posts_pin_check'
  ) then
    alter table public.news_posts
      add constraint news_posts_pin_check check (
        (pinned_until is null or pinned_at is not null)
        and (pinned_at is null or status = 'published')
      );
  end if;
end;
$$;

-- Una fijada por club. Una caducada sigue ocupando el sitio hasta que se fija
-- otra, y fijar la quita en la misma transacción.
create unique index if not exists news_posts_one_pinned_per_club
  on public.news_posts (club_id)
  where pinned_at is not null;

-- Retirar la fijada la desfija (D8). Va en un trigger para que ningún camino
-- que retire se olvide; volver a publicar no la toca, así que sigue sin fijar.
create or replace function public.news_posts_unpin_withdrawn()
  returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  new.pinned_at := null;
  new.pinned_until := null;
  return new;
end
$$;

-- Sólo la usa el trigger.
revoke all on function public.news_posts_unpin_withdrawn()
  from public, anon, authenticated;

drop trigger if exists news_posts_unpin_withdrawn on public.news_posts;
create trigger news_posts_unpin_withdrawn
  before update of status on public.news_posts
  for each row
  when (new.status = 'withdrawn')
  execute function public.news_posts_unpin_withdrawn();

-- Fija la publicación hasta `pin_until` (nula: sin fecha de fin) y desfija
-- la que estuviera fijada. Responde `{ outcome }`: `forbidden` si quien llama
-- no es Admin de alta en el club, `not_found`, `withdrawn`, `invalid_until`
-- si la fecha ya pasó, o `pinned` con `replaced_post_id`, la fijada vigente
-- que quitó (nula si no había).
--
-- La fila del club se bloquea antes de nada: dos Admin que fijan a la vez se
-- ponen en fila y gana el último, entero. Sin el bloqueo, el segundo chocaría
-- con el índice y fallaría en vez de reemplazar.
create or replace function public.pin_news_post(
  acting_club_id uuid,
  acting_user_id uuid,
  target_post_id uuid,
  pin_until timestamptz
)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  target public.news_posts%rowtype;
  replaced_post_id uuid;
begin
  if not exists (
    select 1
      from public.members m
     where m.user_id = acting_user_id
       and m.club_id = acting_club_id
       and m.role = 'Admin'
       and m.account_status = 'active'
  ) then
    return jsonb_build_object('outcome', 'forbidden');
  end if;

  perform 1 from public.clubs c where c.id = acting_club_id for no key update;

  select * into target
    from public.news_posts p
   where p.id = target_post_id
     and p.club_id = acting_club_id
     for update;

  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if target.status <> 'published' then
    return jsonb_build_object('outcome', 'withdrawn');
  end if;
  if pin_until is not null and pin_until <= now() then
    return jsonb_build_object('outcome', 'invalid_until');
  end if;

  select p.id into replaced_post_id
    from public.news_posts p
   where p.club_id = acting_club_id
     and p.id <> target_post_id
     and p.pinned_at is not null
     and (p.pinned_until is null or p.pinned_until > now());

  update public.news_posts p
     set pinned_at = null,
         pinned_until = null
   where p.club_id = acting_club_id
     and p.id <> target_post_id
     and p.pinned_at is not null;

  update public.news_posts p
     set pinned_at = now(),
         pinned_until = pin_until
   where p.id = target_post_id;

  return jsonb_build_object(
    'outcome', 'pinned',
    'replaced_post_id', replaced_post_id
  );
end;
$$;

-- Desfija la publicación. Responde `{ outcome }`: `forbidden`, `not_found`,
-- `unpinned` si estaba fijada y vigente, o `not_pinned` si no lo estaba (una
-- caducada también se limpia, pero no cuenta como desfijar).
create or replace function public.unpin_news_post(
  acting_club_id uuid,
  acting_user_id uuid,
  target_post_id uuid
)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  target public.news_posts%rowtype;
begin
  if not exists (
    select 1
      from public.members m
     where m.user_id = acting_user_id
       and m.club_id = acting_club_id
       and m.role = 'Admin'
       and m.account_status = 'active'
  ) then
    return jsonb_build_object('outcome', 'forbidden');
  end if;

  select * into target
    from public.news_posts p
   where p.id = target_post_id
     and p.club_id = acting_club_id
     for update;

  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if target.pinned_at is null then
    return jsonb_build_object('outcome', 'not_pinned');
  end if;

  update public.news_posts p
     set pinned_at = null,
         pinned_until = null
   where p.id = target_post_id;

  if target.pinned_until is not null and target.pinned_until <= now() then
    return jsonb_build_object('outcome', 'not_pinned');
  end if;
  return jsonb_build_object('outcome', 'unpinned');
end;
$$;

-- Como `save_team_split`: Postgres concede `execute` a PUBLIC en toda
-- función nueva, y el `pg_default_acl` de Supabase además a `anon` y
-- `authenticated`. Abiertas a ellos, cualquier socio podría fijar llamándolas
-- por PostgREST.
revoke all on function public.pin_news_post(uuid, uuid, uuid, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.pin_news_post(uuid, uuid, uuid, timestamptz)
  to service_role;

revoke all on function public.unpin_news_post(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.unpin_news_post(uuid, uuid, uuid)
  to service_role;

-- Como en `0008_sonda_salud.sql`: que PostgREST vea las columnas y las
-- funciones en cuanto se aplica.
notify pgrst, 'reload schema';
