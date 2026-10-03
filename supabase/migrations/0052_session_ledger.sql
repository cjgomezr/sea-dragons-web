-- El saldo de sesiones de cada Casual como un libro (issue #468, RF-1 a RF-3
-- de `docs/prd/e13-stripe-avanzado.md`, D1, D6 y D7).
--
-- El saldo no es un contador que se edita: es la suma de `delta` en
-- `session_ledger`. Un pack comprado suma `+N` ligado a su pago; una
-- asistencia Present o Late guardada siendo Casual resta `-1` ligada a esa
-- fila de asistencia. Corregir la asistencia borra su movimiento, así que el
-- historial explica cada número y una corrección del coach no descuadra nada.
--
-- El estado de un Casual sale del saldo (D1): `active` con saldo, `pending`
-- sin él, salvo una exención vigente, que es del Admin. Lo recalcula
-- `refresh_casual_membership_status`, que disparan los movimientos del libro
-- y el cambio de plan. A un Full o un Student no lo toca: su estado lo sigue
-- moviendo Stripe, y su saldo se queda congelado hasta que vuelva a Casual
-- (D7, FR-087).

-- Destino de la clave compuesta que ata cada compra a un pago del mismo
-- socio. `id` ya es único, así que no cambia qué pagos caben. Va en un bloque
-- porque `add constraint` no tiene `if not exists`.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.payments'::regclass
       and conname = 'payments_id_user_id_club_id_key'
  ) then
    alter table public.payments
      add constraint payments_id_user_id_club_id_key
      unique (id, user_id, club_id);
  end if;
end;
$$;

create table if not exists public.session_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  club_id uuid not null references public.clubs (id),
  delta integer not null
    constraint session_ledger_delta_check check (delta <> 0),
  kind text not null
    constraint session_ledger_kind_check
    check (kind in ('pack_purchase', 'attendance')),
  -- Un pago acredita su pack una sola vez aunque el webhook se repita.
  pack_payment_id uuid
    constraint session_ledger_pack_payment_id_key unique,
  attendance_event_id uuid,
  created_at timestamptz not null default now(),
  -- Cada tipo con su referencia y sólo la suya: una compra suma y nombra su
  -- pago; una asistencia resta una sesión y nombra su entrenamiento.
  constraint session_ledger_reference_check check (
    (kind = 'pack_purchase'
      and delta > 0
      and pack_payment_id is not null
      and attendance_event_id is null)
    or (kind = 'attendance'
      and delta = -1
      and attendance_event_id is not null
      and pack_payment_id is null)
  ),
  -- Una asistencia resta una vez: guardar la hoja otra vez no la duplica.
  constraint session_ledger_attendance_key
    unique (attendance_event_id, user_id),
  -- Borrar la identidad (que borra al socio) se lleva sus movimientos.
  constraint session_ledger_member_same_club_fkey
    foreign key (user_id, club_id)
    references public.members (user_id, club_id) on delete cascade,
  -- El pago es del mismo socio y del mismo club. Sin cascada: un pago que
  -- acreditó sesiones no se borra suelto.
  constraint session_ledger_pack_payment_fkey
    foreign key (pack_payment_id, user_id, club_id)
    references public.payments (id, user_id, club_id),
  -- Quitar la fila de asistencia (la hoja, o el entrenamiento entero) se
  -- lleva su descuento y devuelve la sesión.
  constraint session_ledger_attendance_fkey
    foreign key (attendance_event_id, user_id)
    references public.attendance_records (event_id, user_id)
    on delete cascade
);

-- El saldo de un socio, y la cascada desde su fila de `members`.
create index if not exists session_ledger_user_id_club_id_idx
  on public.session_ledger (user_id, club_id);

alter table public.session_ledger enable row level security;

-- Cada socio ve sólo sus movimientos.
drop policy if exists session_ledger_select_own on public.session_ledger;
create policy session_ledger_select_own
  on public.session_ledger
  for select
  to authenticated
  using (user_id = (select auth.uid()));

-- Revocar primero, como en `0050_memberships.sql`: el proyecto concede todo a
-- `anon` y `authenticated` sobre cada tabla nueva. Escribe sólo el servidor.
revoke all on public.session_ledger from anon, authenticated;
grant select on public.session_ledger to authenticated;
grant select, insert, update, delete on public.session_ledger to service_role;

-- El estado de un Casual según su saldo (D1). No toca otro plan ni una
-- exención vigente; una vencida deja de contar, como al leerla en
-- `src/lib/membership/membership.ts`. Sólo escribe si el estado cambia.
create or replace function public.refresh_casual_membership_status(
  target_user_id uuid,
  target_club_id uuid
)
  returns void
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  derived_status text;
begin
  select case when coalesce(sum(l.delta), 0) > 0
              then 'active' else 'pending' end
    into derived_status
    from public.session_ledger l
   where l.user_id = target_user_id
     and l.club_id = target_club_id;

  update public.memberships m
     set status = derived_status,
         updated_at = now()
   where m.user_id = target_user_id
     and m.club_id = target_club_id
     and m.plan = 'Casual'
     and m.status <> derived_status
     and not (m.status = 'waived'
              and (m.waived_until is null or m.waived_until > now()));
end;
$$;

-- Cualquier movimiento del libro, también el que borra una cascada (un
-- entrenamiento borrado devuelve su sesión), recalcula el estado.
create or replace function public.session_ledger_refresh_status()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform public.refresh_casual_membership_status(old.user_id, old.club_id);
  else
    perform public.refresh_casual_membership_status(new.user_id, new.club_id);
  end if;
  return null;
end;
$$;

drop trigger if exists session_ledger_refresh_status on public.session_ledger;
create trigger session_ledger_refresh_status
  after insert or delete on public.session_ledger
  for each row execute function public.session_ledger_refresh_status();

