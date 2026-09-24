-- El logo del club (RF-4 del PRD de E18a, issue #295), en Supabase Storage.
--
-- EL BUCKET ES PÚBLICO DE LECTURA, a diferencia del de las fotos de perfil
-- (`0018_member_photos.sql`). El logo sale en los correos, y un cliente de
-- correo no inicia sesión: una dirección firmada caducaría en la bandeja de
-- entrada. Un logo no es un dato personal, así que no hay nada que proteger
-- leyéndolo.
--
-- Escribir, en cambio, es sólo de la llave de servicio. Por eso aquí no hay
-- ninguna policy sobre `storage.objects`: RLS niega a `authenticated` subir o
-- borrar en este bucket, y el servidor sube el logo después de comprobar que
-- quien lo pide es Admin. La ruta es `<club_id>/<uuid>.<ext>`, con un nombre
-- nuevo en cada subida, para que el reemplazo no pise el logo anterior hasta
-- que el nuevo quedó guardado en `clubs.logo_path` (`0022_club_brand.sql`).
--
-- El límite de 512 KB y los tipos van también en el bucket, además de en el
-- servidor. Sin SVG a propósito: un SVG puede llevar código.
--
-- `on conflict do update` en vez de `do nothing`: si alguien cambió el bucket a
-- mano, volver a aplicar el histórico lo deja otra vez como dice el
-- repositorio.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'club-logos',
  'club-logos',
  true,
  524288,
  array['image/png', 'image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
