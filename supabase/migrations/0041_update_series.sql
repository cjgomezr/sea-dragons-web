-- Editar una serie entera de hoy en adelante (issue #315, RF-12 de
-- `docs/prd/e7-calendario-eventos-rsvp.md`).
--
-- Una edición toca la serie, cada ocurrencia futura y, si cambia la
-- audiencia, sus dos tablas de grupos. Con escrituras sueltas por PostgREST,
-- un fallo a medias dejaría la mitad de la temporada en una piscina y la otra
-- mitad en otra. Aquí va todo en una función, y cualquier error la deshace
-- entera.
--
-- `changes` trae sólo lo que cambia: `title`, `event_type`, `start_time`,
-- `location`, `notes` y `audience` con sus `group_ids`, las mismas claves que
-- `update_event` (`0040`) salvo `starts_on`: los días y las fechas de una
-- serie no se editan. Una clave que no viene deja la columna como estaba;
-- `notes` a `null` sí la vacía. Una audiencia nueva sustituye entera a la
-- anterior, en la serie y en cada ocurrencia que cambia.
--
-- Cambian las ocurrencias programadas que todavía no empezaron según `now()`,
-- incluidas las que se habían editado solas, que reciben lo que trae la
-- edición y conservan lo demás. Las pasadas y las canceladas no se tocan.
-- Las respuestas no se tocan nunca. Si no queda ninguna ocurrencia futura,
-- no escribe nada, ni siquiera la serie, y devuelve 0; si no, devuelve
-- cuántas cambió.
--
-- Validar es cosa del servidor (`src/lib/events/`), igual que al crear; las
-- `check` y las claves compuestas de `0034_events.sql` siguen siendo la
-- última barrera, y una que salte deshace todo lo anterior.
--
-- Si dos organizadores guardan a la vez, el segundo espera al bloqueo de la
-- serie y escribe encima: gana el último, audiencia incluida.
--
-- `security definer` y sólo `service_role`, como `0040`: el servidor ya
-- comprobó que quien llama puede organizar eventos y pasa su club, que sale
-- de su fila de `members` y nunca del cuerpo de la petición.
create or replace function public.update_series(
  acting_club_id uuid,
  target_series_id uuid,
  changes jsonb
)
  returns integer
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  updated_event_ids uuid[];
begin
  -- Serializa las ediciones de una misma serie antes de elegir ocurrencias.
  perform 1
     from public.event_series s
    where s.id = target_series_id
      and s.club_id = acting_club_id
      for update;

  if not found then
    return 0;
  end if;

  with updated as (
    update public.events e
       set title = case when changes ? 'title'
                        then changes ->> 'title' else e.title end,
           event_type = case when changes ? 'event_type'
                             then changes ->> 'event_type'
                             else e.event_type end,
           start_time = case when changes ? 'start_time'
                             then (changes ->> 'start_time')::time
                             else e.start_time end,
           location = case when changes ? 'location'
                           then changes ->> 'location' else e.location end,
           notes = case when changes ? 'notes'
                        then changes ->> 'notes' else e.notes end,
           audience = case when changes ? 'audience'
                           then changes ->> 'audience' else e.audience end
     where e.series_id = target_series_id
       and e.club_id = acting_club_id
       and e.status = 'scheduled'
       and e.starts_at > now()
    returning e.id
  )
  select coalesce(array_agg(id), '{}') into updated_event_ids from updated;

  if cardinality(updated_event_ids) = 0 then
    return 0;
  end if;

  update public.event_series s
     set title = case when changes ? 'title'
                      then changes ->> 'title' else s.title end,
         event_type = case when changes ? 'event_type'
                           then changes ->> 'event_type' else s.event_type end,
         start_time = case when changes ? 'start_time'
                           then (changes ->> 'start_time')::time
                           else s.start_time end,
         location = case when changes ? 'location'
                         then changes ->> 'location' else s.location end,
         notes = case when changes ? 'notes'
                      then changes ->> 'notes' else s.notes end,
         audience = case when changes ? 'audience'
                         then changes ->> 'audience' else s.audience end
   where s.id = target_series_id
     and s.club_id = acting_club_id;

  if changes ? 'audience' then
    delete from public.event_series_groups
     where series_id = target_series_id;
    insert into public.event_series_groups (series_id, group_id, club_id)
    select target_series_id, target.group_id::uuid, acting_club_id
      from jsonb_array_elements_text(
             coalesce(changes -> 'group_ids', '[]'::jsonb)
           ) as target(group_id);

    delete from public.event_groups
     where event_id = any(updated_event_ids);
    insert into public.event_groups (event_id, group_id, club_id)
    select occurrence.id, target.group_id::uuid, acting_club_id
      from unnest(updated_event_ids) as occurrence(id)
     cross join jsonb_array_elements_text(
             coalesce(changes -> 'group_ids', '[]'::jsonb)
           ) as target(group_id);
  end if;

  return cardinality(updated_event_ids);
end;
$$;

-- Como `update_event`: Postgres concede `execute` a PUBLIC en toda función
-- nueva, y el `pg_default_acl` de Supabase además a `anon` y `authenticated`.
-- Abierta a ellos, cualquier socio podría cambiar el calendario llamándola
-- por PostgREST.
revoke all on function public.update_series(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.update_series(uuid, uuid, jsonb)
  to service_role;

-- Como en `0008_sonda_salud.sql`: que PostgREST vea la función en cuanto se
-- aplica, aunque faltara el event trigger que recarga su caché.
notify pgrst, 'reload schema';
