-- Quién publicó cada reparto (#838), para avisarle cuando uno de sus
-- jugadores deja de ir o vuelve a ir.
--
-- Lo escribe la función de publicar de `0047_team_split_writes.sql`, que
-- ahora recibe a quien publica, y lo vacía la de guardar, que deja el reparto
-- en borrador. Los repartos publicados antes de esta migración se quedan sin
-- nadie: no se sabe quién fue, y entonces el aviso va a los Admin.

alter table public.team_splits
  add column if not exists published_by uuid;

-- Como `created_by` (`0046`): quien publica es un miembro del mismo club, y
-- borrarlo no borra el reparto, sólo lo olvida. La lista de columnas del
-- `set null` deja el `club_id`, que no puede ser nulo.
do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'team_splits_publisher_same_club_fkey'
  ) then
    alter table public.team_splits
      add constraint team_splits_publisher_same_club_fkey
      foreign key (published_by, club_id)
      references public.members (user_id, club_id)
      on delete set null (published_by);
  end if;
end;
$$;

-- La que recorre la clave al borrar un miembro.
create index if not exists team_splits_published_by_club_id_idx
  on public.team_splits (published_by, club_id);

-- La de `0047`, que vuelve a borrador y ahora olvida también quién publicó.
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
     team_b_color, mode, published_at, published_by, created_by)
  values
    (target_event_id, acting_club_id, split ->> 'team_a_name',
     split ->> 'team_a_color', split ->> 'team_b_name',
     split ->> 'team_b_color', split ->> 'mode', null, null, acting_user_id)
  on conflict (event_id)
  do update set team_a_name = excluded.team_a_name,
                team_a_color = excluded.team_a_color,
                team_b_name = excluded.team_b_name,
                team_b_color = excluded.team_b_color,
                mode = excluded.mode,
                published_at = null,
                published_by = null,
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

-- Una función con otra firma sería otra función: la de antes se quita para
-- que nadie publique sin decir quién es.
drop function if exists public.publish_team_split(uuid, uuid);

-- La de `0047`, apuntando a quien publica.
create or replace function public.publish_team_split(
  acting_club_id uuid,
  acting_user_id uuid,
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
         published_by = acting_user_id,
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

-- Como en `0047`: sólo el servidor arma y publica.
revoke all on function public.save_team_split(uuid, uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.save_team_split(uuid, uuid, uuid, jsonb)
  to service_role;

revoke all on function public.publish_team_split(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.publish_team_split(uuid, uuid, uuid)
  to service_role;

-- Los avisos a quien publicó: `team_player_dropped` cuando un jugador suyo
-- responde que no viene, `team_player_returned` cuando vuelve a ir. El
-- catálogo vive también en `NOTIFICATION_TYPES`
-- (`src/lib/notifications/notify-member.ts`) y cambian juntos. Sólo si la
-- restricción vigente aún no los admite, por lo que cuenta
-- `0054_membership_renewal_notifications.sql`.
do $$
begin
  if exists (
    select 1
      from pg_constraint
     where conrelid = 'public.notifications'::regclass
       and conname = 'notifications_type_check'
       and strpos(pg_get_constraintdef(oid), '''team_player_returned''') > 0
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
      'team_unassigned',
      'membership_renewal_upcoming',
      'team_player_dropped',
      'team_player_returned'
    ));
end
$$;

-- Como en `0008_sonda_salud.sql`: que PostgREST vea la función y la columna
-- en cuanto se aplica.
notify pgrst, 'reload schema';
