-- Los ficheros de los adjuntos de noticias (issue #328, RF-3 de
-- `docs/prd/e11-noticias-documentos.md`), en Supabase Storage. Las filas que
-- los describen ya existen en `news_post_attachments` (`0029_news_posts.sql`).
--
-- EL BUCKET ES PRIVADO, como el de las fotos de perfil (`0018_member_photos.sql`)
-- y a diferencia del logo del club (`0024_club_logos.sql`): un adjunto sólo lo
-- ve la audiencia de su publicación. El servidor comprueba esa audiencia y
-- entonces firma, con la llave de servicio, una dirección de vida corta.
--
-- Escribir es también sólo de la llave de servicio, como con el logo. Por eso
-- aquí no hay ninguna policy sobre `storage.objects`: RLS niega a
-- `authenticated` leer, subir o borrar en este bucket. Que quien sube sea el
-- autor y tenga el rol, y que la publicación admita otro adjunto, lo decide
-- el servidor antes de tocar nada; repetirlo en una policy obligaría a
-- reescribir aquí la regla de audiencia de `news_posts`.
--
-- La ruta es `<club_id>/<post_id>/<uuid>.<ext>`: el nombre con el que se subió
-- vive en la fila, no en la ruta.
--
-- El límite de 10 MB (decisión D3) y los tipos van también en el bucket,
-- además de en el servidor. Son los mismos que acepta
-- `src/lib/news/news-attachments.ts`.
--
-- `on conflict do update` en vez de `do nothing`: si alguien cambió el bucket a
-- mano, volver a aplicar el histórico lo deja otra vez como dice el
-- repositorio.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'news-attachments',
  'news-attachments',
  false,
  10485760,
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword'
  ]
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
