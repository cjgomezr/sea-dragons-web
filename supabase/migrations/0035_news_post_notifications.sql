-- El aviso de una publicación nueva (issue #332, RF-7 de
-- `docs/prd/e11-noticias-documentos.md`, FR-061). Añade `news_post_published`
-- al catálogo cerrado de `notifications.type`, como anunciaba
-- `0019_notifications.sql`: cada épica amplía el catálogo con su migración.
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
    'news_post_published'
  ));
