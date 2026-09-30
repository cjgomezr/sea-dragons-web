-- La búsqueda global (#425, RF-7 y D5 de `docs/prd/e14-dashboard-busqueda.md`).
--
-- Coincide por subcadena sin mayúsculas ni acentos: "munoz" encuentra
-- "Muñoz" y "isc" encuentra "Piscina". Las dos orillas se normalizan con la
-- misma función, `search_normalize`, para que la regla no se pueda separar
-- entre lo que se guarda y lo que se busca.
--
-- `unaccent` de la extensión no es `immutable` (depende de un diccionario
-- que se puede cambiar), y un índice sólo admite funciones que lo son. Por
-- eso `immutable_unaccent` la envuelve con el diccionario fijado: es el
-- patrón que documenta la propia extensión.
--
-- El texto del socio nunca forma parte del patrón: `search_like_pattern`
-- escapa `\`, `%` y `_` antes de envolverlo en comodines, así que "50%" busca
-- un cincuenta seguido de un por ciento y no "50 y cualquier cosa".
--
-- Las tres búsquedas devuelven filas enteras de su tabla, para que PostgREST
-- pueda embeber y filtrar sobre ellas como sobre la tabla misma: la
-- audiencia de eventos y noticias la aplica el servidor con los mismos
-- filtros que la agenda y el feed. Sólo las llama el servidor con la llave
-- de servicio, igual que esas dos lecturas.
--
-- Idempotente como el resto del histórico.

create schema if not exists extensions;
-- Como en Supabase: cualquiera de los roles de la API puede usar lo que vive
-- en `extensions`. Ahí ya está concedido; el Postgres desechable lo necesita.
grant usage on schema extensions to anon, authenticated, service_role;

create extension if not exists unaccent with schema extensions;
create extension if not exists pg_trgm with schema extensions;

create or replace function public.immutable_unaccent(p_text text)
  returns text
  language sql
  immutable
  strict
  parallel safe
  set search_path = ''
as $$
  select extensions.unaccent('extensions.unaccent'::regdictionary, p_text)
$$;

create or replace function public.search_normalize(p_text text)
  returns text
  language sql
  immutable
  strict
  parallel safe
  set search_path = ''
as $$
  select public.immutable_unaccent(lower(p_text))
$$;

create or replace function public.search_like_pattern(p_text text)
  returns text
  language sql
  immutable
  strict
  parallel safe
  set search_path = ''
as $$
  select '%'
    || replace(
         replace(
           replace(public.search_normalize(p_text), '\', '\\'),
           '%', '\%'),
         '_', '\_')
    || '%'
$$;

create or replace function public.search_members(
  p_club_id uuid,
  p_text text
)
  returns setof public.members
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select m.*
    from public.members m
   where m.club_id = p_club_id
     and public.search_normalize(m.full_name)
         like public.search_like_pattern(p_text)
$$;

create or replace function public.search_events(
  p_club_id uuid,
  p_text text
)
  returns setof public.events
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select e.*
    from public.events e
   where e.club_id = p_club_id
     and (
       public.search_normalize(e.title)
         like public.search_like_pattern(p_text)
       or public.search_normalize(e.location)
         like public.search_like_pattern(p_text)
     )
$$;

create or replace function public.search_news_posts(
  p_club_id uuid,
  p_text text
)
  returns setof public.news_posts
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select n.*
    from public.news_posts n
   where n.club_id = p_club_id
     and (
       public.search_normalize(n.title)
         like public.search_like_pattern(p_text)
       or public.search_normalize(n.body)
         like public.search_like_pattern(p_text)
     )
$$;

-- Las normalizaciones son puras y las evalúan los índices al escribir
-- cualquier fila, así que las ejecutan todos los roles.
grant execute on function public.immutable_unaccent(text)
  to anon, authenticated, service_role;
grant execute on function public.search_normalize(text)
  to anon, authenticated, service_role;
grant execute on function public.search_like_pattern(text)
  to anon, authenticated, service_role;

-- Las búsquedas saltan la regla de "sólo tu fila" de `members` con la llave
-- de servicio y confían al servidor la audiencia: no son para una sesión.
revoke all on function public.search_members(uuid, text)
  from public, anon, authenticated;
grant execute on function public.search_members(uuid, text) to service_role;

revoke all on function public.search_events(uuid, text)
  from public, anon, authenticated;
grant execute on function public.search_events(uuid, text) to service_role;

revoke all on function public.search_news_posts(uuid, text)
  from public, anon, authenticated;
grant execute on function public.search_news_posts(uuid, text)
  to service_role;

-- Trigramas sobre la forma normalizada: sirven a un `like '%...%'` con tres
-- o más caracteres, que un btree no puede atender (NFR-008). Con dos, la
-- base recorre la tabla del club, que sigue siendo pequeña.
create index if not exists members_full_name_search_idx
  on public.members
  using gin (public.search_normalize(full_name) extensions.gin_trgm_ops);
create index if not exists events_title_search_idx
  on public.events
  using gin (public.search_normalize(title) extensions.gin_trgm_ops);
create index if not exists events_location_search_idx
  on public.events
  using gin (public.search_normalize(location) extensions.gin_trgm_ops);
create index if not exists news_posts_title_search_idx
  on public.news_posts
  using gin (public.search_normalize(title) extensions.gin_trgm_ops);
create index if not exists news_posts_body_search_idx
  on public.news_posts
  using gin (public.search_normalize(body) extensions.gin_trgm_ops);

notify pgrst, 'reload schema';
