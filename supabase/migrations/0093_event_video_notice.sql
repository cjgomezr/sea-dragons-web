-- El aviso del vídeo de una sesión (#966, RF-6, D9 y D10 del PRD de E37).
-- Cuando una sesión pasa de no tener vídeo a tenerlo, su audiencia recibe un
-- aviso en la campana; cambiar el enlace no avisa.

-- Guarda el vídeo y devuelve si la sesión no tenía, decidido en la misma
-- sentencia que escribe. El `for update` del CTE bloquea la fila: si dos
-- personas ponen vídeo a la vez, la segunda espera a que la primera
-- confirme, relee la fila ya con vídeo y devuelve `false`. Así hay como mucho
-- un aviso por socio. Leer antes y escribir después daría `true` a las dos.
--
-- Devuelve `null` si el evento no es de ese club. Quién puede ponerlo y qué
-- enlace vale lo decide `src/lib/events/session-video.ts` antes de llamar.
create or replace function public.set_event_video(
  p_club_id uuid,
  p_event_id uuid,
  p_url text
)
  returns boolean
  language sql
  security invoker
  set search_path = ''
as $$
  with previous as (
    select e.id, e.video_url
      from public.events e
     where e.club_id = p_club_id
       and e.id = p_event_id
       for update
  )
  update public.events e
     set video_url = p_url
    from previous
   where e.id = previous.id
  returning previous.video_url is null;
$$;

revoke all on function public.set_event_video(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.set_event_video(uuid, uuid, text)
  to service_role;

-- El tipo nuevo `event_video_added`. El catálogo vive también en
-- `NOTIFICATION_TYPES` (`src/lib/notifications/notify-member.ts`) y cambian
-- juntos. Sólo si la restricción vigente aún no lo admite, por lo que cuenta
-- `0054_membership_renewal_notifications.sql`.
do $$
begin
  if exists (
    select 1
      from pg_constraint
     where conrelid = 'public.notifications'::regclass
       and conname = 'notifications_type_check'
       and strpos(pg_get_constraintdef(oid), '''event_video_added''') > 0
  ) then
    return;
  end if;
  alter table public.notifications
    drop constraint if exists notifications_type_check;
  alter table public.notifications
    add constraint notifications_type_check check (type in (
      'role_changed',
      'role_request_rejected',
      'role_request_received',
      'news_post_published',
      'event_created',
      'event_series_created',
      'event_changed',
      'event_cancelled',
      'event_series_changed',
      'event_series_cancelled',
      'team_assigned',
      'team_unassigned',
      'membership_renewal_upcoming',
      'team_player_dropped',
      'team_player_returned',
      'event_video_added'
    ));
end
$$;

-- Que PostgREST vea la función en cuanto se aplica.
notify pgrst, 'reload schema';
