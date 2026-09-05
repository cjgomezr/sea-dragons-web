-- NFR-010: registrar eventos de autenticación, cambios de rol y cambios de
-- estado de pago, con actor, marca de tiempo y resultado, retenidos al menos
-- 12 meses (la purga a los 12 meses es de E16, fuera de este ticket).
--
-- `audit_log` sigue el patrón de `public.clubs` (club_id + RLS + policy
-- explícita) definido en 0001_clubs.sql.

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id),
  actor_id uuid not null,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  result text not null check (result in ('success', 'failure')),
  metadata jsonb,
  created_at timestamptz not null default now()
);

-- Toda consulta futura filtra por club y ordena por fecha (vista de
-- auditoría de Admin, retención/purga de E16).
create index if not exists audit_log_club_id_created_at_idx
  on public.audit_log (club_id, created_at desc);

alter table public.audit_log enable row level security;

-- El modelo de roles todavía no existe (E3): sin forma de distinguir un
-- Admin de cualquier otro autenticado, la política correcta hoy es negar la
-- lectura a `authenticated` por completo. E3 la reemplaza por una que deje
-- pasar solo al rol Admin.
drop policy if exists audit_log_select_denied on public.audit_log;
create policy audit_log_select_denied
  on public.audit_log
  for select
  to authenticated
  using (false);

-- Sin policy de insert/update/delete para `authenticated` ni `anon`: RLS las
-- niega todas por defecto. El único camino de escritura es `recordAuditEvent`
-- (src/lib/audit/audit-log.ts), que usa la llave de servicio.
--
-- `anon` no recibe ningún GRANT: a diferencia de `clubs`, este dato es
-- sensible y un visitante sin sesión no tiene ninguna razón para tocarlo, ni
-- siquiera para recibir una respuesta vacía.
grant select on public.audit_log to authenticated;
grant select, insert on public.audit_log to service_role;
