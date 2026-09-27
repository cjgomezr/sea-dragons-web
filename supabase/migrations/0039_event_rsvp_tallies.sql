-- Quién va y quién quizás a cada evento, contado por la base (issue #309,
-- RF-6 de `docs/prd/e7-calendario-eventos-rsvp.md`, FR-036).
--
-- Una respuesta guardada no basta para contar: quien respondió y después
-- salió de la audiencia, o fue dado de baja, ya no cuenta ni aparece, y un
-- evento cancelado no cuenta a nadie. La audiencia se resuelve al leer con
-- `is_member_in_groups`, la misma regla que la policy de `events`
-- (`0034_events.sql`), para que "quién ve el evento" y "quién cuenta en él"
-- no puedan separarse.
--
-- La agenda pide los conteos de 50 eventos a la vez. Por eso reciben una
-- lista de eventos y no uno: una sola llamada por página, no una por fila.

create or replace function public.live_event_rsvps(p_event_ids uuid[])
  returns table (
    event_id uuid,
    user_id uuid,
    full_name text,
    response text
  )
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select r.event_id, r.user_id, m.full_name, r.response
    from public.event_rsvps r
    join public.events e on e.id = r.event_id
    join public.members m
      on m.user_id = r.user_id and m.club_id = r.club_id
   where r.event_id = any (p_event_ids)
     and r.response in ('yes', 'maybe')
     and e.status = 'scheduled'
     and m.account_status <> 'inactive'
     and (
       e.audience = 'all'
       or public.is_member_in_groups(
         r.user_id,
         array(
           select eg.group_id
             from public.event_groups eg
            where eg.event_id = e.id
         )
       )
     )
$$;

-- Sólo los eventos con alguna respuesta que cuenta: los demás van a cero.
create or replace function public.event_rsvp_tallies(p_event_ids uuid[])
  returns table (
    event_id uuid,
    going_count integer,
    maybe_count integer
  )
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select live.event_id,
         (count(*) filter (where live.response = 'yes'))::integer,
         (count(*) filter (where live.response = 'maybe'))::integer
    from public.live_event_rsvps(p_event_ids) live
   group by live.event_id
$$;

-- Los nombres de quién va los sirve el servidor a quien puede ver el evento,
-- que es una regla de rol y de audiencia que decide la API. Un miembro con su
-- sesión no las llama: con `security invoker` sólo vería sus respuestas, pero
-- tampoco las necesita.
revoke all on function public.live_event_rsvps(uuid[])
  from public, anon, authenticated;
grant execute on function public.live_event_rsvps(uuid[]) to service_role;

revoke all on function public.event_rsvp_tallies(uuid[])
  from public, anon, authenticated;
grant execute on function public.event_rsvp_tallies(uuid[]) to service_role;

notify pgrst, 'reload schema';
