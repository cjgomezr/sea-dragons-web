-- Las publicaciones del club, su audiencia y sus adjuntos (issue #326, RF-1 de
-- `docs/prd/e11-noticias-documentos.md`). Aquí sólo se guardan: publicar,
-- editar, el feed y la subida de adjuntos llegan en sus propios tickets.
--
-- La regla que no puede depender de que la aplicación se porte bien es la de
-- lectura: un miembro sólo recibe, aunque llame a la base directamente, las
-- publicaciones de su club dirigidas a él y no retiradas. Vive en la policy de
-- `news_posts`, y las de audiencia y adjuntos se apoyan en ella.
--
-- La audiencia sigue el modelo de E4 que E7 reutilizará para los eventos: una
-- columna dice si va a todo el club o a grupos, y una tabla aparte lista los
-- grupos. Cuando E7 cree la suya, debería parecerse a `news_post_groups`.

create table if not exists public.news_posts (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id),
  category text not null
    constraint news_posts_category_check
    check (category in ('announcement', 'news', 'document')),
  -- Como en `groups`, el límite se mide sobre el texto recortado: un título de
  -- solo espacios cuenta como vacío. El servidor exporta la misma cifra para su
  -- formulario; aquí es la última barrera.
  title text not null
    constraint news_posts_title_length
    check (char_length(btrim(title)) between 1 and 120),
  -- Texto plano con saltos de línea (PRD, sección 4). Pide algún carácter que
  -- no sea blanco: un cuerpo de solo saltos de línea también cuenta como vacío.
  body text not null
    constraint news_posts_body_not_blank
    check (body ~ '\S'),
  author_id uuid not null,
  published_at timestamptz not null default now(),
  -- `club` no necesita filas en `news_post_groups`; `groups` sin filas se
  -- guarda igual y no alcanza a nadie. Así "todo el club" y "cero grupos" no
  -- se confunden nunca. Que publicar a cero grupos sea un error lo decide el
  -- servidor (RF-2): borrar un grupo puede dejar una publicación así (PRD,
  -- sección 7) y la base no debe impedirlo.
  audience text not null
    constraint news_posts_audience_check
    check (audience in ('club', 'groups')),
  -- Retirar oculta, no borra (decisión D1 del PRD).
  status text not null default 'published'
    constraint news_posts_status_check
    check (status in ('published', 'withdrawn')),
  -- Nula mientras nadie la edite. Retirar no es editar.
  edited_at timestamptz,
  -- El destino de las claves foráneas compuestas de audiencia y adjuntos: con
  -- ella, ninguna de las dos puede colgar de una publicación de otro club.
  constraint news_posts_id_club_id_key unique (id, club_id),
  -- El autor tiene que ser socio del mismo club. Sin `on delete`: quien deja el
  -- club pasa a `inactive` y su publicación sigue con su nombre (PRD, sección
  -- 7). Borrar la identidad de alguien que publicó exige antes decidir qué
  -- pasa con lo que publicó, y la base lo recuerda negándose.
  constraint news_posts_author_same_club_fkey
    foreign key (author_id, club_id)
    references public.members (user_id, club_id)
);

-- El feed: las de un club, de la más reciente a la más antigua.
create index if not exists news_posts_club_id_published_at_idx
  on public.news_posts (club_id, published_at desc);

-- Lo que recorre Postgres al borrar un socio para comprobar la clave del autor.
create index if not exists news_posts_author_id_club_id_idx
  on public.news_posts (author_id, club_id);

create table if not exists public.news_post_groups (
  post_id uuid not null,
  group_id uuid not null,
  -- Redundante a propósito, como en `group_memberships`: las dos claves
  -- compuestas lo atan a la vez al club de la publicación y al del grupo, y eso
  -- es lo que impide dirigir una publicación a un grupo ajeno sin un trigger.
  club_id uuid not null references public.clubs (id),
  constraint news_post_groups_pkey primary key (post_id, group_id),
  constraint news_post_groups_post_same_club_fkey
    foreign key (post_id, club_id)
    references public.news_posts (id, club_id) on delete cascade,
  -- Borrar un grupo quita su fila y la publicación se queda: deja de alcanzar
  -- a nadie por ese grupo (PRD, sección 7).
  constraint news_post_groups_group_same_club_fkey
    foreign key (group_id, club_id)
    references public.groups (id, club_id) on delete cascade
);

-- La cascada al borrar un grupo, y la policy que busca por grupo.
create index if not exists news_post_groups_group_id_idx
  on public.news_post_groups (group_id);

create table if not exists public.news_post_attachments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null,
  club_id uuid not null references public.clubs (id),
  -- El nombre con el que se subió, para mostrarlo; la ruta es la que manda.
  file_name text not null,
  content_type text not null,
  -- Hasta 10 MB (decisión D3 del PRD). El servidor rechaza antes y con motivo;
  -- esto es la última barrera.
  size_bytes bigint not null
    constraint news_post_attachments_size_bytes_check
    check (size_bytes between 1 and 10485760),
  -- La ruta dentro del almacenamiento. El bucket y su subida son otro ticket.
  storage_path text not null
    constraint news_post_attachments_storage_path_key unique,
  created_at timestamptz not null default now(),
  constraint news_post_attachments_post_same_club_fkey
    foreign key (post_id, club_id)
    references public.news_posts (id, club_id) on delete cascade
);