-- Quien pasa a Casual recupera el saldo que tenía congelado (D7). Lo dispara
-- cualquier escritura del plan: el webhook de Stripe, el alta o el panel.
create or replace function public.memberships_refresh_casual_status()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  perform public.refresh_casual_membership_status(new.user_id, new.club_id);
  return null;
end;
$$;

drop trigger if exists memberships_refresh_casual_status
  on public.memberships;
create trigger memberships_refresh_casual_status
  after insert or update of plan on public.memberships
  for each row
  when (new.plan = 'Casual')
  execute function public.memberships_refresh_casual_status();

-- Acreditar un pack pagado (RF-1). Lo llama el webhook de packs con la llave
-- de servicio. Responde `credited`, o `duplicate` si ese pago ya se acreditó.
create or replace function public.credit_session_pack(
  user_id uuid,
  club_id uuid,
  sessions integer,
  payment_id uuid
)
  returns text
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
begin
  insert into public.session_ledger
    (user_id, club_id, delta, kind, pack_payment_id)
  values
    (credit_session_pack.user_id, credit_session_pack.club_id, sessions,
     'pack_purchase', payment_id)
  on conflict (pack_payment_id) do nothing;

  if not found then
    return 'duplicate';
  end if;
  return 'credited';
end;
$$;

-- `save_attendance_sheet` de `0044` con el descuento dentro (RF-1): la
-- asistencia y el saldo se escriben en la misma transacción y no se separan
-- nunca. Misma firma y mismo retorno.
--
-- Antes de tocar nada se bloquean, en orden, las membresías de quien sale en
-- la hoja nueva o en la anterior. Dos hojas de entrenamientos distintos con
-- el mismo Casual esperan una a la otra, así que no gastan dos veces su
-- última sesión, y el orden evita que se bloqueen mutuamente.
--
-- Quien sale de la hoja pierde su movimiento por la cascada de la fila de
-- asistencia; quien queda Absent lo pierde aquí. Quien queda Present o Late
-- siendo Casual y no tiene ya su movimiento resta uno si le queda saldo; sin
-- saldo no resta (D1) y deja una línea en el log.
create or replace function public.save_attendance_sheet(
  acting_club_id uuid,
  acting_user_id uuid,
  target_event_id uuid,
  records jsonb
)
  returns text
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  target public.events%rowtype;
  attendee uuid;
begin
  select * into target
    from public.events e
   where e.id = target_event_id
     and e.club_id = acting_club_id
     for update;

  if not found or target.event_type <> 'training' then
    return 'not_found';
  end if;
  if target.status = 'cancelled' then
    return 'cancelled';
  end if;
  if target.starts_at > now() then
    return 'not_started';
  end if;

  perform 1
     from public.memberships m
    where m.club_id = acting_club_id
      and (m.user_id in (
             select (row ->> 'user_id')::uuid
               from jsonb_array_elements(records) as row)
           or m.user_id in (
             select a.user_id
               from public.attendance_records a
              where a.event_id = target_event_id))
    order by m.user_id
      for update;

  delete from public.attendance_records a
   where a.event_id = target_event_id
     and a.user_id not in (
       select (row ->> 'user_id')::uuid
         from jsonb_array_elements(records) as row
     );

  insert into public.attendance_records
    (event_id, user_id, club_id, status, recorded_by, recorded_at)
  select target_event_id,
         (row ->> 'user_id')::uuid,
         acting_club_id,
         row ->> 'status',
         acting_user_id,
         now()
    from jsonb_array_elements(records) as row
  on conflict (event_id, user_id)
  do update set status = excluded.status,
                recorded_by = excluded.recorded_by,
                recorded_at = excluded.recorded_at;

  delete from public.session_ledger l
   using public.attendance_records a
   where l.attendance_event_id = target_event_id
     and a.event_id = l.attendance_event_id
     and a.user_id = l.user_id
     and a.status = 'absent';

  for attendee in
    select a.user_id
      from public.attendance_records a
      join public.memberships m
        on m.user_id = a.user_id and m.club_id = a.club_id
     where a.event_id = target_event_id
       and a.status in ('present', 'late')
       and m.plan = 'Casual'
       and not exists (
         select 1 from public.session_ledger l
          where l.attendance_event_id = a.event_id
            and l.user_id = a.user_id)
  loop
    if (select coalesce(sum(l.delta), 0)
          from public.session_ledger l
         where l.user_id = attendee
           and l.club_id = acting_club_id) > 0 then
      insert into public.session_ledger
        (user_id, club_id, delta, kind, attendance_event_id)
      values (attendee, acting_club_id, -1, 'attendance', target_event_id);
    else
      raise log 'save_attendance_sheet: % sin saldo en el entrenamiento %, no se descuenta',
        attendee, target_event_id;
    end if;
  end loop;

  return 'saved';
end;
$$;

-- Como `0044`: Postgres concede `execute` a PUBLIC en toda función nueva, y
-- el `pg_default_acl` de Supabase además a `anon` y `authenticated`. Abierta
-- a ellos, cualquiera podría regalarse sesiones o ponerse al día. Las
-- funciones internas y las de los triggers no las llama nadie de fuera.
revoke all on function public.credit_session_pack(uuid, uuid, integer, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.credit_session_pack(uuid, uuid, integer, uuid)
  to service_role;

revoke all on function public.refresh_casual_membership_status(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.session_ledger_refresh_status()
  from public, anon, authenticated, service_role;
revoke all on function public.memberships_refresh_casual_status()
  from public, anon, authenticated, service_role;

revoke all on function public.save_attendance_sheet(uuid, uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.save_attendance_sheet(uuid, uuid, uuid, jsonb)
  to service_role;

notify pgrst, 'reload schema';
