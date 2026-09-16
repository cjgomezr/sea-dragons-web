-- El cupo propio de correos (issue #154). Cada registro o reenvío que podía
-- acabar en un envío deja una fila, y el servidor cuenta las del último día
-- antes de decir si ahora se pueden mandar correos.
--
-- Cuenta peticiones y no envíos, y por eso no guarda ni el correo ni su hash:
-- sólo se envía a cuentas sin confirmar, y un cupo que se llenara con envíos
-- delataría qué direcciones lo son. Lo único que importa es cuántas hubo.
--
-- Vive en la base por lo mismo que `0006_confirmation_email_requests.sql`: en
-- Vercel un contador en memoria no cuenta nada. La purga de filas viejas es de
-- E16 (retención), como la de `audit_log`.

create table if not exists public.email_send_requests (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id),
  requested_at timestamptz not null default now()
);

-- La única consulta es "cuántas desde tal instante".
create index if not exists email_send_requests_requested_at_idx
  on public.email_send_requests (requested_at desc);

alter table public.email_send_requests enable row level security;

-- Nadie con sesión la lee: es una herramienta del servidor. La policy
-- explícita deja escrita esa negación.
drop policy if exists email_send_requests_select_denied
  on public.email_send_requests;
create policy email_send_requests_select_denied
  on public.email_send_requests
  for select
  to authenticated
  using (false);

-- Revocar primero, como en `0003_members.sql`: el proyecto concede todos los
-- privilegios a `anon` y `authenticated` sobre cada tabla nueva, y `truncate`
-- no lo filtra RLS. Con la llave anónima, que es pública, cualquiera podría
-- vaciar el cupo o llenarlo y apagar el envío para todos.
revoke all on public.email_send_requests from anon, authenticated;
grant select, insert on public.email_send_requests to service_role;
