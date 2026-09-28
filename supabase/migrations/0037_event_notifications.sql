-- Los avisos de un evento o una serie nuevos (issue #310, RF-10 de
-- `docs/prd/e7-calendario-eventos-rsvp.md`, FR-037). Añade `event_created` y
-- `event_series_created` al catálogo cerrado de `notifications.type`, como
-- hizo `0035_news_post_notifications.sql` con las noticias.
--
-- El catálogo vive también en `NOTIFICATION_TYPES`
-- (`src/lib/notifications/notify-member.ts`). Cambian juntos: un tipo que sólo
-- esté en la aplicación hace que la base rechace el aviso, y uno que sólo esté
-- aquí no tiene texto que mostrar.
--
-- Sin privilegios nuevos: los avisos los escribe el servidor con la llave de
-- servicio. Idempotente como el resto del histórico.

-- Sólo si la restricción vigente aún no admite el tipo. Sobre una base a la
-- que una migración posterior ya le amplió el catálogo, recrearla con esta
-- lista fallaría por las filas de los tipos que llegaron después: así se
-- rompió la corrida de producción del 28 de septiembre de 2026.
do $$
begin
  if exists (
    select 1
      from pg_constraint
     where conrelid = 'public.notifications'::regclass
       and conname = 'notifications_type_check'
       and pg_get_constraintdef(oid) like '%event_created%'
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
      'event_series_created'
    ));
end
$$;
