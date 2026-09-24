-- Los datos de club de la ficha del socio: posición, nivel de experiencia,
-- género, registro federativo (AUF) y desde cuándo es socio (FR-020, RF-1 del
-- PRD de E5, issue #237).
--
-- Son lo que el directorio (FR-015), el perfil propio (FR-084) y el alta por el
-- Admin (AC-011) necesitan leer y escribir. Este ticket sólo pone las columnas
-- y sus reglas: ni endpoints ni pantallas.
--
-- Posición y nivel se guardan con la grafía del SRD, en inglés, y las pantallas
-- los traducen con claves del catálogo. El género se guarda como código y no
-- como texto libre por el mismo motivo, y para que "prefiero no decirlo"
-- (`undisclosed`) sea un valor de verdad en vez de un campo vacío.
--
-- Los tres conjuntos van como `check`, igual que `role` y `account_status` en
-- `0003_members.sql`: quien los cierra es la base, no un `if` de la aplicación.
--
-- Sin privilegios ni policies nuevas. `0003_members.sql` ya deja a
-- `authenticated` sólo leer su propia fila, y los `grant` son de tabla, así que
-- alcanzan a estas columnas sin tocar nada. Quién puede escribir el AUF
-- (sólo el Admin, BR-008) es la matriz de permisos de la API, y llega con el
-- ticket de la ficha reservada al Admin.
--
-- Idempotente como el resto del histórico: `add column if not exists` y cada
-- restricción borrada antes de crearse.

alter table public.members
  add column if not exists position text,
  add column if not exists experience_level text,
  add column if not exists gender text,
  add column if not exists auf_number text,
  add column if not exists auf_expiry date;

-- `0025_club_positions.sql` sustituyó este `check` por el catálogo de
-- posiciones del club. Al repetirse el histórico no puede volver: rechazaría
-- a quien tenga una posición que el club añadió, y la migración caería en
-- rojo. Por eso sólo se pone mientras el catálogo no existe.
do $$
begin
  if to_regclass('public.club_positions') is null then
    alter table public.members
      drop constraint if exists members_position_check;
    alter table public.members
      add constraint members_position_check check (
        position in ('Goalkeeper', 'Defender', 'Forward')
      );
  end if;
end
$$;

alter table public.members
  drop constraint if exists members_experience_level_check;
alter table public.members
  add constraint members_experience_level_check check (
    experience_level in ('Beginner', 'Intermediate', 'Advanced')
  );

alter table public.members
  drop constraint if exists members_gender_check;
alter table public.members
  add constraint members_gender_check check (
    gender in ('female', 'male', 'non_binary', 'undisclosed')
  );

-- Un registro federativo en blanco no es "no tiene": para eso está el nulo, y
-- BR-008 pide saber cuál de los dos es. `btrim` para que una cadena de espacios
-- no pase por un número puesto al día.
alter table public.members
  drop constraint if exists members_auf_number_length;
alter table public.members
  add constraint members_auf_number_length check (
    char_length(btrim(auf_number)) >= 1
    and char_length(btrim(auf_number)) <= 40
  );

-- `auf_expiry` no lleva restricción a propósito. Que un vencimiento no pueda
-- ser anterior a la fecha de ingreso es regla de la aplicación (ticket de la
-- ficha del Admin): una fecha vieja importada no debe impedir guardar la fila.

-- `joined_on` llega en tres pasos porque los dos obvios están mal. Añadirla ya
-- con `not null` falla si hay filas, y añadirla con el `default` puesto rellena
-- las que existen con HOY, que es justo lo que este ticket no quiere: un socio
-- de 2023 no ingresó el día de la migración. Así que primero la columna vacía,
-- después el relleno desde `created_at`, y sólo entonces el defecto y la
-- obligatoriedad.
alter table public.members
  add column if not exists joined_on date;

-- `where joined_on is null` es lo que hace idempotente el relleno: en la
-- segunda corrida no hay ninguna fila que tocar, así que una fecha corregida a
-- mano después de la primera no se pisa.
--
-- La fecha se mide en la hora local del club y no en la del servidor (NFR-003).
-- Un socio registrado a las 23:30 UTC de un 5 de marzo ingresó el 6 en
-- Melbourne, y el club cuenta sus días, no los de UTC.
update public.members
   set joined_on = (created_at at time zone 'Australia/Melbourne')::date
 where joined_on is null;

-- El defecto se mide en la misma zona, por el mismo motivo y para que la
-- columna no se contradiga consigo misma: durante las diez horas diarias en que
-- Melbourne ya está en el día siguiente, `current_date` le habría puesto ayer.
alter table public.members
  alter column joined_on set default (
    (now() at time zone 'Australia/Melbourne')::date
  );
alter table public.members
  alter column joined_on set not null;
