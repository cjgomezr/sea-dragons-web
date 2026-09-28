-- Lo que pasó de verdad en cada entrenamiento (issue #392, RF-1 de
-- `docs/prd/e8-asistencia.md`, FR-038). Una fila por sesión y miembro:
-- presente, tarde o ausente, quién lo registró y cuándo. Guardar la hoja otra
-- vez reescribe la misma fila.
--
-- Quién puede pasar lista (Admin o Coach) y a quién (la audiencia del
-- entrenamiento) lo decide el servidor antes de escribir, con la llave de
-- servicio. Lo que la base afirma sola es la forma: el estado, que el evento
-- sea un entrenamiento del mismo club y las cascadas.

-- Destino de la clave compuesta que ata cada fila a un entrenamiento. `id` ya
-- es único, así que esto no cambia qué eventos caben: sólo le da a Postgres
-- el trío como destino. Va en un bloque porque `add constraint` no tiene
-- `if not exists`.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.events'::regclass
       and conname = 'events_id_club_id_event_type_key'
  ) then
    alter table public.events
      add constraint events_id_club_id_event_type_key
      unique (id, club_id, event_type);
  end if;
end;
$$;

create table if not exists public.attendance_records (
  event_id uuid not null,
  user_id uuid not null,
  club_id uuid not null references public.clubs (id),
  -- Sólo los entrenamientos llevan hoja (D2). Un `check` no puede mirar
  -- `events`, así que la fila copia el tipo, lo fija aquí y la clave compuesta
  -- de abajo exige que coincida con el del evento. Sin trigger, como el
  -- `club_id` redundante de `event_rsvps`.
  event_type text not null default 'training'
    constraint attendance_records_event_type_check
    check (event_type = 'training'),
  status text not null
    constraint attendance_records_status_check
    check (status in ('present', 'late', 'absent')),
  -- Quién la registró por última vez. Si esa persona se va del club la fila
  -- se queda: sólo se borra el nombre.
  recorded_by uuid,
  recorded_at timestamptz not null default now(),
  constraint attendance_records_pkey primary key (event_id, user_id),
  -- Evento del mismo club y de tipo `training`. Borrar el evento se lleva la
  -- fila; cambiarle el tipo a un entrenamiento con asistencia se rechaza.
  constraint attendance_records_training_fkey
    foreign key (event_id, club_id, event_type)
    references public.events (id, club_id, event_type) on delete cascade,
  -- Borrar la identidad (que borra al socio) se lleva sus filas.
  constraint attendance_records_member_same_club_fkey
    foreign key (user_id, club_id)
    references public.members (user_id, club_id) on delete cascade,
  -- La lista de columnas del `set null` deja el `club_id` en su sitio.
  constraint attendance_records_recorder_same_club_fkey
    foreign key (recorded_by, club_id)
    references public.members (user_id, club_id)
    on delete set null (recorded_by)
);

-- Las filas de un miembro: para la cascada de su fila de `members` y para su
-- porcentaje de asistencia (RF-3).
create index if not exists attendance_records_user_id_club_id_idx
  on public.attendance_records (user_id, club_id);

-- Lo que registró cada quien, para el `set null` cuando se va.
create index if not exists attendance_records_recorded_by_club_id_idx
  on public.attendance_records (recorded_by, club_id);

alter table public.attendance_records enable row level security;

-- Cada miembro ve sólo sus filas. La hoja entera la sirve el servidor.
drop policy if exists attendance_records_select_own
  on public.attendance_records;
create policy attendance_records_select_own
  on public.attendance_records
  for select
  to authenticated
  using (user_id = (select auth.uid()));

-- Revocar primero, como en `0038_event_rsvps.sql`: el proyecto concede todo a
-- `anon` y `authenticated` sobre cada tabla nueva. Pasar lista pasa por el
-- servidor.
revoke all on public.attendance_records from anon, authenticated;
grant select on public.attendance_records to authenticated;
grant select, insert, update, delete on public.attendance_records
  to service_role;

notify pgrst, 'reload schema';
