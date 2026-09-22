-- Los avisos de cada socio (issue #264, RF-1 de `docs/prd/e6-notificaciones.md`).
-- Un aviso no guarda su texto: guarda su tipo y los datos para contarlo. El
-- título y el cuerpo se arman al mostrarlo, en el idioma que tenga la persona
-- en ese momento, así que un aviso creado en español se lee en inglés si la
-- persona cambia de idioma. Aquí sólo se guarda: la función que los crea, la
-- API y la campana llegan en sus propios tickets.

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id),
  -- El destinatario por su `user_id`, como en `role_requests`: la policy lo
  -- compara con `auth.uid()` sin cruzar `members`.
  user_id uuid not null,
  -- Catálogo cerrado a propósito, como `role` o `account_status`. Un tipo
  -- nuevo necesita sus textos en el catálogo de mensajes antes de existir, así
  -- que cada épica (E7, E11, E12) lo amplía con su propia migración.
  type text not null
    constraint notifications_type_check
    check (type in (
      'role_changed',
      'role_request_rejected',
      'role_request_received'
    )),
  -- Los datos que el texto necesita, con nombre. Un objeto y no otra cosa:
  -- una lista o un valor suelto no dicen qué es cada dato.
  data jsonb not null default '{}'::jsonb
    constraint notifications_data_is_object
    check (jsonb_typeof(data) = 'object'),
  created_at timestamptz not null default now(),
  -- Nula mientras no se lee.
  read_at timestamptz,
  -- Como en `0015_groups.sql`: la clave compuesta contra `members` ata el
  -- club del aviso al del destinatario sin un trigger. Borrar la identidad
  -- borra el socio (`0003_members.sql`), y el socio arrastra sus avisos.
  constraint notifications_member_same_club_fkey
    foreign key (user_id, club_id)
    references public.members (user_id, club_id) on delete cascade
);

-- La lista de "mis avisos" (los más recientes primero), la que filtra la
-- policy, y la que recorre la cascada al borrar un socio.
create index if not exists notifications_user_id_created_at_idx
  on public.notifications (user_id, created_at desc);

-- El número de la campana, que se pide cada minuto por cada socio conectado.
-- Parcial: sólo guarda los no leídos, que son pocos frente al histórico.
create index if not exists notifications_unread_user_id_idx
  on public.notifications (user_id)
  where read_at is null;

alter table public.notifications enable row level security;

-- Un socio ve sus avisos y ninguno más. Crearlos y marcarlos como leídos lo
-- hace el servidor con la llave de servicio.
drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own
  on public.notifications
  for select
  to authenticated
  using (user_id = (select auth.uid()));

-- Revocar primero, como en `0003_members.sql`: el proyecto concede todos los
-- privilegios a `anon` y `authenticated` sobre cada tabla nueva, y RLS no
-- filtra `truncate`. Sin el privilegio, un socio que intente escribir recibe
-- un rechazo claro en vez de un "cero filas" en verde.
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
grant select, insert, update, delete on public.notifications to service_role;

-- Como en `0008_sonda_salud.sql`: que PostgREST vea la tabla en cuanto se
-- aplica, aunque faltara el event trigger que recarga su caché.
notify pgrst, 'reload schema';
