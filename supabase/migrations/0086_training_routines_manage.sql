-- Planificar: las rutinas y sus filas (issue #905, RF-9, D8, D9 y D10 de
-- `docs/prd/e35-entrenamiento.md`). Lo que tiene que ser una sola
-- transacción va aquí: sustituir las filas de una rutina (un fallo a medias
-- la dejaría vacía) y borrarla (que deja sus días en descanso sin una ranura
-- 2 sola). Todo lo llama el servidor con la llave de servicio (D4); ninguna
-- función es para una sesión.
--
-- Producción reaplica el histórico entero en cada merge: todo es
-- `if not exists` o `create or replace`.

-- Cuándo se guardó la fila, para "la última dosis que el club usó" de un
-- ejercicio (RF-9). Guardar sustituye las filas, así que es la fecha de la
-- última vez que se guardó su rutina.
alter table public.training_routine_items
  add column if not exists saved_at timestamptz not null default now();

-- Las rutinas del club con cuántas filas tienen y en cuántos días se usan,
-- en todos los ciclos (RF-9). Un día con la misma rutina en las dos ranuras
-- cuenta una vez. En el orden en que se crearon; el filtro por ciclo lo pone
-- quien llama.
create or replace function public.training_routine_overview(p_club_id uuid)
  returns table (
    id uuid,
    name text,
    cycle_id uuid,
    color_index smallint,
    item_count integer,
    days_used integer
  )
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select r.id, r.name, r.cycle_id, r.color_index,
         (select count(*)::integer
            from public.training_routine_items i
           where i.routine_id = r.id),
         (select count(*)::integer
            from (select distinct d.cycle_id, d.week_no, d.weekday
                    from public.training_cycle_days d
                   where d.routine_id = r.id) used)
    from public.training_routines r
   where r.club_id = p_club_id
   order by r.created_at, r.id
$$;

-- Sustituye las filas de la rutina por `p_items`, en ese orden (RF-9). Cada
-- elemento trae las columnas de una fila; la forma la comprueba la API y la
-- base la vuelve a exigir con sus `check`. Bloquea la rutina para que dos
-- guardados a la vez no mezclen sus filas. Falso si la rutina no es del club.
create or replace function public.replace_training_routine_items(
  p_club_id uuid,
  p_routine_id uuid,
  p_items jsonb
)
  returns boolean
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  perform 1
     from public.training_routines r
    where r.id = p_routine_id
      and r.club_id = p_club_id
      for update;
  if not found then
    return false;
  end if;

  delete from public.training_routine_items i
   where i.routine_id = p_routine_id
     and i.club_id = p_club_id;

  insert into public.training_routine_items
    (club_id, routine_id, position, kind, section_title, exercise_id, sets,
     reps, rest, load_kind, load_mark_id, load_pct, load_text, note)
  select p_club_id, p_routine_id, (item.ordinality - 1)::smallint, x.kind,
         x.section_title, x.exercise_id, x.sets, x.reps, x.rest, x.load_kind,
         x.load_mark_id, x.load_pct, x.load_text, x.note
    from jsonb_array_elements(p_items) with ordinality as item (value, ordinality)
   cross join lateral jsonb_to_record(item.value) as x (
     kind text,
     section_title text,
     exercise_id uuid,
     sets smallint,
     reps text,
     rest text,
     load_kind text,
     load_mark_id uuid,
     load_pct numeric,
     load_text text,
     note text
   );

  update public.training_routines r
     set updated_at = now()
   where r.id = p_routine_id;
  return true;
end;
$$;

-- Borra la rutina si no se usa en la cuadrícula o si `p_confirm` (RF-9). Sus
-- días quedan en descanso (`on delete cascade`), y donde ocupaba la ranura 1
-- de un día con otra en la 2, ésta sube: la ranura 2 nunca queda sola (D7).
-- Bloquea la rutina: un día que la pone a la vez espera por su clave y
-- después no la encuentra. Sin filas si no es del club; con una, si la borró
-- y en cuántos días se usaba.
create or replace function public.delete_training_routine(
  p_club_id uuid,
  p_routine_id uuid,
  p_confirm boolean
)
  returns table (deleted boolean, days_used integer)
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_days integer;
begin
  perform 1
     from public.training_routines r
    where r.id = p_routine_id
      and r.club_id = p_club_id
      for update;
  if not found then
    return;
  end if;

  select count(*)::integer
    into v_days
    from (select distinct d.cycle_id, d.week_no, d.weekday
            from public.training_cycle_days d
           where d.routine_id = p_routine_id) used;

  if v_days > 0 and not p_confirm then
    deleted := false;
    days_used := v_days;
    return next;
    return;
  end if;

  delete from public.training_routines r
   where r.id = p_routine_id;

  update public.training_cycle_days d
     set slot = 1
   where d.club_id = p_club_id
     and d.slot = 2
     and not exists (
       select 1
         from public.training_cycle_days first
        where first.cycle_id = d.cycle_id
          and first.week_no = d.week_no
          and first.weekday = d.weekday
          and first.slot = 1
     );

  deleted := true;
  days_used := v_days;
  return next;
end;
$$;

revoke all on function public.training_routine_overview(uuid)
  from public, anon, authenticated;
grant execute on function public.training_routine_overview(uuid)
  to service_role;

revoke all on function public.replace_training_routine_items(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.replace_training_routine_items(uuid, uuid, jsonb)
  to service_role;

revoke all on function public.delete_training_routine(uuid, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.delete_training_routine(uuid, uuid, boolean)
  to service_role;

notify pgrst, 'reload schema';
