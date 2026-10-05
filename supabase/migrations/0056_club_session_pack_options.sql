-- Los packs de sesiones que el club ofrece a sus Casual (issue #469, RF-4 de
-- `docs/prd/e13-stripe-avanzado.md`, D2 y FR-080). Un pack es sólo un número
-- de sesiones: lo que cuesta lo decide el `Price` de la sesión Casual en
-- Stripe, multiplicado por ese número, así que aquí no hay ningún importe.
--
-- El Admin y el Committee cambian la lista entera de una vez, con
-- `replace_club_session_pack_options`. Cada club empieza con 5 y 10.

create table if not exists public.club_session_pack_options (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  sessions integer not null
    constraint club_session_pack_options_sessions_check
    check (sessions between 1 and 50),
  -- El orden en que se ofrecen, desde 1.
  position integer not null
    constraint club_session_pack_options_position_check check (position >= 1),
  created_at timestamptz not null default now(),
  constraint club_session_pack_options_club_id_sessions_key
    unique (club_id, sessions),
  constraint club_session_pack_options_club_id_position_key
    unique (club_id, position)
);

alter table public.club_session_pack_options enable row level security;

-- Cualquier cuenta activa del club los ve: son lo que un Casual puede
-- comprar. `members_select_own` deja a cada uno leer su propia fila, así que
-- esta consulta no necesita saltarse RLS.
drop policy if exists club_session_pack_options_select_own_club
  on public.club_session_pack_options;
create policy club_session_pack_options_select_own_club
  on public.club_session_pack_options
  for select
  to authenticated
  using (
    club_id in (
      select m.club_id
        from public.members m
       where m.user_id = (select auth.uid())
         and m.account_status = 'active'
    )
  );

-- Revocar primero, como en `0003_members.sql`: el proyecto concede todo a
-- `anon` y `authenticated` sobre cada tabla nueva. Escribir es del servidor.
revoke all on public.club_session_pack_options from anon, authenticated;
grant select on public.club_session_pack_options to authenticated;
grant select, insert, update, delete on public.club_session_pack_options
  to service_role;

-- Cambia la lista entera en una transacción: con escrituras sueltas, un fallo
-- a medias dejaría al club sin ningún pack que vender. Bloquea antes la fila
-- del club, así dos que guardan a la vez se esperan y gana el segundo entero.
--
-- El servidor ya validó la lista y comprobó quién llama; la tabla vuelve a
-- rechazar un tamaño fuera de rango o repetido, y esto, la lista vacía.
create or replace function public.replace_club_session_pack_options(
  acting_club_id uuid,
  pack_sessions integer[]
)
  returns void
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
begin
  if coalesce(cardinality(pack_sessions), 0) = 0 then
    raise exception 'el club necesita ofrecer al menos un pack'
      using errcode = 'invalid_parameter_value';
  end if;

  perform 1 from public.clubs c where c.id = acting_club_id for update;

  delete from public.club_session_pack_options o
   where o.club_id = acting_club_id;

  insert into public.club_session_pack_options (club_id, sessions, position)
  select acting_club_id, wanted.sessions, wanted.position
    from unnest(pack_sessions) with ordinality as wanted (sessions, position);
end;
$$;

revoke all on function public.replace_club_session_pack_options(uuid, integer[])
  from public, anon, authenticated, service_role;
grant execute on function public.replace_club_session_pack_options(uuid, integer[])
  to service_role;

create or replace function public.seed_default_session_pack_options(
  target_club_id uuid
)
  returns void
  language sql
  set search_path = ''
as $$
  insert into public.club_session_pack_options (club_id, sessions, position)
  values (target_club_id, 5, 1), (target_club_id, 10, 2);
$$;

-- La usan la migración y el trigger, nadie más.
revoke all on function public.seed_default_session_pack_options(uuid)
  from public, anon, authenticated;

-- Sólo en los clubes que no tienen ninguno: producción reaplica el histórico
-- en cada merge, y repetirla no debe resucitar un pack que el club quitó. Un
-- club nunca se queda sin packs, así que "ninguno" es "nunca se sembró".
select public.seed_default_session_pack_options(c.id)
  from public.clubs c
 where not exists (
   select 1
     from public.club_session_pack_options o
    where o.club_id = c.id
 );

-- Un club creado después de esta migración recibe los suyos aquí.
create or replace function public.clubs_seed_default_session_pack_options()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  perform public.seed_default_session_pack_options(new.id);
  return new;
end;
$$;

drop trigger if exists clubs_seed_default_session_pack_options
  on public.clubs;
create trigger clubs_seed_default_session_pack_options
  after insert on public.clubs
  for each row
  execute function public.clubs_seed_default_session_pack_options();

-- El trigger no se llama a mano.
revoke all on function public.clubs_seed_default_session_pack_options()
  from public, anon, authenticated;

-- Como en `0008_sonda_salud.sql`: que PostgREST vea la función en cuanto se
-- aplica, aunque faltara el event trigger que recarga su caché.
notify pgrst, 'reload schema';
