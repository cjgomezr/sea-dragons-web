-- Guardar y publicar el reparto de equipos de un evento (issue #401, RF-4,
-- RF-5 y RF-7 de `docs/prd/e10-team-builder.md`, FR-044 a FR-049).
--
-- Quién arma (Admin o Coach) y con quién (la escuadra del evento) lo decide
-- el servidor antes de llamar. Lo que las dos funciones vuelven a mirar, con
-- la fila del evento bloqueada (`for update`), es el evento mismo: pudo
-- cancelarse o quedar atrás entre que el servidor lo leyó y lo escribe. Las
-- dos responden sin escribir nada si ya no se puede armar: `not_found`,
-- `not_buildable` (una reunión o un social), `cancelled` o `past` (el día de
-- Melbourne ya terminó, D2). Con la fila bloqueada, dos coaches que guardan a
-- la vez se ponen en fila: queda el último, entero (RF-4).
--
-- `security definer` y sólo `service_role`, como `0044`: el servidor pasa el
-- club de quien llama, que sale de su fila de `members` y nunca del cuerpo de
-- la petición.

-- Lo que se avisó en la última publicación: `[{ user_id, team }]`. Volver a
-- publicar avisa sólo a quien cambió respecto de esto (D6), y guardar no lo
-- toca, así que sobrevive a los borradores intermedios.
alter table public.team_splits
  add column if not exists published_assignments jsonb not null
    default '[]'::jsonb;

-- Guarda el reparto entero: los dos equipos, el modo y las asignaciones.
-- Quien no viene en la lista sale, y el reparto vuelve a borrador (D6:
-- guardar no avisa, y el jugador no ve un reparto a medio publicar).
--
-- `split` es `{ mode, team_a_name, team_a_color, team_b_name, team_b_color,
-- assignments: [{ user_id, team }] }`. Un jugador de otro club hace fallar la
-- llamada por la clave compuesta de `0046`, y el fallo la deshace entera.
create or replace function public.save_team_split(
  acting_club_id uuid,
  acting_user_id uuid,
  target_event_id uuid,
  split jsonb
)
  returns text
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  target public.events%rowtype;
  saved_split_id uuid;
begin
  select * into target
    from public.events e
   where e.id = target_event_id
     and e.club_id = acting_club_id
     for update;

  if not found then
    return 'not_found';
  end if;
  if target.event_type not in ('training', 'competition') then
    return 'not_buildable';
  end if;
  if target.status = 'cancelled' then
    return 'cancelled';
  end if;
  if target.starts_on < (now() at time zone 'Australia/Melbourne')::date then
    return 'past';
  end if;

  insert into public.team_splits as s
    (event_id, club_id, team_a_name, team_a_color, team_b_name,
     team_b_color, mode, published_at, created_by)
  values
    (target_event_id, acting_club_id, split ->> 'team_a_name',
     split ->> 'team_a_color', split ->> 'team_b_name',
     split ->> 'team_b_color', split ->> 'mode', null, acting_user_id)
  on conflict (event_id)
  do update set team_a_name = excluded.team_a_name,
                team_a_color = excluded.team_a_color,
                team_b_name = excluded.team_b_name,
                team_b_color = excluded.team_b_color,
                mode = excluded.mode,
                published_at = null,
                updated_at = now()
  returning s.id into saved_split_id;

  delete from public.team_split_members m
   where m.split_id = saved_split_id;

  insert into public.team_split_members (split_id, user_id, club_id, team)
  select saved_split_id,
         (row ->> 'user_id')::uuid,
         acting_club_id,
         row ->> 'team'
    from jsonb_array_elements(split -> 'assignments') as row;

  return 'saved';
end;
$$;

-- Publica el reparto guardado: fija `published_at` y deja la foto de las
-- asignaciones en `published_assignments`. Responde la foto anterior y la
-- nueva para que el servidor avise sólo a quien cambió (D6), con los equipos
-- tal como quedaron publicados, o `empty` si no hay reparto o no tiene a
-- nadie (RF-7).
create or replace function public.publish_team_split(
  acting_club_id uuid,
  target_event_id uuid
)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  target public.events%rowtype;
  current_split public.team_splits%rowtype;
  current_assignments jsonb;
  published timestamptz := now();
begin
  select * into target
    from public.events e
   where e.id = target_event_id
     and e.club_id = acting_club_id
     for update;

  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if target.event_type not in ('training', 'competition') then
    return jsonb_build_object('outcome', 'not_buildable');
  end if;
  if target.status = 'cancelled' then
    return jsonb_build_object('outcome', 'cancelled');
  end if;
  if target.starts_on < (now() at time zone 'Australia/Melbourne')::date then
    return jsonb_build_object('outcome', 'past');
  end if;

  select * into current_split
    from public.team_splits s
   where s.event_id = target_event_id;

  select coalesce(
           jsonb_agg(
             jsonb_build_object('user_id', m.user_id, 'team', m.team)
             order by m.user_id
           ),
           '[]'::jsonb
         )
    into current_assignments
    from public.team_split_members m
   where m.split_id = current_split.id;

  if current_split.id is null or jsonb_array_length(current_assignments) = 0
  then
    return jsonb_build_object('outcome', 'empty');
  end if;

  update public.team_splits s
     set published_at = published,
         published_assignments = current_assignments,
         updated_at = published
   where s.id = current_split.id;

  return jsonb_build_object(
    'outcome', 'published',
    'published_at', published,
    'team_a_name', current_split.team_a_name,
    'team_a_color', current_split.team_a_color,
    'team_b_name', current_split.team_b_name,
    'team_b_color', current_split.team_b_color,
    'previous', current_split.published_assignments,
    'current', current_assignments
  );
end;
$$;

-- Como `save_attendance_sheet`: Postgres concede `execute` a PUBLIC en toda
-- función nueva, y el `pg_default_acl` de Supabase además a `anon` y
-- `authenticated`. Abiertas a ellos, cualquier socio podría armar equipos
-- llamándolas por PostgREST.
revoke all on function public.save_team_split(uuid, uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.save_team_split(uuid, uuid, uuid, jsonb)
  to service_role;

revoke all on function public.publish_team_split(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.publish_team_split(uuid, uuid)
  to service_role;

-- Los avisos de publicar el reparto (D6): `team_assigned` a quien entra o
-- cambia de equipo, `team_unassigned` a quien sale. El catálogo vive también
-- en `NOTIFICATION_TYPES` (`src/lib/notifications/notify-member.ts`) y
-- cambian juntos. Sólo si la restricción vigente aún no los admite, por lo
-- que cuenta `0042_event_change_notifications.sql`.
do $$
begin
  if exists (
    select 1
      from pg_constraint
     where conrelid = 'public.notifications'::regclass
       and conname = 'notifications_type_check'
       and strpos(pg_get_constraintdef(oid), '''team_unassigned''') > 0
  ) then
    return;
  end if;
  alter table public.notifications
    drop constraint if exists notifications_type_check;
  alter table public.notifications
    add constraint notifications_type_check check (type in (
      'role_changed',
      'role_request_rejected',
      'role_request_received',
      'news_post_published',
      'event_created',
      'event_series_created',
      'event_changed',
      'event_cancelled',
      'event_series_changed',
      'event_series_cancelled',
      'team_assigned',
      'team_unassigned'
    ));
end
$$;

-- Como en `0008_sonda_salud.sql`: que PostgREST vea las funciones y la
-- columna en cuanto se aplica.
notify pgrst, 'reload schema';
