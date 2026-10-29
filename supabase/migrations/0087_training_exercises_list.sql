-- Planificar → Ejercicios (issue #910, RF-10 de
-- `docs/prd/e35-entrenamiento.md`): la lista de ejercicios por páginas, de
-- la biblioteca, del club o de los dos, y cuántos hay de cada origen. La
-- biblioteca son unos 800 (D12): no se pinta entera de golpe.
--
-- `list_training_exercises` es también la búsqueda de las rutinas, con el
-- mismo orden que tenía `search_training_exercises` de `0084`: primero los
-- que empiezan por el texto. Por eso aquélla se borra. Las dos las llama el
-- servidor con la llave de servicio (D4); ninguna es para una sesión.
--
-- Producción reaplica el histórico entero en cada merge: todo es
-- `create or replace` o `if exists`.

-- `p_source` nulo son los dos orígenes; si no, 'library' o 'club'.
create or replace function public.list_training_exercises(
  p_club_id uuid,
  p_text text,
  p_source text,
  p_limit integer,
  p_offset integer
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
     and (p_source is null or e.source = p_source)
     and e.name_normalized like public.search_like_pattern(btrim(p_text))
   order by starts_with(e.name_normalized,
                        public.search_normalize(btrim(p_text))) desc,
            e.name_normalized,
            e.id
   limit p_limit
  offset p_offset
$$;

-- Las cifras de las fichas All · Library · Club's own, con el mismo texto
-- que la lista.
create or replace function public.count_training_exercises(
  p_club_id uuid,
  p_text text
)
  returns table (library bigint, club bigint)
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select count(*) filter (where e.club_id is null),
         count(*) filter (where e.club_id is not null)
    from public.training_exercises e
   where (e.club_id is null or e.club_id = p_club_id)
     and e.name_normalized like public.search_like_pattern(btrim(p_text))
$$;

drop function if exists public.search_training_exercises(uuid, text, integer);

revoke all on function
  public.list_training_exercises(uuid, text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function
  public.list_training_exercises(uuid, text, text, integer, integer)
  to service_role;

revoke all on function public.count_training_exercises(uuid, text)
  from public, anon, authenticated;
grant execute on function public.count_training_exercises(uuid, text)
  to service_role;

notify pgrst, 'reload schema';
