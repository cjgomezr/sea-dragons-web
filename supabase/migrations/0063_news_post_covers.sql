-- La portada de una publicación (issue #591, RF-2 de
-- `docs/prd/e22-rediseno-noticias.md`).
--
-- Cada portada subida es una fila de `news_cover_uploads`, y la publicación
-- la apunta con `news_posts.cover_upload_id`. Sus ficheros son dos WebP en el
-- bucket privado de los adjuntos (`0030_news_attachments.sql`), en
-- `<club_id>/covers/<id>-thumb.webp` y `<club_id>/covers/<id>-large.webp`: la
-- ruta se deduce del club y del id, así que la fila no la guarda. El original
-- subido no se guarda nunca (decisión D6).
--
-- La fila nace al subir, antes de que exista la publicación, para que quien
-- publica sólo pueda enlazar una portada suya: el servidor lo comprueba con
-- `uploaded_by`. Si nadie la llega a enlazar, la borra quien la subió la
-- siguiente vez que publica, pasado un día, como las subidas de adjuntos.
--
-- Borrar los ficheros al cambiar o quitar la portada lo hace el servidor con
-- la API de Storage, después de guardar la publicación: Supabase no deja
-- borrar objetos desde SQL. La clave foránea sin `on delete` impide borrar la
-- fila de una portada que alguna publicación sigue apuntando.
--
-- Nadie la toca con su sesión, como el bucket: ni la tabla ni los ficheros
-- tienen policy para `authenticated`. Quién recibe la dirección firmada lo
-- decide el servidor con la audiencia de la publicación.

create table if not exists public.news_cover_uploads (
  -- Sin valor por defecto: el id es también el nombre de sus ficheros, y lo
  -- elige el servidor antes de subirlos.
  id uuid primary key,
  club_id uuid not null references public.clubs (id),
  uploaded_by uuid not null,
  created_at timestamptz not null default now(),
  -- El destino de la clave compuesta de `news_posts`: una publicación no
  -- puede apuntar a la portada de otro club.
  constraint news_cover_uploads_id_club_id_key unique (id, club_id),
  -- Quien la subió es socio del mismo club. Si se borra su ficha, se van sus
  -- portadas sin publicar; una publicada lo impide la clave de `news_posts`.
  constraint news_cover_uploads_uploader_same_club_fkey
    foreign key (uploaded_by, club_id)
    references public.members (user_id, club_id) on delete cascade
);

-- La limpieza de lo abandonado busca por quien subió y por fecha.
create index if not exists news_cover_uploads_uploaded_by_created_at_idx
  on public.news_cover_uploads (uploaded_by, created_at);

alter table public.news_cover_uploads enable row level security;

revoke all on public.news_cover_uploads from anon, authenticated;
grant select, insert, delete on public.news_cover_uploads to service_role;

alter table public.news_posts
  add column if not exists cover_upload_id uuid;

-- `do` porque `add constraint` no admite `if not exists`, y producción
-- reaplica el histórico entero en cada merge.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'news_posts_cover_same_club_fkey'
  ) then
    alter table public.news_posts
      add constraint news_posts_cover_same_club_fkey
      foreign key (cover_upload_id, club_id)
      references public.news_cover_uploads (id, club_id);
  end if;
end;
$$;

-- Una portada es de una sola publicación. También sirve a la clave foránea
-- al borrar una portada y a la búsqueda de la publicación que la apunta.
create unique index if not exists news_posts_cover_upload_id_key
  on public.news_posts (cover_upload_id)
  where cover_upload_id is not null;
