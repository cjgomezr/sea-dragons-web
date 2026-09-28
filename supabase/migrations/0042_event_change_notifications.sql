-- Los avisos de un evento, una ocurrencia o una serie que cambian de fecha,
-- hora o lugar, o que se cancelan (issue #317, RF-13 de
-- `docs/prd/e7-calendario-eventos-rsvp.md`). Añade `event_changed`,
-- `event_cancelled`, `event_series_changed` y `event_series_cancelled` al
-- catálogo cerrado de `notifications.type`, como hizo
-- `0037_event_notifications.sql` con los eventos nuevos.
--
-- El catálogo vive también en `NOTIFICATION_TYPES`
-- (`src/lib/notifications/notify-member.ts`). Cambian juntos: un tipo que sólo
-- esté en la aplicación hace que la base rechace el aviso, y uno que sólo esté
-- aquí no tiene texto que mostrar.
--
-- Sin privilegios nuevos: los avisos los escribe el servidor con la llave de
-- servicio. Idempotente como el resto del histórico.

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
    'event_series_cancelled'
  ));
