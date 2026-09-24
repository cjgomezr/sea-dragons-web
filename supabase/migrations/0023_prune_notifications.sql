-- La limpieza de avisos (#339, apéndice de `docs/prd/e6-notificaciones.md`).
-- Hasta aquí no se borraba ningún aviso: la lista enseña los 50 más recientes
-- y el resto crecía para siempre, con nombres de personas dentro.
--
-- La política, con sus dos números decididos en el ticket:
--   - un aviso leído caduca a los 90 días de creado;
--   - nadie guarda más de 200 avisos: pasado el tope se borran los leídos,
--     empezando por el más viejo.
-- Un aviso sin leer no se borra nunca, por viejo que sea ni por muchos que
-- haya: borrarlo sería quitarle a alguien algo que todavía no vio. Por eso la
-- función devuelve cuántos quedan, y quien la llama deja constancia cuando
-- alguien sigue por encima del tope.
--
-- Todavía no hay programador (`pg_cron` llega con E16b), así que la llama
-- `notifyMember` después de guardar cada aviso, acotada a su destinatario. El
-- día que llegue E16b, el trabajo programado llama a esta misma función con
-- todos los socios.
--
-- Una sola sentencia para todos los destinatarios que reciba: una publicación
-- a todo el club (E11) no puede convertirse en una consulta pesada por socio.
-- Los leídos se ordenan del más viejo al más nuevo, así que los caducados son
-- siempre un prefijo de esa lista y los que sobran del tope también: se borra
-- el prefijo más largo de los dos.
--
-- `security invoker`: sólo la ejecuta `service_role`, que ya puede borrar en
-- `notifications`, y así no presta privilegios a nadie.
create or replace function public.prune_member_notifications(
  recipient_user_ids uuid[]
)
  returns table (user_id uuid, deleted_count integer, kept_count integer)
  language sql
  volatile
  security invoker
  set search_path = ''
as $$
  with policy as (
    select interval '90 days' as read_retention,
           200 as max_notifications_per_member
  ),
  totals as (
    select n.user_id, count(*)::integer as total
      from public.notifications n
     where n.user_id = any (recipient_user_ids)
     group by n.user_id
  ),
  read_oldest_first as (
    select n.id,
           n.user_id,
           n.created_at,
           row_number() over (
             partition by n.user_id
             order by n.created_at, n.id
           ) as position
      from public.notifications n
     where n.user_id = any (recipient_user_ids)
       and n.read_at is not null
  ),
  deleted as (
    delete from public.notifications n
     using read_oldest_first r, totals t, policy p
     where n.id = r.id
       and t.user_id = r.user_id
       and (r.created_at < now() - p.read_retention
            or r.position <= t.total - p.max_notifications_per_member)
    returning n.user_id
  )
  select t.user_id,
         count(d.user_id)::integer,
         t.total - count(d.user_id)::integer
    from totals t
    left join deleted d on d.user_id = t.user_id
   group by t.user_id, t.total;
$$;

revoke all on function public.prune_member_notifications(uuid[])
  from public, anon, authenticated;
grant execute on function public.prune_member_notifications(uuid[])
  to service_role;

notify pgrst, 'reload schema';
