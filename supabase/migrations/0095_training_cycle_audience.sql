-- Para quién es cada ciclo y varios activos sin solaparse (issue #978, D1,
-- D2, D3, D8 y D9 de `docs/prd/e38-ciclos-por-grupo.md`). Un ciclo es de
-- todo el club o de uno o más grupos; puede haber a la vez como mucho un
-- activo de todo el club y, por cada grupo, como mucho uno que lo incluya.
-- Cambia la D5 de E35, que dejaba un solo activo por club.
--
-- La regla vive en la base, no sólo en la API: un índice único parcial para
-- el de todo el club y otro sobre los grupos de los ciclos activos, con la
-- marca `cycle_active` que mantienen dos triggers. Activar y cambiar la
-- audiencia bloquean los ciclos del club, así que dos a la vez esperan en
-- fila; y si alguien escribe sin pasar por las funciones, los índices lo
-- rechazan.
--
-- Todo lo escribe el servidor con la llave de servicio (D4 de E35). La policy
-- de lectura para los socios es del #979; aquí sólo la de quien planifica.
--
-- Producción reaplica el histórico entero en cada merge: todo es
-- `if not exists`, `create or replace` o `drop ... if exists`, y `0083` no
-- recrea su índice de un activo por club cuando este ya está puesto.

-- La audiencia explícita (D1): un ciclo de grupos sin grupos sigue siendo de
-- grupos (D9). Lo que ya había queda de todo el club.
alter table public.training_cycles
  add column if not exists audience text not null default 'club';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.training_cycles'::regclass
       and conname = 'training_cycles_audience_check'
  ) then
    alter table public.training_cycles
      add constraint training_cycles_audience_check
      check (audience in ('club', 'groups'));
  end if;
end
$$;

-- Un solo activo de todo el club; los de grupos van aparte (D2).
create unique index if not exists training_cycles_one_active_club_cycle
  on public.training_cycles (club_id)
  where status = 'active' and audience = 'club';

drop index if exists public.training_cycles_one_active_per_club;

create table if not exists public.training_cycle_groups (
  cycle_id uuid not null,
  group_id uuid not null,
  -- Redundante a propósito, como en `group_memberships`: las dos claves
  -- compuestas lo atan al club del ciclo y al del grupo, y eso impide mezclar
  -- clubes sin un trigger.
  club_id uuid not null references public.clubs (id),
  -- Copia del estado del ciclo, para que el índice de abajo pueda ver si está
  -- activo. La mantienen los triggers; nadie la escribe a mano.
  cycle_active boolean not null default false,
  constraint training_cycle_groups_pkey primary key (cycle_id, group_id),
  constraint training_cycle_groups_cycle_same_club_fkey
    foreign key (cycle_id, club_id)
    references public.training_cycles (id, club_id) on delete cascade,
  -- Borrar un grupo lo quita del ciclo, que se queda de grupos (D9).
  constraint training_cycle_groups_group_same_club_fkey
    foreign key (group_id, club_id)
    references public.groups (id, club_id) on delete cascade
);

-- Por cada grupo, como mucho un ciclo activo que lo incluya (D2).
create unique index if not exists training_cycle_groups_one_active
  on public.training_cycle_groups (group_id)
  where cycle_active;

-- La cascada al borrar un grupo.
create index if not exists training_cycle_groups_group_id_club_id_idx
  on public.training_cycle_groups (group_id, club_id);

-- Al poner o cambiar una fila, la marca se lee del ciclo.
create or replace function public.training_cycle_groups_read_active()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  new.cycle_active := exists (
    select 1
      from public.training_cycles c
     where c.id = new.cycle_id
       and c.status = 'active'
  );
  return new;
end;
$$;

drop trigger if exists training_cycle_groups_read_active
  on public.training_cycle_groups;
create trigger training_cycle_groups_read_active
  before insert or update on public.training_cycle_groups
  for each row execute function public.training_cycle_groups_read_active();

-- Al cambiar el estado del ciclo, sus filas recalculan la marca: si con eso
-- dos activos comparten grupo, el índice rechaza el cambio entero.
create or replace function public.training_cycles_sync_group_active()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  update public.training_cycle_groups cg
     set cycle_active = new.status = 'active'
   where cg.cycle_id = new.id;
  return null;
end;
$$;

drop trigger if exists training_cycles_sync_group_active
  on public.training_cycles;
