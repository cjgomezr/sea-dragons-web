-- El porcentaje de asistencia de cada miembro y la tasa del club, contados
-- por la base (issue #394, RF-5 y RF-7 de `docs/prd/e8-asistencia.md`).
--
-- FR-042: `(present + late) / sesiones elegibles`, redondeado al entero. Una
-- sesión es elegible para un miembro si es un entrenamiento no cancelado, con
-- hoja guardada (al menos una fila en `attendance_records`, D3), con el
-- miembro en su audiencia y del día de su alta en adelante (B4). Sin sesiones
-- elegibles no hay porcentaje: el null es "sin datos" (AC-017b), nunca 0.
--
-- La audiencia es la de hoy, la misma regla de `live_event_rsvps` (`0039`):
-- `all`, o uno de sus grupos. La pertenencia se une aquí en vez de llamar a
-- `is_member_in_groups` por cada par de miembro y sesión, para que 500
-- miembros y 50.000 filas (NFR-008) sigan siendo una consulta de conjuntos.
-- Tampoco filtra por estado de la cuenta: el Admin sigue viendo el historial
-- de quien se dio de baja.
--
-- El redondeo va sobre `numeric`, que es exacto: 49 de 200 da 24,5 y `round`
-- lo sube a 25, la misma regla que el OVR de E9 (`Math.round`).

create or replace function public.attendance_stats(
  p_club_id uuid,
  p_user_ids uuid[]
)
  returns table (
    user_id uuid,
    eligible_sessions integer,
    attended_sessions integer,
    attendance_percent integer
  )
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  with sheets as (
    select e.id, e.starts_on, e.audience
      from public.events e
     where e.club_id = p_club_id
       and e.event_type = 'training'
       and e.status = 'scheduled'
       and exists (
         select 1 from public.attendance_records ar where ar.event_id = e.id
       )
  ),
  eligible as (
    select m.user_id, s.id as event_id
      from public.members m
      join sheets s on s.starts_on >= m.joined_on
     where m.club_id = p_club_id
       and m.user_id = any (p_user_ids)
       and (
         s.audience = 'all'
         or exists (
           select 1
             from public.event_groups eg
             join public.group_memberships gm on gm.group_id = eg.group_id
            where eg.event_id = s.id
              and gm.user_id = m.user_id
         )
       )
  ),
  counted as (
    select m.user_id,
           count(el.event_id)::integer as eligible_sessions,
           (count(*) filter (
             where ar.status in ('present', 'late')
           ))::integer as attended_sessions
      from public.members m
      left join eligible el on el.user_id = m.user_id
      left join public.attendance_records ar
        on ar.event_id = el.event_id and ar.user_id = el.user_id
     where m.club_id = p_club_id
       and m.user_id = any (p_user_ids)
     group by m.user_id
  )
  select c.user_id,
         c.eligible_sessions,
         c.attended_sessions,
         case
           when c.eligible_sessions = 0 then null
           else round(c.attended_sessions * 100.0 / c.eligible_sessions)::integer
         end
    from counted c
$$;

-- RF-7, para la tesela de E14 (FR-076): todas las filas de los entrenamientos
-- no cancelados desde `p_since`. Sin ninguna fila, sin porcentaje. El día lo
-- pone el servidor en la hora del club (NFR-003).
create or replace function public.club_attendance_rate(
  p_club_id uuid,
  p_since date
)
  returns table (
    total_records integer,
    attended_records integer,
    attendance_percent integer
  )
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  with counted as (
    select count(*)::integer as total_records,
           (count(*) filter (
             where ar.status in ('present', 'late')
           ))::integer as attended_records
      from public.attendance_records ar
      join public.events e on e.id = ar.event_id
     where ar.club_id = p_club_id
       and e.status = 'scheduled'
       and e.starts_on >= p_since
  )
  select c.total_records,
         c.attended_records,
         case
           when c.total_records = 0 then null
           else round(c.attended_records * 100.0 / c.total_records)::integer
         end
    from counted c
$$;

-- Los sirve el servidor, que ya decidió quién pregunta y de qué club, como
-- `event_rsvp_tallies` (`0039`).
revoke all on function public.attendance_stats(uuid, uuid[])
  from public, anon, authenticated;
grant execute on function public.attendance_stats(uuid, uuid[])
  to service_role;

revoke all on function public.club_attendance_rate(uuid, date)
  from public, anon, authenticated;
grant execute on function public.club_attendance_rate(uuid, date)
  to service_role;

notify pgrst, 'reload schema';
