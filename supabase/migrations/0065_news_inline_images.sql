-- Las imágenes dentro del cuerpo de una publicación (issue #603, RF-14 de
-- `docs/prd/e22-rediseno-noticias.md`).
--
-- Cada imagen subida es una fila de `news_inline_images`. Su fichero es un
-- WebP en el bucket privado de los adjuntos (`0030_news_attachments.sql`), en
-- `<club_id>/inline-images/<id>.webp`: la ruta se deduce del club y del id,
-- así que la fila no la guarda. El original subido no se guarda nunca, como
-- la portada (decisión D6).
--
-- La fila nace al subir, antes de que exista la publicación y sin
-- `post_id`. El cuerpo la nombra con una dirección estable de la API
-- (`/api/v1/news/images/<id>`), y guardar la publicación la liga a ella
-- rellenando `post_id`. Mientras no tiene publicación sólo la ve quien la
-- subió, para la vista previa; después, la audiencia de la publicación. Si
-- nadie la llega a ligar, la borra quien la subió la siguiente vez que
-- publica o edita, pasado un día.
--
-- Borrar la publicación no borra la imagen: la deja otra vez sin publicación
-- (`on delete set null (post_id)`), que es lo que necesita publicar cuando
-- se deshace a medias para poder reintentar con las mismas imágenes.
--
-- Nadie la toca con su sesión, como el bucket: la tabla no tiene policy para
-- `authenticated`. Quién recibe la dirección firmada lo decide el servidor.

create table if not exists public.news_inline_images (
  -- Sin valor por defecto: el id es también el nombre de su fichero, y lo
  -- elige el servidor antes de subirlo.
  id uuid primary key,
  club_id uuid not null references public.clubs (id),
  uploaded_by uuid not null,
  post_id uuid,
  created_at timestamptz not null default now(),
  -- Quien la subió es socio del mismo club. Si se borra su ficha, se van sus
  -- imágenes.
  constraint news_inline_images_uploader_same_club_fkey
    foreign key (uploaded_by, club_id)
    references public.members (user_id, club_id) on delete cascade,
  -- Una imagen no puede ir en una publicación de otro club. Sólo se anula
  -- `post_id`: `club_id` es obligatorio y sigue siendo el mismo.
  constraint news_inline_images_post_same_club_fkey
    foreign key (post_id, club_id)
    references public.news_posts (id, club_id) on delete set null (post_id)
);

-- La limpieza de lo abandonado busca por quien subió y por fecha.
create index if not exists news_inline_images_uploaded_by_created_at_idx
  on public.news_inline_images (uploaded_by, created_at);

-- Editar busca las imágenes de la publicación, y la clave foránea las
-- recorre al borrarla.
create index if not exists news_inline_images_post_id_idx
  on public.news_inline_images (post_id)
  where post_id is not null;

alter table public.news_inline_images enable row level security;

revoke all on public.news_inline_images from anon, authenticated;
grant select, insert, update, delete on public.news_inline_images
  to service_role;