create trigger training_cycles_sync_group_active
  after update of status on public.training_cycles
  for each row
  when (old.status is distinct from new.status)
  execute function public.training_cycles_sync_group_active();

-- Privilegios: revocar primero, porque el proyecto concede todo por defecto
-- (skill `nextjs-supabase-practices`, §1). Con la sesión sólo se lee.
alter table public.training_cycle_groups enable row level security;
revoke all on public.training_cycle_groups from anon, authenticated;
grant select on public.training_cycle_groups to authenticated;
grant select, insert, update, delete on public.training_cycle_groups
  to service_role;

-- Quien planifica. Lo que ve cada socio lo decide el #979.
drop policy if exists training_cycle_groups_select_planner
  on public.training_cycle_groups;
create policy training_cycle_groups_select_planner
  on public.training_cycle_groups
  for select
  to authenticated
  using (public.is_training_planner(club_id));

-- Los activos del club, sin `p_cycle_id`, con los que chocaría un ciclo de
-- esa audiencia y esos grupos (D2).
create or replace function public.training_cycle_conflicts(
  p_club_id uuid,
  p_cycle_id uuid,
  p_audience text,
  p_group_ids uuid[]
)
  returns table (conflict_id uuid, conflict_name text)
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select c.id, c.name
    from public.training_cycles c
   where c.club_id = p_club_id
     and c.status = 'active'
     and c.id <> p_cycle_id
     and (
       (p_audience = 'club' and c.audience = 'club')
       or (
         p_audience = 'groups'
         and exists (
           select 1
             from public.training_cycle_groups cg
            where cg.cycle_id = c.id
              and cg.group_id = any (p_group_ids)
         )
       )
     )
   order by c.name, c.id;
$$;

-- Archiva los que chocan y devuelve una fila por cada uno.
create or replace function public.archive_training_cycle_conflicts(
  p_club_id uuid,
  p_cycle_id uuid,
  p_audience text,
  p_group_ids uuid[]
)
  returns table (archived_id uuid, archived_name text)
  language sql
  security invoker
  set search_path = ''
as $$
  update public.training_cycles c
     set status = 'archived', updated_at = now()
    from public.training_cycle_conflicts(
           p_club_id, p_cycle_id, p_audience, p_group_ids) k
   where c.id = k.conflict_id
  returning c.id, c.name;
$$;

-- Un ciclo de grupos se guarda con al menos uno (RF-1); la API lo dice con
-- un 422 antes de llegar aquí.
create or replace function public.assert_training_cycle_audience(
  p_audience text,
  p_group_ids uuid[]
)
  returns void
  language plpgsql
  immutable
  security invoker
  set search_path = ''
as $$
begin
  if p_audience = 'groups' and coalesce(cardinality(p_group_ids), 0) = 0 then
    raise exception 'Un ciclo de grupos necesita al menos un grupo.'
      using errcode = 'check_violation';
  end if;
end;
$$;

-- Un borrador con su audiencia, en una transacción: un grupo de otro club lo
-- rechaza la clave compuesta y no queda ciclo a medias.
create or replace function public.create_training_cycle(
  p_club_id uuid,
  p_name text,
  p_weeks integer,
  p_start_date date,
  p_event_name text,
  p_event_date date,
  p_created_by uuid,
  p_audience text,
  p_group_ids uuid[]
)
  returns uuid
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_cycle_id uuid;
begin
  perform public.assert_training_cycle_audience(p_audience, p_group_ids);
  insert into public.training_cycles
    (club_id, name, weeks, start_date, event_name, event_date, created_by,
     audience)
  values
    (p_club_id, p_name, p_weeks, p_start_date, p_event_name, p_event_date,
     p_created_by, p_audience)
  returning id into v_cycle_id;
  insert into public.training_cycle_groups (cycle_id, group_id, club_id)
  select distinct v_cycle_id, g.id, p_club_id
    from unnest(p_group_ids) as g (id)
   where p_audience = 'groups';
  return v_cycle_id;
end;
$$;

-- Hasta E38 activar archivaba el anterior sin preguntar (D5 de E35). Ahora
-- se confirma (D3): la de dos argumentos se va, y `0085` la recrea en cada
-- reaplicación sólo para que esto la vuelva a quitar.
drop function if exists public.activate_training_cycle(uuid, uuid);

