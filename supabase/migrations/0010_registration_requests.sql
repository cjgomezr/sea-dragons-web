-- El límite de `POST /api/v1/auth/register` (issue #173). Cada petición de
-- registro deja dos filas, una por su procedencia y otra por su dirección, y
-- el servidor cuenta las recientes de cada sujeto antes de dejarla seguir.
--
-- POR QUÉ HACE FALTA. Hasta el #154 una ráfaga contra el registro costaba
-- envíos reales de Resend. Desde que existe el cupo propio de correos
-- (`0009_email_send_requests.sql`) sale gratis: registrar una dirección que ya
-- tiene cuenta no manda ningún correo, pero sí gasta cupo. Con 80 peticiones y
-- direcciones inventadas, el club se quedaba 24 horas sin correos de
-- confirmación y las cuentas nuevas sin poder entrar.
--
-- Es la misma forma que `0006_confirmation_email_requests.sql`, y por los
-- mismos motivos: vive en la base porque en Vercel un contador en memoria no
-- limita nada, y guarda hashes en vez de los datos.
--
-- Una tabla para los dos sujetos y no dos tablas: la consulta es la misma y
-- `subject_kind` ya separa los contadores dentro del índice. Lo que sí van por
-- separado son los topes, para que una ráfaga contra una sola dirección no
-- consuma el cupo de intentos de las demás.
--
-- La purga de filas viejas es de E16 (retención), como la de `audit_log`.

create table if not exists public.registration_requests (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id),
  -- Sólo estos dos: un sujeto que el servidor no sepa contar sería un
  -- contador que nadie mira, y la base lo rechaza en vez de guardarlo.
  subject_kind text not null check (subject_kind in ('ip', 'email')),
  -- Ni la IP ni el correo, que son datos personales y no hace falta leerlos
  -- nunca: sólo un hash con clave (ver `supabase-registration-request-log.ts`).
  -- Con clave y no a secas como el de `0006`, porque el espacio de las IPv4
  -- cabe entero en una tabla arcoíris y el de los correos de un club, también.
  subject_hash text not null,
  requested_at timestamptz not null default now()
);

-- La única consulta es "las de este sujeto desde tal instante".
create index if not exists registration_requests_subject_requested_at_idx
  on public.registration_requests (subject_kind, subject_hash, requested_at desc);

alter table public.registration_requests enable row level security;

-- Nadie con sesión la lee: es una herramienta del servidor, no un dato del
-- socio. La policy explícita deja escrita esa negación.
drop policy if exists registration_requests_select_denied
  on public.registration_requests;
create policy registration_requests_select_denied
  on public.registration_requests
  for select
  to authenticated
  using (false);

-- Revocar primero, como en `0003_members.sql`: el proyecto concede todos los
-- privilegios a `anon` y `authenticated` sobre cada tabla nueva, y `truncate`
-- no lo filtra RLS. Con la llave anónima, que es pública, cualquiera vaciaría
-- la tabla y con ella el límite.
revoke all on public.registration_requests from anon, authenticated;
grant select, insert on public.registration_requests to service_role;
