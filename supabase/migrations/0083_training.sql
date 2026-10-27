-- La sección Entrenamiento: ejercicios, marcas, ciclos, semanas, rutinas y
-- la cuadrícula de días (issue #896, RF-1 y D4 a D13 de
-- `docs/prd/e35-entrenamiento.md`). Parte de
-- `docs/design/design_handoff_training/DATA_MODEL.md`, con los cambios del
-- PRD, que manda cuando no coinciden.
--
-- Todo lo escribe el servidor con la llave de servicio (D4): la API comprueba
-- el rol y la membresía y deja la bitácora. Con la sesión sólo se lee, y la
-- base decide qué: las marcas de cada socio sólo las ve su dueño (D11), y el
-- plan sólo quien está al día o lo planifica (D2, D3).
--
-- Producción reaplica el histórico entero en cada merge: todo es
-- `if not exists`, `create or replace` o `drop ... if exists`.

-- Los ejercicios de la biblioteca (D12) no son de ningún club: `club_id`
-- nulo. Los del club (D13) sí. La carga de la biblioteca es un script aparte,
-- no esta migración.
create table if not exists public.training_exercises (
  id uuid primary key default gen_random_uuid(),
  club_id uuid references public.clubs (id),
  name text not null
    constraint training_exercises_name_length
    check (char_length(btrim(name)) between 1 and 80),
  -- `search_normalize` (`0049`) y no `unaccent` a secas, que no es
  -- `immutable` y una columna generada no lo admite.
  name_normalized text
    generated always as (public.search_normalize(btrim(name))) stored,
  tips text[] not null default '{}',
  -- Un enlace `https://` o un texto de búsqueda; nulo busca por el nombre.
  youtube text,
  -- En el bucket `training-exercise-images`.
  image_start_path text,
  image_end_path text,
  source text not null
    constraint training_exercises_source_check
    check (source in ('library', 'club')),
  -- El id de free-exercise-db: volver a cargar la biblioteca no duplica.
  library_key text constraint training_exercises_library_key_key unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint training_exercises_scope_check
    check ((source = 'library') = (club_id is null))
);

-- Un nombre por ámbito: el club o la biblioteca. Que el club no repita uno de
-- la biblioteca lo comprueba la API (#903), porque son ámbitos distintos.
create unique index if not exists training_exercises_name_per_scope_key
  on public.training_exercises (
    coalesce(club_id, '00000000-0000-0000-0000-000000000000'::uuid),
    name_normalized
  );

-- Las marcas que define el club (D11): por ahora sólo kilos.
create table if not exists public.training_marks (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id),
  name text not null
    constraint training_marks_name_length
    check (char_length(btrim(name)) between 1 and 60),
  unit text not null default 'kg'
    constraint training_marks_unit_check check (unit in ('kg')),
  sort_order smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint training_marks_club_id_name_key unique (club_id, name),
  -- El destino de las claves compuestas: nada cuelga de la marca de otro club.
  constraint training_marks_id_club_id_key unique (id, club_id)
);

-- El valor de cada socio, privado (D11). Borrar la marca se lleva los valores
-- (la pantalla avisa antes); borrar al socio, también.
create table if not exists public.training_member_marks (
  user_id uuid not null,
  club_id uuid not null references public.clubs (id),
  mark_id uuid not null,
  -- Un decimal como mucho, de más de 0 hasta 500 kg.
  value numeric(4, 1) not null
    constraint training_member_marks_value_check
    check (value > 0 and value <= 500),
  updated_at timestamptz not null default now(),
  constraint training_member_marks_pkey primary key (user_id, mark_id),
  constraint training_member_marks_member_same_club_fkey
    foreign key (user_id, club_id)
    references public.members (user_id, club_id) on delete cascade,
  constraint training_member_marks_mark_same_club_fkey
    foreign key (mark_id, club_id)
    references public.training_marks (id, club_id) on delete cascade
);

-- Borrar una marca busca sus valores por la marca.
create index if not exists training_member_marks_mark_id_idx
  on public.training_member_marks (mark_id);

create table if not exists public.training_cycles (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id),
  name text not null
    constraint training_cycles_name_length
    check (char_length(btrim(name)) between 1 and 80),
  -- El evento objetivo, opcional (D5).
  event_name text
    constraint training_cycles_event_name_length
    check (char_length(event_name) <= 80),
  event_date date,
  -- El lunes de la semana 1, que la API calcula (D5).
  start_date date not null
    constraint training_cycles_start_date_monday_check
    check (extract(isodow from start_date) = 1),
  weeks smallint not null
    constraint training_cycles_weeks_check check (weeks between 1 and 52),
  status text not null default 'draft'
    constraint training_cycles_status_check
    check (status in ('draft', 'active', 'archived')),
  -- Nulo si quien lo creó ya no está en el club; el ciclo se queda.
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint training_cycles_id_club_id_key unique (id, club_id),
  constraint training_cycles_creator_same_club_fkey
    foreign key (created_by, club_id)
    references public.members (user_id, club_id)
    on delete set null (created_by)
);

