-- El aviso de renovación (issue #470, RF-8 de `docs/prd/e13-stripe-avanzado.md`,
-- D3): siete días antes de cada cobro, el webhook de Stripe deja en la
-- campana un `membership_renewal_upcoming` con el importe, el día y la
-- tarjeta. El catálogo vive también en `NOTIFICATION_TYPES`
-- (`src/lib/notifications/notify-member.ts`) y cambian juntos.
--
-- Producción reaplica el histórico entero en cada merge: si la restricción
-- vigente ya admite el tipo, no se toca, por lo que cuenta
-- `0042_event_change_notifications.sql`. Una migración posterior que añada
-- otro tipo tiene que guardarse igual, buscando el suyo.
do $$
begin
  if exists (
    select 1
      from pg_constraint
     where conrelid = 'public.notifications'::regclass
       and conname = 'notifications_type_check'
       and strpos(pg_get_constraintdef(oid),
                  '''membership_renewal_upcoming''') > 0
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
      'membership_renewal_upcoming'
    ));
end
$$;
