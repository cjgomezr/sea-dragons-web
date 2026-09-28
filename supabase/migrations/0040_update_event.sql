-- Editar un evento suelto o una sola ocurrencia de una serie (issue #314,
-- RF-11 de `docs/prd/e7-calendario-eventos-rsvp.md`).
--
-- Cambiar la audiencia toca el evento y `event_groups` a la vez. Hecho con
-- escrituras sueltas por PostgREST, un fallo a medias dejaría un evento para
-- grupos sin ningún grupo. Aquí va todo en una función, y cualquier error la
-- deshace entera.
--
-- `changes` trae sólo lo que cambia: `title`, `event_type`, `starts_on`,
-- `start_time`, `location`, `notes` y `audience` con sus `group_ids`. Una
-- clave que no viene deja la columna como estaba; `notes` a `null` sí la
-- vacía. Una audiencia nueva sustituye entera a la anterior.
--
-- Validar es cosa del servidor (`src/lib/events/`), igual que al crear; las
-- `check` y las claves compuestas de `0034_events.sql` siguen siendo la
-- última barrera. La función sólo se niega a tocar un evento cancelado o que
-- ya empezó, por si pasó entre que el servidor lo leyó y lo escribe: en ese
-- caso devuelve `false` y no escribe nada.
--
-- Si dos organizadores guardan a la vez, el segundo espera al bloqueo de la
-- fila y escribe encima: gana el último, audiencia incluida.
--
-- `security definer` y sólo `service_role`, como `0036`: el servidor ya
-- comprobó que quien llama puede organizar eventos y pasa su club, que sale
-- de su fila de `members` y nunca del cuerpo de la petición.
create or replace function public.update_event(
  acting_club_id uuid,
  target_event_id uuid,
  changes jsonb
)
  returns boolean
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
begin
  update public.events e
     set title = case when changes ? 'title'
                      then changes ->> 'title' else e.title end,
         event_type = case when changes ? 'event_type'
                           then changes ->> 'event_type' else e.event_type end,
         starts_on = case when changes ? 'starts_on'
                          then (changes ->> 'starts_on')::date
                          else e.starts_on end,
         start_time = case when changes ? 'start_time'
                           then (changes ->> 'start_time')::time
                           else e.start_time end,
         location = case when changes ? 'location'
                         then changes ->> 'location' else e.location end,
         notes = case when changes ? 'notes'
                      then changes ->> 'notes' else e.notes end,
         audience = case when changes ? 'audience'
                         then changes ->> 'audience' else e.audience end
   where e.id = target_event_id
     and e.club_id = acting_club_id
     and e.status = 'scheduled'
     and e.starts_at > now();

  if not found then
    return false;
  end if;

  if changes ? 'audience' then
    delete from public.event_groups where event_id = target_event_id;
    insert into public.event_groups (event_id, group_id, club_id)
    select target_event_id, group_id::uuid, acting_club_id
      from jsonb_array_elements_text(
             coalesce(changes -> 'group_ids', '[]'::jsonb)
           ) as target(group_id);
  end if;

  return true;
end;
$$;

-- Como `create_events`: Postgres concede `execute` a PUBLIC en toda función
-- nueva, y el `pg_default_acl` de Supabase además a `anon` y `authenticated`.
-- Abierta a ellos, cualquier socio podría cambiar el calendario llamándola
-- por PostgREST.
revoke all on function public.update_event(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.update_event(uuid, uuid, jsonb)
  to service_role;

-- Como en `0008_sonda_salud.sql`: que PostgREST vea la función en cuanto se
-- aplica, aunque faltara el event trigger que recarga su caché.
notify pgrst, 'reload schema';
