-- Las dos lecturas nuevas del inicio (issue #746, RF-2, D9 y D13 de
-- `docs/prd/e27-rediseno-inicio.md`).
--
-- `member_attendance_sessions`: las sesiones elegibles de un socio, con la
-- regla de `attendance_stats` (`0045`): entrenamiento no cancelado, con hoja
-- guardada, con el socio en su audiencia y del día de su alta en adelante.
-- Quien no tiene fila en una hoja guardada cuenta como ausente, igual que
-- allí. Devuelve las de la temporada (`p_since` a `p_until`) y, además, las
-- `p_recent` más recientes hasta `p_until` aunque sean de antes: con eso el
-- servidor saca el porcentaje de la temporada y las "Últimas 10" de una sola
-- llamada. El tope de arriba deja fuera la hoja de un entrenamiento que se
-- movió a una fecha futura después de pasar lista, como en
-- `club_attendance_rate`.
--
-- `event_unanswered_count`: cuántos socios activos de la audiencia de un
-- evento no le han respondido nada. "No puedo" es una respuesta. La
-- audiencia es la de hoy, con la misma regla que `live_event_rsvps` (`0039`).
--
-- Las dos reciben el club y sólo miran dentro de él (NFR-009): un socio o un
-- evento de otro club no devuelven nada.

create or replace function public.member_attendance_sessions(
  p_club_id uuid,
  p_user_id uuid,
  p_since date,
  p_until date,
  p_recent integer
)
  returns table (
    event_id uuid,
    starts_on date,
    status text
  )
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  with eligible as (
    select e.id,
           e.starts_on,
           e.start_time,
           coalesce(own.status, 'absent') as status
      from public.members m
      join public.events e
        on e.club_id = m.club_id
       and e.starts_on >= m.joined_on
       and e.starts_on <= p_until
      left join public.attendance_records own
        on own.event_id = e.id and own.user_id = m.user_id
     where m.club_id = p_club_id
       and m.user_id = p_user_id
       and e.event_type = 'training'
       and e.status = 'scheduled'
       and exists (
         select 1 from public.attendance_records ar where ar.event_id = e.id
       )
       and (
         e.audience = 'all'
         or exists (
           select 1
             from public.event_groups eg
             join public.group_memberships gm on gm.group_id = eg.group_id
            where eg.event_id = e.id
              and gm.user_id = m.user_id
         )
       )
  ),
  ranked as (
    select el.*,
           row_number() over (
             order by el.starts_on desc, el.start_time desc, el.id desc
           ) as recency
      from eligible el
  )
  select r.id, r.starts_on, r.status
    from ranked r
   where r.starts_on >= p_since
      or r.recency <= p_recent
   order by r.starts_on, r.start_time, r.id
$$;

create or replace function public.event_unanswered_count(
  p_club_id uuid,
  p_event_id uuid
)
  returns integer
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select count(*)::integer
    from public.events e
    join public.members m on m.club_id = e.club_id
   where e.id = p_event_id
     and e.club_id = p_club_id
     and m.account_status = 'active'
     and (
       e.audience = 'all'
       or public.is_member_in_groups(
         m.user_id,
         array(
           select eg.group_id
             from public.event_groups eg
            where eg.event_id = e.id
         )
       )
     )
     and not exists (
       select 1
         from public.event_rsvps r
        where r.event_id = e.id
          and r.user_id = m.user_id
     )
$$;

-- Las sirve el servidor, que ya decidió quién pregunta y de qué club, como
-- `attendance_stats` (`0045`).
revoke all on function public.member_attendance_sessions(
  uuid, uuid, date, date, integer
) from public, anon, authenticated;
grant execute on function public.member_attendance_sessions(
  uuid, uuid, date, date, integer
) to service_role;

revoke all on function public.event_unanswered_count(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.event_unanswered_count(uuid, uuid)
  to service_role;

notify pgrst, 'reload schema';