-- Un solo ciclo activo por club (D5): activar otro archiva el anterior en la
-- misma transacción, y si no, esto lo rechaza.
create unique index if not exists training_cycles_one_active_per_club
  on public.training_cycles (club_id)
  where status = 'active';

-- Lo que creó cada quien, para el `set null` cuando se va.
create index if not exists training_cycles_created_by_club_id_idx
  on public.training_cycles (created_by, club_id);

-- La nota y la dosis de cada semana (D6). Sin fila, la semana no tiene ni una
-- ni otra. Que `week_no` no pase de las semanas del ciclo lo comprueba la API.
create table if not exists public.training_cycle_weeks (
  club_id uuid not null references public.clubs (id),
  cycle_id uuid not null,
  week_no smallint not null
    constraint training_cycle_weeks_week_no_check
    check (week_no between 1 and 52),
  note text
    constraint training_cycle_weeks_note_length
    check (char_length(note) <= 140),
  dose_sets smallint
    constraint training_cycle_weeks_dose_sets_check
    check (dose_sets between 1 and 99),
  dose_reps text
    constraint training_cycle_weeks_dose_reps_length
    check (char_length(dose_reps) <= 20),
  dose_intensity_kind text not null default 'none'
    constraint training_cycle_weeks_dose_intensity_kind_check
    check (dose_intensity_kind in ('none', 'pct', 'text')),
  dose_pct numeric(4, 1)
    constraint training_cycle_weeks_dose_pct_range
    check (dose_pct between 1 and 150),
  dose_text text
    constraint training_cycle_weeks_dose_text_length
    check (char_length(dose_text) <= 20),
  constraint training_cycle_weeks_dose_pct_check
    check ((dose_intensity_kind = 'pct') = (dose_pct is not null)),
  constraint training_cycle_weeks_dose_text_check
    check ((dose_intensity_kind = 'text') = (dose_text is not null)),
  constraint training_cycle_weeks_pkey primary key (cycle_id, week_no),
  constraint training_cycle_weeks_cycle_same_club_fkey
    foreign key (cycle_id, club_id)
    references public.training_cycles (id, club_id) on delete cascade
);

-- Una rutina es del ciclo o compartida, con `cycle_id` nulo (D8). El color es
-- un índice de la paleta: cada tema pinta el suyo (D15).
create table if not exists public.training_routines (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id),
  cycle_id uuid,
  name text not null
    constraint training_routines_name_length
    check (char_length(btrim(name)) between 1 and 60),
  color_index smallint not null
    constraint training_routines_color_index_check
    check (color_index between 0 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint training_routines_id_club_id_key unique (id, club_id),
  -- Con `cycle_id` nulo la clave no se comprueba: es una compartida.
  constraint training_routines_cycle_same_club_fkey
    foreign key (cycle_id, club_id)
    references public.training_cycles (id, club_id) on delete cascade
);

create index if not exists training_routines_cycle_id_idx
  on public.training_routines (cycle_id);

-- Una fila es un ejercicio o un título de sección (D9), con una de cuatro
-- cargas (D10).
create table if not exists public.training_routine_items (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id),
  routine_id uuid not null,
  position smallint not null,
  kind text not null
    constraint training_routine_items_kind_check
    check (kind in ('exercise', 'section')),
  section_title text
    constraint training_routine_items_section_title_length
    check (char_length(btrim(section_title)) between 1 and 60),
  -- Sin `on delete`: no se borra un ejercicio en uso. Puede ser de la
  -- biblioteca, sin club, así que la clave es simple; el club la comprueba la
  -- API.
  exercise_id uuid
    constraint training_routine_items_exercise_id_fkey
    references public.training_exercises (id),
  -- Nulas si la fila no lleva series (un "400 m").
  sets smallint
    constraint training_routine_items_sets_check check (sets between 1 and 99),
  reps text
    constraint training_routine_items_reps_length
    check (char_length(reps) <= 20),
  rest text
    constraint training_routine_items_rest_length
    check (char_length(rest) <= 20),
  load_kind text not null default 'none'
    constraint training_routine_items_load_kind_check
    check (load_kind in ('none', 'pct', 'week', 'text')),
  load_mark_id uuid,
  load_pct numeric(4, 1)
    constraint training_routine_items_load_pct_range
    check (load_pct > 0 and load_pct <= 150),
  load_text text
    constraint training_routine_items_load_text_length
    check (char_length(load_text) <= 30),
  note text
    constraint training_routine_items_note_length
    check (char_length(note) <= 200),
  -- Un título no lleva ejercicio, dosis ni carga; un ejercicio no lleva
  -- título.
  constraint training_routine_items_kind_shape_check check (
    (kind = 'section'
     and section_title is not null
     and exercise_id is null
     and sets is null and reps is null and rest is null
     and load_kind = 'none')
    or (kind = 'exercise'
        and section_title is null
        and exercise_id is not null)
  ),
  -- El % fijo y la dosis de la semana se calculan sobre una marca.
  constraint training_routine_items_load_mark_check
    check ((load_kind in ('pct', 'week')) = (load_mark_id is not null)),
  constraint training_routine_items_load_pct_check
    check ((load_kind = 'pct') = (load_pct is not null)),
  constraint training_routine_items_load_text_check
    check ((load_kind = 'text') = (load_text is not null)),
  constraint training_routine_items_routine_same_club_fkey
    foreign key (routine_id, club_id)
    references public.training_routines (id, club_id) on delete cascade,
  -- Sin `on delete`: no se borra una marca en uso.
  constraint training_routine_items_load_mark_fkey
    foreign key (load_mark_id, club_id)
    references public.training_marks (id, club_id)
);

