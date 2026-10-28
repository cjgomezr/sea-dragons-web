-- Planificar: las marcas del club y los ejercicios del club (issue #903,
-- RF-10, RF-11, D11 y D13 de `docs/prd/e35-entrenamiento.md`). Todo lo llama
-- el servidor con la llave de servicio (D4); ninguna función es para una
-- sesión.
--
-- Producción reaplica el histórico entero en cada merge: todo es
-- `if not exists` o `create or replace`.

-- El nombre de una marca no se repite sin contar mayúsculas ni acentos
-- ("Sentadilla" y "sentadílla"), como el de un ejercicio (`0083`). La clave
-- exacta de `0083` se queda: ésta la incluye.
alter table public.training_marks
  add column if not exists name_normalized text
    generated always as (public.search_normalize(btrim(name))) stored;

create unique index if not exists training_marks_club_id_name_normalized_key
  on public.training_marks (club_id, name_normalized);

-- Cuántas filas de rutina usan cada marca del club y cuántos socios la
-- registraron (D11). Sólo números: ni valores ni quiénes. `security definer`
-- como dice `DATA_MODEL.md`, aunque hoy sólo la llama la llave de servicio.
create or replace function public.training_mark_usage(p_club_id uuid)
  returns table (mark_id uuid, routine_rows integer, members integer)
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select m.id,
         (select count(*)::integer
            from public.training_routine_items i
           where i.load_mark_id = m.id),
         (select count(*)::integer
            from public.training_member_marks v
           where v.mark_id = m.id)
    from public.training_marks m
   where m.club_id = p_club_id
$$;

-- Los ejercicios de la biblioteca y los del club cuyo nombre contiene
-- `p_text`, sin mayúsculas ni acentos (`0049`). Primero los que empiezan por
-- él, después por nombre. El orden y el tope van dentro: PostgREST no ordena
-- por una expresión.
create or replace function public.search_training_exercises(
  p_club_id uuid,
  p_text text,
  p_limit integer
)
  returns setof public.training_exercises
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select e.*
    from public.training_exercises e
   where (e.club_id is null or e.club_id = p_club_id)
     and e.name_normalized like public.search_like_pattern(btrim(p_text))
   order by e.name_normalized
              like public.search_normalize(btrim(p_text)) || '%' desc,
            e.name_normalized,
            e.id
   limit p_limit
$$;

-- Si otro ejercicio de la biblioteca o del club ya se llama así (D13). El
-- índice de `0083` sólo ve un ámbito; ésta ve los dos. `p_except_id` es el
-- que se está renombrando.
create or replace function public.training_exercise_name_taken(
  p_club_id uuid,
  p_name text,
  p_except_id uuid
)
  returns boolean
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select exists (
    select 1
      from public.training_exercises e
     where (e.club_id is null or e.club_id = p_club_id)
       and e.name_normalized = public.search_normalize(btrim(p_name))
       and e.id is distinct from p_except_id
  )
$$;

revoke all on function public.training_mark_usage(uuid)
  from public, anon, authenticated;
grant execute on function public.training_mark_usage(uuid) to service_role;

revoke all on function public.search_training_exercises(uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.search_training_exercises(uuid, text, integer)
  to service_role;

revoke all on function public.training_exercise_name_taken(uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.training_exercise_name_taken(uuid, text, uuid)
  to service_role;

notify pgrst, 'reload schema';