-- Activa el ciclo (D2, D3). Bloquea los ciclos del club, así que dos
-- activaciones a la vez van una tras otra y la segunda ve a la primera.
-- Filas: `missing` si no es del club; sin `p_confirm` y con choque, un
-- `conflict` por cada uno y nada cambia; si no, un `archived` por cada uno
-- que archivó y un `activated`.
create or replace function public.activate_training_cycle(
  p_club_id uuid,
  p_cycle_id uuid,
  p_confirm boolean
)
  returns table (
    outcome text,
    affected_cycle_id uuid,
    affected_cycle_name text
  )
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_name text;
  v_audience text;
  v_group_ids uuid[];
begin
  perform 1
     from public.training_cycles c
    where c.club_id = p_club_id
      for update;
  select c.name, c.audience
    into v_name, v_audience
    from public.training_cycles c
   where c.id = p_cycle_id
     and c.club_id = p_club_id;
  if not found then
    return query select 'missing'::text, null::uuid, null::text;
    return;
  end if;
  select coalesce(array_agg(cg.group_id), '{}')
    into v_group_ids
    from public.training_cycle_groups cg
   where cg.cycle_id = p_cycle_id;

  if not p_confirm then
    return query
      select 'conflict'::text, k.conflict_id, k.conflict_name
        from public.training_cycle_conflicts(
               p_club_id, p_cycle_id, v_audience, v_group_ids) k;
    if found then
      return;
    end if;
  end if;

  return query
    select 'archived'::text, a.archived_id, a.archived_name
      from public.archive_training_cycle_conflicts(
             p_club_id, p_cycle_id, v_audience, v_group_ids) a;
  update public.training_cycles c
     set status = 'active', updated_at = now()
   where c.id = p_cycle_id
     and c.status <> 'active';
  return query select 'activated'::text, p_cycle_id, v_name;
end;
$$;

-- Cambia la audiencia de un ciclo (D1). Si está activo, choca como al
-- activarlo (D3, RF-2): mismas filas, con `saved` en vez de `activated`.
create or replace function public.save_training_cycle_audience(
  p_club_id uuid,
  p_cycle_id uuid,
  p_audience text,
  p_group_ids uuid[],
  p_confirm boolean
)
  returns table (
    outcome text,
    affected_cycle_id uuid,
    affected_cycle_name text
  )
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_name text;
  v_status text;
  v_group_ids uuid[] := case
    when p_audience = 'groups' then p_group_ids
    else '{}'::uuid[]
  end;
begin
  perform public.assert_training_cycle_audience(p_audience, p_group_ids);
  perform 1
     from public.training_cycles c
    where c.club_id = p_club_id
      for update;
  select c.name, c.status
    into v_name, v_status
    from public.training_cycles c
   where c.id = p_cycle_id
     and c.club_id = p_club_id;
  if not found then
    return query select 'missing'::text, null::uuid, null::text;
    return;
  end if;

  if v_status = 'active' then
    if not p_confirm then
      return query
        select 'conflict'::text, k.conflict_id, k.conflict_name
          from public.training_cycle_conflicts(
                 p_club_id, p_cycle_id, p_audience, v_group_ids) k;
      if found then
        return;
      end if;
    end if;
    return query
      select 'archived'::text, a.archived_id, a.archived_name
        from public.archive_training_cycle_conflicts(
               p_club_id, p_cycle_id, p_audience, v_group_ids) a;
  end if;

  update public.training_cycles c
     set audience = p_audience, updated_at = now()
   where c.id = p_cycle_id;
  delete from public.training_cycle_groups cg
   where cg.cycle_id = p_cycle_id
     and cg.group_id <> all (v_group_ids);
  insert into public.training_cycle_groups (cycle_id, group_id, club_id)
  select distinct p_cycle_id, g.id, p_club_id
    from unnest(v_group_ids) as g (id)
  on conflict (cycle_id, group_id) do nothing;
  return query select 'saved'::text, p_cycle_id, v_name;
end;
$$;

-- Como la de `0085`, y además la copia lleva la audiencia y los grupos del
-- original (D8).
create or replace function public.duplicate_training_cycle(
  p_club_id uuid,
  p_cycle_id uuid,
  p_name text,
  p_created_by uuid
)
  returns table (new_cycle_id uuid, routines_copied integer)
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_source public.training_cycles%rowtype;
  v_copy_id uuid;
  v_routine record;
  v_routine_copy_id uuid;
  v_copied integer := 0;
