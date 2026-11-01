-- Noticias: borrar para siempre una publicación ya retirada (issue #958,
-- E11). Una publicada no se borra nunca: primero se retira. Mirar el estado y
-- borrar van en la misma transacción, con la publicación bloqueada, para que
-- volver a publicarla a la vez no se cuele entre los dos. Lo llama el
-- servidor con la llave de servicio, como `delete_training_cycle` (0088); no
-- es para una sesión.
--
-- La audiencia (`news_post_groups`) y los adjuntos (`news_post_attachments`)
-- se van solos con las `on delete cascade` de `0029`. Las imágenes del
-- cuerpo no: su clave es `on delete set null (post_id)` (`0065`), así que se
-- borran aquí antes. La portada tampoco: la apunta la publicación
-- (`news_posts.cover_upload_id`, `0063`), así que su fila se borra después
-- de la publicación, cuando ya nada la apunta.
--
-- Supabase no deja borrar objetos del almacenamiento desde SQL. La función
-- devuelve lo que hace falta para encontrar los ficheros, y el servidor los
-- borra del bucket después: las rutas de los adjuntos, que guarda su fila, y
-- los ids de la portada y de las imágenes, cuyas rutas se deducen del club y
-- del id.
--
-- Producción reaplica el histórico entero en cada merge: `create or replace`.

-- Siempre una fila. `outcome` es `deleted`, `published` (no se borró nada) o
-- `missing`: no existe, es de otro club, o la borró otra llamada mientras
-- ésta esperaba el bloqueo.
create or replace function public.delete_news_post(
  p_club_id uuid,
  p_post_id uuid
)
  returns table (
    outcome text,
    title text,
    attachment_paths text[],
    cover_upload_id uuid,
    inline_image_ids uuid[]
  )
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_status text;
begin
  select p.status, p.title, p.cover_upload_id
    into v_status, title, cover_upload_id
    from public.news_posts p
   where p.id = p_post_id
     and p.club_id = p_club_id
     for update;
  if not found then
    outcome := 'missing';
    return next;
    return;
  end if;

  if v_status = 'published' then
    outcome := 'published';
    title := null;
    cover_upload_id := null;
    return next;
    return;
  end if;

  select coalesce(array_agg(a.storage_path order by a.created_at), '{}')
    into attachment_paths
    from public.news_post_attachments a
   where a.post_id = p_post_id;

  with removed as (
    delete from public.news_inline_images i
     where i.post_id = p_post_id
    returning i.id
  )
  select coalesce(array_agg(removed.id), '{}')
    into inline_image_ids
    from removed;

  delete from public.news_posts p
   where p.id = p_post_id;

  if cover_upload_id is not null then
    delete from public.news_cover_uploads c
     where c.id = cover_upload_id;
  end if;

  outcome := 'deleted';
  return next;
end;
$$;

revoke all on function public.delete_news_post(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.delete_news_post(uuid, uuid)
  to service_role;

notify pgrst, 'reload schema';
