-- Los correos del directorio (issue #501, RF-6 y RF-7 de
-- `docs/prd/e19-directorio-administracion.md`, D8).
--
-- Un Admin o un Committee manda correos a los socios desde el directorio, y
-- salen del mismo cupo diario de Resend que los correos de cuenta. Para que
-- esos nunca se queden sin cupo, el directorio lleva el suyo: como mucho 50
-- correos en 24 horas (la constante vive en `directory-email.ts`). Se cuentan
-- aquí, aparte de `email_send_requests` (`0009`), que es el cupo de los de
-- cuenta y no ve nada de esta tabla.
--
-- Cada envío deja una fila con cuántos se reservaron y, al terminar, cuántos
-- salieron. Mientras no termina cuenta lo reservado: un envío a medias no
-- puede dejar sitio que todavía no es libre. Ni el asunto ni el cuerpo ni a
-- quiénes: eso va a la bitácora, que guarda el asunto y nada más.
--
-- Cuenta las filas de todos los clubes a propósito, como `0009`: el cupo es
-- de la cuenta de Resend del proyecto, no de cada club. `club_id` sólo firma
-- la fila (NFR-009). La purga de filas viejas es de E16 (retención).

create table if not exists public.directory_email_sends (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id),
  -- Sin clave foránea, como `audit_log.actor_id`: el registro del cupo no
  -- puede perder filas porque se borre una identidad.
  sender_id uuid not null,
  -- Lo genera quien llama, una vez por envío: repetir la petición no reserva
  -- ni manda otra vez.
  request_id uuid not null unique,
  reserved_count integer not null check (reserved_count > 0),
  sent_count integer check (
    sent_count >= 0 and sent_count <= reserved_count
  ),
  created_at timestamptz not null default now()
);

-- La única consulta es "cuántos desde tal instante".
create index if not exists directory_email_sends_created_at_idx
  on public.directory_email_sends (created_at desc);

alter table public.directory_email_sends enable row level security;

-- Nadie con sesión la lee: es una herramienta del servidor. La policy
-- explícita deja escrita esa negación.
drop policy if exists directory_email_sends_select_denied
  on public.directory_email_sends;
create policy directory_email_sends_select_denied
  on public.directory_email_sends
  for select
  to authenticated
  using (false);

-- Revocar primero, como en `0003_members.sql`. Con la llave anónima, que es
-- pública, cualquiera podría vaciar el cupo o llenarlo. El servidor apunta
-- cuántos salieron, y nada más se cambia de una fila.
revoke all on public.directory_email_sends from anon, authenticated;
revoke all on public.directory_email_sends from service_role;
grant select, insert on public.directory_email_sends to service_role;
grant update (sent_count) on public.directory_email_sends to service_role;

-- La regla del conteo, en un solo sitio: lo que salió si el envío terminó, y
-- lo reservado si no.
create or replace function public.count_directory_emails_since(
  window_start timestamptz
)
  returns integer
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select coalesce(sum(coalesce(s.sent_count, s.reserved_count)), 0)::integer
    from public.directory_email_sends s
   where s.created_at >= window_start;
$$;

-- Contar y apuntar van juntos y bajo un cerrojo: dos envíos a la vez se
-- ponen en fila, y el segundo cuenta ya lo que reservó el primero. El
-- cerrojo es de transacción, así que se suelta solo al terminar.
--
-- Devuelve `{"outcome":"reserved","send_id":…}`, `{"outcome":"exceeded",
-- "remaining":n}` o `{"outcome":"duplicate"}`.
create or replace function public.reserve_directory_email_quota(
  target_club_id uuid,
  sender_user_id uuid,
  send_request_id uuid,
  recipient_count integer,
  quota_limit integer,
  window_start timestamptz
)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  used integer;
  new_send_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('public.directory_email_sends'));

  if exists (
    select 1 from public.directory_email_sends s
     where s.request_id = send_request_id
  ) then
    return jsonb_build_object('outcome', 'duplicate');
  end if;

  used := public.count_directory_emails_since(window_start);
  if recipient_count > quota_limit - used then
    return jsonb_build_object(
      'outcome', 'exceeded',
      'remaining', greatest(quota_limit - used, 0));
  end if;

  insert into public.directory_email_sends
    (club_id, sender_id, request_id, reserved_count)
  values (target_club_id, sender_user_id, send_request_id, recipient_count)
  returning id into new_send_id;

  return jsonb_build_object('outcome', 'reserved', 'send_id', new_send_id);
end;
$$;

-- Postgres concede `execute` a PUBLIC en toda función nueva, y el
-- `pg_default_acl` de Supabase además a `anon` y `authenticated`. Sólo el
-- servidor cuenta y reserva.
revoke all on function public.count_directory_emails_since(timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.count_directory_emails_since(timestamptz)
  to service_role;

revoke all on function public.reserve_directory_email_quota(
  uuid, uuid, uuid, integer, integer, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.reserve_directory_email_quota(
  uuid, uuid, uuid, integer, integer, timestamptz)
  to service_role;

notify pgrst, 'reload schema';