create index if not exists training_routine_items_routine_id_position_idx
  on public.training_routine_items (routine_id, position);
-- Las dos sirven al borrado de un ejercicio o una marca, que mira si se usan.
create index if not exists training_routine_items_exercise_id_idx
  on public.training_routine_items (exercise_id);
create index if not exists training_routine_items_load_mark_id_idx
  on public.training_routine_items (load_mark_id)
  where load_mark_id is not null;

-- La cuadrícula: hasta dos rutinas por día (D7). Sin fila, el día es de
-- descanso. Borrar una rutina deja sus días en descanso.
create table if not exists public.training_cycle_days (
  club_id uuid not null references public.clubs (id),
  cycle_id uuid not null,
  week_no smallint not null
    constraint training_cycle_days_week_no_check
    check (week_no between 1 and 52),
  -- 0 es el lunes.
  weekday smallint not null
    constraint training_cycle_days_weekday_check
    check (weekday between 0 and 6),
  slot smallint not null
    constraint training_cycle_days_slot_check check (slot in (1, 2)),
  routine_id uuid not null,
  constraint training_cycle_days_pkey
    primary key (cycle_id, week_no, weekday, slot),
  constraint training_cycle_days_cycle_same_club_fkey
    foreign key (cycle_id, club_id)
    references public.training_cycles (id, club_id) on delete cascade,
  constraint training_cycle_days_routine_same_club_fkey
    foreign key (routine_id, club_id)
    references public.training_routines (id, club_id) on delete cascade
);

create index if not exists training_cycle_days_routine_id_idx
  on public.training_cycle_days (routine_id);

-- La regla de estar al día de `isStandingCurrent`
-- (`src/lib/membership/membership.ts`, D1 de E12), para que RLS la aplique.
-- Una exención vencida vale lo que digan las fechas de Stripe. Un test la ata
-- a la de TypeScript para que no se separen.
create or replace function public.is_membership_current(
  membership_status text,
  stripe_subscription_id text,
  trial_end timestamptz,
  current_period_end timestamptz,
  waived_until timestamptz,
  at_time timestamptz
)
  returns boolean
  language sql
  immutable
  set search_path = ''
as $$
  select coalesce(
    case
      when membership_status = 'waived'
           and waived_until is not null
           and waived_until <= at_time
        then stripe_subscription_id is not null
             and (trial_end > at_time or current_period_end > at_time)
      else membership_status in ('trialing', 'active', 'waived')
    end,
    false
  )
$$;

