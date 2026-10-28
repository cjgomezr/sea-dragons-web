-- Planificar: los ciclos y su cuadrícula (issue #904, RF-7, RF-8 y D5 a D8 de
-- `docs/prd/e35-entrenamiento.md`). Lo que tiene que ser una sola
-- transacción va aquí: activar (que archiva el anterior), cambiar (que quita
-- las semanas que sobran), duplicar (que copia y reapunta), poner o quitar
-- una rutina de un día (que corre la ranura 2) y copiar la semana 1. Todo lo llama el servidor con la llave de servicio
-- (D4); ninguna función es para una sesión.
--
-- Producción reaplica el histórico entero en cada merge: todo es
-- `create or replace`.

-- Activa el ciclo y archiva el que lo era (D5). Bloquea los ciclos del club
-- para que dos activaciones a la vez no choquen con el índice de un solo
-- activo: la segunda espera y archiva a la primera. Sin filas si el ciclo no
-- es del club; con una, el que archivó o nulo.
create or replace function public.activate_training_cycle(
  p_club_id uuid,
  p_cycle_id uuid
)
  returns table (archived_cycle_id uuid)
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_previous uuid;
begin
  perform 1
     from public.training_cycles c
    where c.club_id = p_club_id
      for update;
  if not exists (
    select 1
      from public.training_cycles c
     where c.id = p_cycle_id
       and c.club_id = p_club_id
  ) then
    return;
  end if;
  update public.training_cycles c
     set status = 'archived', updated_at = now()
   where c.club_id = p_club_id
     and c.status = 'active'
     and c.id <> p_cycle_id
  returning c.id into v_previous;
  update public.training_cycles c
     set status = 'active', updated_at = now()
   where c.id = p_cycle_id
     and c.status <> 'active';
  archived_cycle_id := v_previous;
  return next;
end;
$$;

-- Cambia el ciclo y quita los días y las semanas que pasen de `p_weeks`
-- (RF-7), todo junto: si no, un fallo a medias dejaría filas escondidas que
-- volverían al subir las semanas. Bloquea el ciclo para que un día puesto a
-- la vez no quede más allá de la última semana. Sin filas si el ciclo no es
-- del club; con una, cuántos días con rutina se quitaron.
create or replace function public.update_training_cycle(
  p_club_id uuid,
  p_cycle_id uuid,
  p_name text,
  p_weeks integer,
  p_start_date date,
  p_event_name text,
  p_event_date date
)
  returns table (days_removed integer)
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  perform 1
     from public.training_cycles c
    where c.id = p_cycle_id
      and c.club_id = p_club_id
      for update;
  if not found then
    return;
  end if;
  select count(distinct (d.week_no, d.weekday))::integer
    into days_removed
    from public.training_cycle_days d
   where d.cycle_id = p_cycle_id
     and d.week_no > p_weeks;
  update public.training_cycles c
     set name = p_name,
         weeks = p_weeks,
         start_date = p_start_date,
         event_name = p_event_name,
         event_date = p_event_date,
         updated_at = now()
   where c.id = p_cycle_id;
  delete from public.training_cycle_days d
   where d.cycle_id = p_cycle_id
     and d.week_no > p_weeks;
  delete from public.training_cycle_weeks w
   where w.cycle_id = p_cycle_id
     and w.week_no > p_weeks;
  return next;
end;
$$;

-- Un borrador nuevo con lo del ciclo (RF-7): sus semanas con nota y dosis,
-- una copia de cada rutina propia con sus filas, y la cuadrícula apuntando a
-- las copias. Las compartidas no se copian: sus días las siguen nombrando
-- (D8). El nombre lo pone la API. Sin filas si el ciclo no es del club.
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
     created_by)
  values
    (p_club_id, p_name, v_source.event_name, v_source.event_date,
     v_source.start_date, v_source.weeks, 'draft', p_created_by)
  returning id into v_copy_id;

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

-- Pone una rutina en una ranura de un día, o la quita con `p_routine_id`
-- nulo (D7). La ranura 2 nunca queda sola: pedirla en un día vacío llena la
-- 1, y vaciar la 1 sube la 2. Que la rutina sea del ciclo o compartida lo
-- comprueba la API.
create or replace function public.set_training_cycle_day(
  p_club_id uuid,
  p_cycle_id uuid,
  p_week_no integer,
  p_weekday integer,
  p_slot integer,
  p_routine_id uuid
)
  returns void
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_slot integer := p_slot;
begin
  if p_routine_id is null then
    delete from public.training_cycle_days d
     where d.club_id = p_club_id
       and d.cycle_id = p_cycle_id
       and d.week_no = p_week_no
       and d.weekday = p_weekday
       and d.slot = p_slot;
    if p_slot = 1 then
      update public.training_cycle_days d
         set slot = 1
       where d.club_id = p_club_id
         and d.cycle_id = p_cycle_id
         and d.week_no = p_week_no
         and d.weekday = p_weekday
         and d.slot = 2;
    end if;
    return;
  end if;

  if p_slot = 2 and not exists (
    select 1
      from public.training_cycle_days d
     where d.club_id = p_club_id
       and d.cycle_id = p_cycle_id
       and d.week_no = p_week_no
       and d.weekday = p_weekday
       and d.slot = 1
  ) then
    v_slot := 1;
  end if;

  insert into public.training_cycle_days
    (club_id, cycle_id, week_no, weekday, slot, routine_id)
  values (p_club_id, p_cycle_id, p_week_no, p_weekday, v_slot, p_routine_id)
  on conflict (cycle_id, week_no, weekday, slot)
    do update set routine_id = excluded.routine_id;
end;
$$;

-- Copia los días de la semana 1 a `p_target_weeks` (RF-8): lo que hubiera
-- en esas semanas se va. Qué semanas son lo decide la API.
create or replace function public.copy_training_cycle_week_one(
  p_club_id uuid,
  p_cycle_id uuid,
  p_target_weeks integer[]
)
  returns void
  language sql
  security invoker
  set search_path = ''
as $$
  delete from public.training_cycle_days d
   where d.club_id = p_club_id
     and d.cycle_id = p_cycle_id
     and d.week_no = any (p_target_weeks);

  insert into public.training_cycle_days
    (club_id, cycle_id, week_no, weekday, slot, routine_id)
  select d.club_id, d.cycle_id, target.week_no, d.weekday, d.slot,
         d.routine_id
    from public.training_cycle_days d
   cross join unnest(p_target_weeks) as target (week_no)
   where d.club_id = p_club_id
     and d.cycle_id = p_cycle_id
     and d.week_no = 1;
$$;

revoke all on function public.activate_training_cycle(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.activate_training_cycle(uuid, uuid)
  to service_role;

revoke all on function public.update_training_cycle(
  uuid, uuid, text, integer, date, text, date
) from public, anon, authenticated;
grant execute on function public.update_training_cycle(
  uuid, uuid, text, integer, date, text, date
) to service_role;

revoke all on function public.duplicate_training_cycle(uuid, uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.duplicate_training_cycle(uuid, uuid, text, uuid)
  to service_role;

revoke all on function public.set_training_cycle_day(
  uuid, uuid, integer, integer, integer, uuid
) from public, anon, authenticated;
grant execute on function public.set_training_cycle_day(
  uuid, uuid, integer, integer, integer, uuid
) to service_role;

revoke all on function public.copy_training_cycle_week_one(uuid, uuid, integer[])
  from public, anon, authenticated;
grant execute on function public.copy_training_cycle_week_one(uuid, uuid, integer[])
  to service_role;

notify pgrst, 'reload schema';