begin
  select *
    into v_source
    from public.training_cycles c
   where c.id = p_cycle_id
     and c.club_id = p_club_id;
  if not found then
    return;
  end if;

  insert into public.training_cycles
    (club_id, name, event_name, event_date, start_date, weeks, status,
     created_by, audience)
  values
    (p_club_id, p_name, v_source.event_name, v_source.event_date,
     v_source.start_date, v_source.weeks, 'draft', p_created_by,
     v_source.audience)
  returning id into v_copy_id;

  insert into public.training_cycle_groups (cycle_id, group_id, club_id)
  select v_copy_id, cg.group_id, cg.club_id
    from public.training_cycle_groups cg
   where cg.cycle_id = p_cycle_id;

  insert into public.training_cycle_weeks
    (club_id, cycle_id, week_no, note, dose_sets, dose_reps,
     dose_intensity_kind, dose_pct, dose_text)
  select w.club_id, v_copy_id, w.week_no, w.note, w.dose_sets, w.dose_reps,
         w.dose_intensity_kind, w.dose_pct, w.dose_text
    from public.training_cycle_weeks w
   where w.cycle_id = p_cycle_id;

  for v_routine in
    select r.id, r.name, r.color_index
      from public.training_routines r
     where r.cycle_id = p_cycle_id
     order by r.created_at, r.id
  loop
    insert into public.training_routines (club_id, cycle_id, name, color_index)
    values (p_club_id, v_copy_id, v_routine.name, v_routine.color_index)
    returning id into v_routine_copy_id;

    insert into public.training_routine_items
      (club_id, routine_id, position, kind, section_title, exercise_id, sets,
       reps, rest, load_kind, load_mark_id, load_pct, load_text, note)
    select i.club_id, v_routine_copy_id, i.position, i.kind, i.section_title,
           i.exercise_id, i.sets, i.reps, i.rest, i.load_kind,
           i.load_mark_id, i.load_pct, i.load_text, i.note
      from public.training_routine_items i
     where i.routine_id = v_routine.id;

    insert into public.training_cycle_days
      (club_id, cycle_id, week_no, weekday, slot, routine_id)
    select d.club_id, v_copy_id, d.week_no, d.weekday, d.slot,
           v_routine_copy_id
      from public.training_cycle_days d
     where d.cycle_id = p_cycle_id
       and d.routine_id = v_routine.id;

    v_copied := v_copied + 1;
  end loop;

  insert into public.training_cycle_days
    (club_id, cycle_id, week_no, weekday, slot, routine_id)
  select d.club_id, v_copy_id, d.week_no, d.weekday, d.slot, d.routine_id
    from public.training_cycle_days d
    join public.training_routines r on r.id = d.routine_id
   where d.cycle_id = p_cycle_id
     and r.cycle_id is null;

  new_cycle_id := v_copy_id;
  routines_copied := v_copied;
  return next;
end;
$$;

-- Ninguna es para una sesión: sólo las llama el servidor.
revoke all on function public.training_cycle_groups_read_active()
  from public, anon, authenticated;
revoke all on function public.training_cycles_sync_group_active()
  from public, anon, authenticated;

revoke all on function public.training_cycle_conflicts(uuid, uuid, text, uuid[])
  from public, anon, authenticated;
grant execute on function public.training_cycle_conflicts(uuid, uuid, text, uuid[])
  to service_role;

revoke all on function public.archive_training_cycle_conflicts(
  uuid, uuid, text, uuid[]
) from public, anon, authenticated;
grant execute on function public.archive_training_cycle_conflicts(
  uuid, uuid, text, uuid[]
) to service_role;

revoke all on function public.assert_training_cycle_audience(text, uuid[])
  from public, anon, authenticated;
grant execute on function public.assert_training_cycle_audience(text, uuid[])
  to service_role;

revoke all on function public.create_training_cycle(
  uuid, text, integer, date, text, date, uuid, text, uuid[]
) from public, anon, authenticated;
grant execute on function public.create_training_cycle(
  uuid, text, integer, date, text, date, uuid, text, uuid[]
) to service_role;

revoke all on function public.activate_training_cycle(uuid, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.activate_training_cycle(uuid, uuid, boolean)
  to service_role;

revoke all on function public.save_training_cycle_audience(
  uuid, uuid, text, uuid[], boolean
) from public, anon, authenticated;
grant execute on function public.save_training_cycle_audience(
  uuid, uuid, text, uuid[], boolean
) to service_role;

revoke all on function public.duplicate_training_cycle(uuid, uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.duplicate_training_cycle(uuid, uuid, text, uuid)
  to service_role;

notify pgrst, 'reload schema';