-- Si quien pregunta planifica en el club: Admin o Coach (D3).
create or replace function public.is_training_planner(target_club_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select exists (
    select 1
      from public.members m
     where m.user_id = (select auth.uid())
       and m.club_id = target_club_id
       and m.account_status <> 'inactive'
       and m.role in ('Admin', 'Coach')
  )
$$;

-- Si quien pregunta ve el plan del club: lo planifica o está al día (D2).
-- `security definer` porque la membresía no la lee nadie más que su dueño, y
-- responde sólo por quien pregunta.
create or replace function public.has_training_access(target_club_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select public.is_training_planner(target_club_id)
      or exists (
        select 1
          from public.members m
          join public.memberships ms
            on ms.user_id = m.user_id and ms.club_id = m.club_id
         where m.user_id = (select auth.uid())
           and m.club_id = target_club_id
           and m.account_status <> 'inactive'
           and public.is_membership_current(
                 ms.status, ms.stripe_subscription_id, ms.trial_end,
                 ms.current_period_end, ms.waived_until, now())
      )
$$;

-- Toda función nueva nace ejecutable por los tres roles de la API. La regla
-- pura la usan las de abajo como dueñas; las de las policies, quien tiene
-- sesión.
revoke all on function public.is_membership_current(
  text, text, timestamptz, timestamptz, timestamptz, timestamptz
) from public, anon, authenticated;
grant execute on function public.is_membership_current(
  text, text, timestamptz, timestamptz, timestamptz, timestamptz
) to service_role;
revoke all on function public.is_training_planner(uuid) from public, anon;
grant execute on function public.is_training_planner(uuid)
  to authenticated, service_role;
revoke all on function public.has_training_access(uuid) from public, anon;
grant execute on function public.has_training_access(uuid)
  to authenticated, service_role;

-- Privilegios: revocar primero, porque el proyecto concede todo por defecto
-- (skill `nextjs-supabase-practices`, §1). Con la sesión sólo se lee.
do $$
declare
  target text;
begin
  foreach target in array array[
    'training_exercises', 'training_marks', 'training_member_marks',
    'training_cycles', 'training_cycle_weeks', 'training_routines',
    'training_routine_items', 'training_cycle_days'
  ] loop
    execute format('alter table public.%I enable row level security', target);
    execute format('revoke all on public.%I from anon, authenticated', target);
    execute format('grant select on public.%I to authenticated', target);
    execute format(
      'grant select, insert, update, delete on public.%I to service_role',
      target
    );
  end loop;
end;
$$;

-- La biblioteca la lee cualquiera con sesión; lo del club, sus socios.
drop policy if exists training_exercises_select on public.training_exercises;
create policy training_exercises_select
  on public.training_exercises
  for select
  to authenticated
  using (
    club_id is null
    or exists (
      select 1
        from public.members m
       where m.user_id = (select auth.uid())
         and m.club_id = training_exercises.club_id
         and m.account_status <> 'inactive'
    )
  );

drop policy if exists training_marks_select_club on public.training_marks;
create policy training_marks_select_club
  on public.training_marks
  for select
  to authenticated
  using (
    exists (
      select 1
        from public.members m
       where m.user_id = (select auth.uid())
         and m.club_id = training_marks.club_id
         and m.account_status <> 'inactive'
    )
  );

-- Sólo el dueño. Sin policy para el Coach ni el Admin, a propósito (D11):
-- las cuentas que ven las da el servidor.
drop policy if exists training_member_marks_select_own
  on public.training_member_marks;
create policy training_member_marks_select_own
  on public.training_member_marks
  for select
  to authenticated
  using (user_id = (select auth.uid()));

-- El activo, quien está al día; borradores y archivados, quien planifica.
drop policy if exists training_cycles_select on public.training_cycles;
create policy training_cycles_select
  on public.training_cycles
  for select
  to authenticated
  using (
    (status = 'active' and public.has_training_access(club_id))
    or public.is_training_planner(club_id)
  );

-- Semanas y días se leen con su ciclo: la subconsulta pasa por la policy de
-- arriba.
drop policy if exists training_cycle_weeks_select
  on public.training_cycle_weeks;
create policy training_cycle_weeks_select
  on public.training_cycle_weeks
  for select
  to authenticated
  using (
    exists (
      select 1
        from public.training_cycles c
       where c.id = training_cycle_weeks.cycle_id
    )
  );

drop policy if exists training_cycle_days_select on public.training_cycle_days;
create policy training_cycle_days_select
  on public.training_cycle_days
  for select
  to authenticated
  using (
    exists (
      select 1
        from public.training_cycles c
       where c.id = training_cycle_days.cycle_id
    )
  );

-- Una compartida se lee como un ciclo activo; una del ciclo, con su ciclo.
drop policy if exists training_routines_select on public.training_routines;
create policy training_routines_select
  on public.training_routines
  for select
  to authenticated
  using (
    public.is_training_planner(club_id)
    or (
      public.has_training_access(club_id)
      and (
        cycle_id is null
        or exists (
          select 1
            from public.training_cycles c
           where c.id = training_routines.cycle_id
        )
      )
    )
  );

drop policy if exists training_routine_items_select
  on public.training_routine_items;
create policy training_routine_items_select
  on public.training_routine_items
  for select
  to authenticated
  using (
    exists (
      select 1
        from public.training_routines r
       where r.id = training_routine_items.routine_id
    )
  );

-- Las fotos de los ejercicios (D12, D13). Público como las de la biblioteca,
-- que son de dominio público: las del club no son más privadas que su nombre.
-- Sólo escribe el servidor, así que no hay policy sobre `storage.objects`.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'training-exercise-images',
  'training-exercise-images',
  true,
  -- 5 MB por foto (RF-10).
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Como en `0008_sonda_salud.sql`: que PostgREST vea las tablas en cuanto se
-- aplica.
notify pgrst, 'reload schema';
