-- Las solicitudes de rol de E3 (issue #208, RF-3 de `docs/prd/e3-roles-rbac.md`).
-- Un socio pide Coach o Committee (FR-010) y un Admin decide (FR-011). Aquí
-- sólo se guarda la solicitud: los endpoints que la crean y la deciden llegan
-- en sus propios tickets.
--
-- Las reglas que no pueden depender de que la aplicación se porte bien viven
-- en la base: una sola solicitud pendiente por socio, aunque lleguen dos a la
-- vez, y nadie leyendo las ajenas.

create table if not exists public.role_requests (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id),
  -- El socio que pide, por su `user_id` y no por `members.id`. La clave
  -- foránea apunta igual a `members` (su `user_id` es único), así que sólo un
  -- socio puede pedir; y la policy compara la columna con `auth.uid()` sin
  -- cruzar `members`, que es lo que Supabase recomienda para que RLS no haga
  -- una consulta por fila. La cascada viene de la identidad: borrar
  -- `auth.users` borra el socio y el socio arrastra sus solicitudes.
  user_id uuid not null references public.members (user_id) on delete cascade,
  -- Admin no se pide (lo da otro Admin) y Player ya lo tiene todo el mundo.
  requested_role text not null check (requested_role in ('Coach', 'Committee')),
  -- Opcional (FR-010). El límite es de 500 caracteres, y la aplicación exporta
  -- la misma cifra cuando construya el formulario: aquí es la última barrera,
  -- no el mensaje que ve el socio.
  justification text check (char_length(justification) <= 500),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  -- Quién decidió y cuándo. `on delete set null` en quien decidió: borrar la
  -- identidad de un Admin no puede llevarse el historial de otra persona, y el
  -- instante de la decisión sigue diciendo que la hubo.
  decided_by uuid references public.members (user_id) on delete set null,
  decided_at timestamptz,
  -- Una pendiente no trae decisión y una decidida trae al menos su instante.
  -- `decided_by` puede faltar en una decidida por el `set null` de arriba.
  constraint role_requests_decision_matches_status check (
    (status = 'pending' and decided_by is null and decided_at is null)
    or (status <> 'pending' and decided_at is not null)
  )
);

-- La regla de una sola pendiente, como índice único parcial. Una comprobación
-- previa en la aplicación no basta: dos peticiones simultáneas la pasarían las
-- dos. El índice hace que la segunda espere a la primera y falle al confirmar.
-- Tras aprobar o rechazar, la fila sale del índice y el socio puede volver a
-- pedir.
create unique index if not exists role_requests_one_pending_per_member
  on public.role_requests (user_id)
  where status = 'pending';

-- La consulta de "mis solicitudes", la que filtra la policy, y la que recorre
-- la cascada al borrar un socio.
create index if not exists role_requests_user_id_created_at_idx
  on public.role_requests (user_id, created_at desc);

alter table public.role_requests enable row level security;

-- Un socio ve sus solicitudes y ninguna más. La bandeja del Admin (RF-7) la
-- lee el servidor con la llave de servicio.
drop policy if exists role_requests_select_own on public.role_requests;
create policy role_requests_select_own
  on public.role_requests
  for select
  to authenticated
  using (user_id = (select auth.uid()));

-- Revocar primero, como en `0003_members.sql`: el proyecto concede todos los
-- privilegios a `anon` y `authenticated` sobre cada tabla nueva, y RLS no
-- filtra `truncate`. Las escrituras las hace el servidor con la llave de
-- servicio; sin el privilegio, un socio que intente escribir recibe un
-- rechazo claro en vez de un "cero filas" en verde.
revoke all on public.role_requests from anon, authenticated;
grant select on public.role_requests to authenticated;
grant select, insert, update, delete on public.role_requests to service_role;
