-- La foto de perfil (FR-084, RF-7 del PRD de E5, issue #245): el primer
-- fichero que la aplicación guarda, en Supabase Storage.
--
-- EL BUCKET ES PRIVADO. Una foto pública con una dirección adivinable convierte
-- el directorio en un álbum del club abierto a internet. El servidor la sirve
-- con direcciones firmadas de vida corta, que firma con la llave de servicio
-- para quien ya comprobó que es del club; por eso aquí no hay policy que deje
-- leer la foto de otro.
--
-- Cada miembro tiene una carpeta con su `user_id`, y dentro un fichero con un
-- nombre aleatorio por cada subida: `<user_id>/<uuid>.<ext>`. Ni el correo ni
-- el nombre aparecen en la ruta, y un nombre nuevo por subida hace que el
-- reemplazo no pise la foto anterior hasta que la nueva quedó guardada.
--
-- El límite de tamaño y los tipos van también en el bucket, además de en el
-- servidor: la subida pasa por la API v1 (CON-002), pero así ni siquiera quien
-- ataque el almacenamiento con su propia sesión consigue dejar ahí un fichero
-- de más de 2 MB o que no diga ser una imagen.
--
-- `on conflict do update` en vez de `do nothing`: si alguien cambió el bucket a
-- mano, volver a aplicar el histórico lo deja otra vez como dice el
-- repositorio.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'member-photos',
  'member-photos',
  false,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Las policies sobre `storage.objects`. RLS ya viene activo en esa tabla, y la
-- migración no podría activarlo: es de `supabase_storage_admin`, no de quien
-- aplica el histórico.
--
-- La carpeta de cada miembro sólo la escribe su dueño, y sólo mientras su
-- cuenta opera: una baja con un token todavía vigente no puede subir nada. El
-- servidor sube y borra con la sesión de quien pide, así que estas policies
-- son la frontera de verdad y no un respaldo. Leer la fila propia hace falta
-- porque Storage la lee antes de borrarla.
--
-- Sin policy de update: cada subida es un fichero nuevo, y nadie reescribe
-- uno que ya existe.
drop policy if exists member_photos_select_own on storage.objects;
create policy member_photos_select_own
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'member-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists member_photos_insert_own on storage.objects;
create policy member_photos_insert_own
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'member-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    -- `members_select_own` deja a cada miembro leer su fila, así que esta
    -- consulta no necesita saltarse RLS para saber si su cuenta opera.
    and exists (
      select 1
        from public.members
       where user_id = (select auth.uid())
         and account_status = 'active'
    )
  );

drop policy if exists member_photos_delete_own on storage.objects;
create policy member_photos_delete_own
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'member-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1
        from public.members
       where user_id = (select auth.uid())
         and account_status = 'active'
    )
  );

-- La foto que el perfil y el directorio enseñan. Null es "sin foto", y
-- entonces salen las iniciales. Sin privilegios nuevos: `authenticated` ya no
-- tiene `update` sobre `members` (0003), así que sólo el servidor la escribe,
-- después de haber subido el fichero.
alter table public.members
  add column if not exists photo_path text;

-- La ruta cuelga siempre de la carpeta del propio miembro. Es lo que impide
-- que un error del servidor le enseñe a alguien la foto de otro.
alter table public.members
  drop constraint if exists members_photo_path_in_own_folder;
alter table public.members
  add constraint members_photo_path_in_own_folder check (
    starts_with(photo_path, user_id::text || '/')
  );
