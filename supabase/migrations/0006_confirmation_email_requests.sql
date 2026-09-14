-- El límite del reenvío público del correo de confirmación (issue #137). Cada
-- petición deja una fila, y el servidor cuenta las recientes del mismo correo
-- antes de emitir un enlace y mandarlo por Resend.
--
-- Hasta el #137 el tope lo ponía el servicio de correo incorporado de
-- Supabase, a 2 correos por hora. Resend no pone ninguno que sirva aquí: sin
-- esta tabla, un bucle contra el endpoint llenaría un buzón ajeno y agotaría
-- el cupo diario que comparte la recuperación de contraseña.
--
-- Es la misma forma que `0005_password_recovery_requests.sql`, y por los
-- mismos motivos: vive en la base porque en Vercel un contador en memoria no
-- limita nada, guarda el SHA-256 del correo y no el correo, y sólo la lee el
-- servidor. Va en su propia tabla para que pedir un enlace de recuperación no
-- gaste el cupo del reenvío, ni al revés.
--
-- La purga de filas viejas es de E16 (retención), como la de `audit_log`.

create table if not exists public.confirmation_email_requests (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id),
  email_hash text not null,
  requested_at timestamptz not null default now()
);

-- La única consulta es "las de este correo desde tal instante".
create index if not exists confirmation_email_requests_email_hash_requested_at_idx
  on public.confirmation_email_requests (email_hash, requested_at desc);

alter table public.confirmation_email_requests enable row level security;

-- Nadie con sesión la lee: es una herramienta del servidor, no un dato del
-- socio. La policy explícita deja escrita esa negación.
drop policy if exists confirmation_email_requests_select_denied
  on public.confirmation_email_requests;
create policy confirmation_email_requests_select_denied
  on public.confirmation_email_requests
  for select
  to authenticated
  using (false);

-- Revocar primero, como en `0003_members.sql`: el proyecto concede todos los
-- privilegios a `anon` y `authenticated` sobre cada tabla nueva, y `truncate`
-- no lo filtra RLS. Sin esto la llave anónima, que es pública, podría vaciar
-- la tabla y con ella el límite.
revoke all on public.confirmation_email_requests from anon, authenticated;
grant select, insert on public.confirmation_email_requests to service_role;