-- La cascada, la cuenta del límite y la policy buscan por publicación.
create index if not exists news_post_attachments_post_id_idx
  on public.news_post_attachments (post_id);

-- Hasta 5 adjuntos por publicación (decisión D3). Un `check` no puede contar
-- filas, así que lo cuenta un trigger. Bloquea antes la fila de la
-- publicación: sin eso, dos subidas simultáneas verían cuatro cada una y
-- dejarían seis.
create or replace function public.news_post_attachments_enforce_max()
  returns trigger
  language plpgsql
  set search_path = ''
as $$
declare
  max_attachments_per_post constant integer := 5;
  existing_attachments integer;
begin
  perform 1 from public.news_posts where id = new.post_id for update;

  select count(*) into existing_attachments
    from public.news_post_attachments
   where post_id = new.post_id
     and id <> new.id;

  if existing_attachments >= max_attachments_per_post then
    raise exception using
      errcode = 'check_violation',
      message = format(
        'news_post_attachments_max_per_post: la publicación %s ya tiene %s adjuntos',
        new.post_id, max_attachments_per_post
      );
  end if;

  return new;
end
$$;

-- Sólo la usa el trigger: nadie de la API tiene por qué llamarla.
revoke all on function public.news_post_attachments_enforce_max()
  from public, anon, authenticated;

drop trigger if exists news_post_attachments_enforce_max
  on public.news_post_attachments;
create trigger news_post_attachments_enforce_max
  before insert or update of post_id on public.news_post_attachments
  for each row execute function public.news_post_attachments_enforce_max();

alter table public.news_posts enable row level security;
alter table public.news_post_groups enable row level security;
alter table public.news_post_attachments enable row level security;

-- Un miembro de alta ve las publicaciones de su club que no están retiradas y
-- que van a todo el club o a alguno de sus grupos. La audiencia se resuelve al
-- leer: quien entra en un grupo después ve lo que ya se había publicado.
--
-- La subconsulta de `members` pasa por `members_select_own`, así que sólo
-- encuentra la fila propia; la de `news_post_groups` pasa por la policy de
-- abajo, que sólo deja ver filas de los grupos propios, y eso es justo lo que
-- `is_member_in_groups` (`0015_groups.sql`) necesita para responder.
drop policy if exists news_posts_select_audience on public.news_posts;
create policy news_posts_select_audience
  on public.news_posts
  for select
  to authenticated
  using (
    status = 'published'
    and exists (
      select 1
        from public.members m
       where m.user_id = (select auth.uid())
         and m.club_id = news_posts.club_id
         and m.account_status <> 'inactive'
    )
    and (
      audience = 'club'
      or public.is_member_in_groups(
        (select auth.uid()),
        array(
          select npg.group_id
            from public.news_post_groups npg
           where npg.post_id = news_posts.id
        )
      )
    )
  );

-- Un miembro ve las filas de audiencia de sus grupos y ninguna más. No mira la
-- publicación: hacerlo desde aquí cerraría un ciclo entre las dos policies.
-- Lo que deja ver es que una publicación iba a un grupo suyo, y eso ya lo sabe
-- quien es su audiencia.
drop policy if exists news_post_groups_select_own_groups
  on public.news_post_groups;
create policy news_post_groups_select_own_groups
  on public.news_post_groups
  for select
  to authenticated
  using (
    exists (
      select 1
        from public.group_memberships gm
       where gm.group_id = news_post_groups.group_id
         and gm.user_id = (select auth.uid())
    )
  );

-- Un miembro ve los adjuntos de lo que puede leer. La subconsulta pasa por
-- `news_posts_select_audience`: una publicación retirada o ajena se lleva sus
-- adjuntos con ella.
drop policy if exists news_post_attachments_select_audience
  on public.news_post_attachments;
create policy news_post_attachments_select_audience
  on public.news_post_attachments
  for select
  to authenticated
  using (
    exists (
      select 1
        from public.news_posts p
       where p.id = news_post_attachments.post_id
    )
  );

-- Revocar primero, como en `0015_groups.sql`: el proyecto concede todo a
-- `anon` y `authenticated` sobre cada tabla nueva, y RLS no filtra
-- `truncate`. Publicar pasa por el servidor, que comprueba el rol (RF-2) y
-- escribe con la llave de servicio.
revoke all on public.news_posts from anon, authenticated;
grant select on public.news_posts to authenticated;
grant select, insert, update, delete on public.news_posts to service_role;

revoke all on public.news_post_groups from anon, authenticated;
grant select on public.news_post_groups to authenticated;
grant select, insert, update, delete on public.news_post_groups
  to service_role;

revoke all on public.news_post_attachments from anon, authenticated;
grant select on public.news_post_attachments to authenticated;
grant select, insert, update, delete on public.news_post_attachments
  to service_role;

-- Como en `0008_sonda_salud.sql`: que PostgREST vea las tablas en cuanto se
-- aplica, aunque faltara el event trigger que recarga su caché.
notify pgrst, 'reload schema';
