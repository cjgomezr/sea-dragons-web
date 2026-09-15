-- La función a la que pregunta `GET /api/v1/health`, y el último privilegio que
-- le quedaba a `anon` sobre una tabla, que ya no hace falta.
--
-- Hasta aquí la sonda leía `public.clubs` con la llave anónima y sin sesión, y
-- por eso `0004` le dejó a `anon` el `select` sobre esa tabla: sin él, la
-- consulta pasaba a `permission denied`, la sonda respondía 503 y el monitoreo
-- de producción (#95) avisaba de una caída que no existía. Ahora la sonda
-- llama a esta función (`src/app/api/v1/health/route.ts`), y `clubs` puede
-- quedarse sin nada para `anon`.

-- `security invoker` (el valor por defecto) y no `security definer`. Una
-- función definer corre con los privilegios de quien la creó y sería una
-- puerta trasera a lo que `anon` no tiene. Esta no los necesita: no lee ninguna
-- tabla, así que no hay nada que saltarse. Tampoco recibe argumentos, así que
-- nada del cliente llega a ella.
--
-- Devuelve un booleano y no filas: no puede filtrar datos del club por mucho
-- que alguien la edite, sin cambiar antes su firma.
--
-- El `search_path` vacío lo fija por higiene: el valor de la sesión no puede
-- decidir qué resuelve el cuerpo.
create or replace function public.health_probe()
  returns boolean
  language sql
  stable
  set search_path = ''
as $$
  select true
$$;

-- Postgres concede `execute` a PUBLIC en toda función nueva, y el
-- `pg_default_acl` de Supabase además a `anon`, `authenticated` y
-- `service_role`. Se quita todo y se devuelve sólo lo que la sonda usa.
revoke all on function public.health_probe()
  from public, anon, authenticated, service_role;
grant execute on function public.health_probe() to anon;

-- Lo que `0004` dejó a `anon` sólo por la sonda. `authenticated` conserva su
-- `select`, que es lo que su policy deja pasar.
revoke all on public.clubs from anon;

-- Supabase recarga la caché de esquema de PostgREST con un event trigger al
-- cambiar el DDL. Pedirlo aquí también no cuesta nada, y evita que la sonda
-- responda "Could not find the function" si ese trigger faltara.
notify pgrst, 'reload schema';
