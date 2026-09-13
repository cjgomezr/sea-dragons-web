-- El límite de peticiones de recuperación de contraseña por correo (RF-6 del
-- PRD de E2). Cada petición deja una fila, y el servidor cuenta las recientes
-- del mismo correo antes de emitir un enlace.
--
-- Vive en la base y no en la memoria del servidor porque en Vercel cada
-- petición puede caer en una instancia distinta: un contador en memoria se
-- reparte entre ellas y no limita nada.
--
-- Se guarda el SHA-256 del correo normalizado, no el correo. La fila existe
-- también para direcciones que no son de nadie (el límite se aplica igual a
-- las dos, o delataría quién tiene cuenta), y guardar en claro lo que alguien
-- tecleó en un formulario público es acumular datos personales sin motivo.
-- Es seudonimización, no anonimato: quien lea la tabla y tenga una lista de
-- correos puede comprobarlos. Por eso nadie más que el servidor la lee.
--
-- La purga de filas viejas es de E16 (retención), como la de `audit_log`. Sólo
-- cuentan las de la última ventana, así que las antiguas no cambian ninguna
-- respuesta mientras tanto.

create table if not exists public.password_recovery_requests (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id),
  email_hash text not null,
  requested_at timestamptz not null default now()
);

-- La única consulta es "las de este correo desde tal instante".
create index if not exists password_recovery_requests_email_hash_requested_at_idx
  on public.password_recovery_requests (email_hash, requested_at desc);

alter table public.password_recovery_requests enable row level security;

-- Nadie con sesión la lee: es una herramienta del servidor, no un dato del
-- socio. La policy explícita deja escrita esa negación en vez de dejarla
-- implícita en la ausencia de policies.
drop policy if exists password_recovery_requests_select_denied
  on public.password_recovery_requests;
create policy password_recovery_requests_select_denied
  on public.password_recovery_requests
  for select
  to authenticated
  using (false);

-- Revocar primero, como en `0003_members.sql`: este proyecto concede todos los
-- privilegios a `anon` y `authenticated` sobre cada tabla nueva, y `truncate`
-- no lo filtra RLS. La llave anónima es pública, así que sin esto cualquiera
-- podría vaciar la tabla y con ella el límite.
revoke all on public.password_recovery_requests from anon, authenticated;
grant select, insert on public.password_recovery_requests to service_role;
