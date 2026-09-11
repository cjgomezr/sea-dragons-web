-- La tabla del socio del club: FR-001 (nombre, correo, país), FR-009 (tipo de
-- membresía), FR-081 (fecha de nacimiento), FR-082 (tutor de un menor), FR-008
-- y FR-012 (el rol y su conjunto de cuatro) y FR-083 (el estado de cuenta).
-- Sigue el patrón de `0001_clubs.sql`: club_id, RLS activo y policy explícita.
--
-- QUÉ ES ESTA TABLA Y QUÉ NO. La identidad vive en `auth.users`, el esquema de
-- Supabase Auth: ahí están la contraseña, la sesión y la confirmación del
-- correo, y nada de eso se duplica aquí. Esta tabla guarda al socio del club y
-- apunta a su identidad con `user_id`. Son dos cosas, con dos dueños: Supabase
-- Auth escribe la primera, este repositorio la segunda.
--
-- Al borrar la identidad se borra el socio (`on delete cascade`). Es la
-- decisión deliberada: un socio cuya identidad ya no existe es una fila a la
-- que nadie puede volver a entrar y que sigue guardando datos personales, que
-- es justo lo que NFR-012 y el riesgo de privacidad del SRD piden no tener.
-- Lo que la baja de un socio necesita no es borrarlo, es `account_status =
-- 'inactive'` (FR-085, E5), y eso no toca la identidad.

create table if not exists public.members (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id),
  -- `unique`: un socio por identidad, ni dos filas para la misma persona ni una
  -- fila sin forma de entrar. `not null` porque en Release 1 todo socio nace de
  -- un registro (FR-001); si alguna vez un Admin crea socios sin cuenta, eso
  -- será una migración que lo permita, no un hueco abierto por si acaso.
  user_id uuid not null unique references auth.users (id) on delete cascade,
  full_name text not null,
  -- Copia del correo de la identidad, no su fuente: el directorio (E4) y los
  -- avisos (E11) lo leen por club sin tener que cruzar el esquema `auth`, al
  -- que la API no llega con la llave anónima.
  email text not null,
  -- Nulables por FR-083, no por descuido: una cuenta nace `incomplete`
  -- precisamente porque le faltan el país, la fecha de nacimiento o el tipo de
  -- membresía, y la pantalla de completar registro es la que los rellena. El
  -- `check` sigue cerrando el conjunto de valores para todo lo que no sea null.
  country text,
  date_of_birth date,
  membership_type text check (membership_type in ('Full', 'Student', 'Casual')),
  -- FR-008: toda cuenta nace Player. FR-012: exactamente cuatro roles, y quien
  -- los cierra es la base (AC-048), no un `if` de la aplicación. La matriz de
  -- permisos por rol es E3; aquí el rol es una columna con su conjunto.
  role text not null default 'Player'
    check (role in ('Admin', 'Coach', 'Committee', 'Player')),
  -- FR-083 y NFR-012: `incomplete` hasta que no falte nada, y un solo estado
  -- para "faltan datos" y "falta el consentimiento del tutor" (decisión B2 de
  -- docs/preguntas-abiertas.md). `inactive` existe porque lo va a escribir la
  -- baja de socios (FR-085, E5); nada de Release 1 lo escribe todavía.
  account_status text not null default 'incomplete'
    check (account_status in ('incomplete', 'active', 'inactive')),
  -- FR-082: para un menor de 18, nombre y correo del tutor más el instante en
  -- que quedó registrado su consentimiento. Nulables porque la mayoría de los
  -- socios son mayores de edad. Que un menor no se active sin consentimiento es
  -- una regla de registro (FR-083), no un `check`: depende de la edad de hoy y
  -- una restricción sólo puede mirar la fila.
  guardian_name text,
  guardian_email text,
  guardian_consent_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.members enable row level security;

-- Un miembro ve su propia fila y nada más. El directorio del club (FR-015, E4)
-- es lo que ampliará esto a "las filas de mi club", y entonces `club_id` pasará
-- a ser el filtro de la policy; mientras no exista ese requisito, la frontera
-- más estrecha que cumple el ticket es la propia fila.
--
-- `(select auth.uid())` y no `auth.uid()` a pelo: envuelta en un subselect
-- Postgres la evalúa una vez para toda la consulta en vez de una vez por fila.
drop policy if exists members_select_own on public.members;
create policy members_select_own
  on public.members
  for select
  to authenticated
  using (user_id = (select auth.uid()));

-- Sin policy de insert, update ni delete para `authenticated` ni `anon`: sin
-- policy, RLS las niega todas. El registro (que crea la fila) y la edición del
-- propio perfil (FR-084, E5) llegan en sus tickets, cada uno con la policy que
-- necesite y con el `grant` por columna que deje fuera `role` y
-- `account_status`: esos dos no los mueve el dueño de la fila, ni por la
-- interfaz ni atacando la API directamente (AC-039).
--
-- El `revoke` no es decorativo y no sobra. En un Supabase de verdad toda tabla
-- nueva del esquema `public` nace con TODOS los privilegios concedidos a `anon`
-- y a `authenticated` (verificado en `pg_default_acl` del proyecto de
-- desarrollo), al contrario de lo que pasa en el Postgres limpio del workflow
-- de migraciones. Sin quitarlos, `0001` y `0002` dependen sólo de RLS para
-- negar la escritura, y el esquema que el repositorio declara no es el que la
-- base tiene. Con ellos quitados, los dos sustratos coinciden y el `grant` de
-- abajo vuelve a decir la verdad sobre quién puede qué.
revoke all on public.members from anon, authenticated;
grant select on public.members to authenticated;
grant select, insert, update, delete on public.members to service_role;
