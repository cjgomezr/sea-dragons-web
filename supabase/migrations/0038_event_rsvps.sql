-- Las respuestas de cada miembro a cada evento (issue #308, RF-5 de
-- `docs/prd/e7-calendario-eventos-rsvp.md`, FR-034 y FR-035). Una fila por
-- miembro y ocurrencia: cambiar de "Quizás" a "Sí" reescribe la misma fila, y
-- dos toques a la vez no pueden dejar dos.
--
-- Quién puede responder (la audiencia, el evento sin empezar ni cancelado) lo
-- decide el servidor antes de escribir, con la llave de servicio: esa regla
-- depende de la hora y de los grupos, y aquí sólo se guarda lo que ya pasó
-- por ella. Lo que la base sí afirma sola es la forma: el valor, el club y
-- las cascadas.
create table if not exists public.event_rsvps (
  event_id uuid not null,
  user_id uuid not null,
  club_id uuid not null references public.clubs (id),
  response text not null
    constraint event_rsvps_response_check
    check (response in ('yes', 'maybe', 'no')),
  -- La hora de la última respuesta, no la de la primera.
  responded_at timestamptz not null default now(),
  constraint event_rsvps_pkey primary key (event_id, user_id),
  -- Como en `event_groups`: el `club_id` redundante, atado al del evento y al
  -- del miembro, impide responder a un evento de otro club sin un trigger.
  -- Borrar el evento o la identidad (que borra al socio) se lleva la fila.
  constraint event_rsvps_event_same_club_fkey
    foreign key (event_id, club_id)
    references public.events (id, club_id) on delete cascade,
  constraint event_rsvps_member_same_club_fkey
    foreign key (user_id, club_id)
    references public.members (user_id, club_id) on delete cascade
);

-- Las respuestas de un miembro, para la cascada de su fila de `members`.
create index if not exists event_rsvps_user_id_club_id_idx
  on public.event_rsvps (user_id, club_id);

alter table public.event_rsvps enable row level security;

-- Cada miembro ve sólo sus respuestas. Los conteos y los nombres de quién va
-- (#309) los sirve el servidor, que filtra por la audiencia viva del evento.
drop policy if exists event_rsvps_select_own on public.event_rsvps;
create policy event_rsvps_select_own
  on public.event_rsvps
  for select
  to authenticated
  using (user_id = (select auth.uid()));

-- Revocar primero, como en `0034_events.sql`: el proyecto concede todo a
-- `anon` y `authenticated` sobre cada tabla nueva. Responder pasa por el
-- servidor, que comprueba la audiencia y la hora.
revoke all on public.event_rsvps from anon, authenticated;
grant select on public.event_rsvps to authenticated;
grant select, insert, update, delete on public.event_rsvps to service_role;

notify pgrst, 'reload schema';
