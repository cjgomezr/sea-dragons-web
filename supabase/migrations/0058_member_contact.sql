-- El teléfono propio y el contacto de emergencia del socio (#496, RF-1 del
-- PRD de E19). El club no guardaba ninguno de los dos.
--
-- Nulables a propósito: no se piden al crear la cuenta, y no tenerlos no
-- bloquea nada. El contacto de emergencia va entero o no va, porque un nombre
-- sin teléfono no le sirve a quien tenga que llamar.
--
-- Los teléfonos se guardan tal como se escribieron: los socios son de varios
-- países y ningún formato les conviene a todos. Lo que se exige es que se
-- puedan marcar: dígitos, espacios, guiones, paréntesis y un `+` sólo al
-- principio, con entre 8 y 15 dígitos (el máximo de E.164) y como mucho 30
-- caracteres. Son las reglas de `src/lib/members/profile-contact.ts`.
--
-- Sin privilegios ni policies nuevas. `members_select_own` de
-- `0003_members.sql` deja a cada socio leer sólo su fila, y los `grant` son de
-- tabla, así que alcanzan a estas columnas sin tocar nada. El perfil propio
-- las escribe con la llave de servicio, sólo sobre la fila de quien llama.
--
-- Idempotente como el resto del histórico: `add column if not exists` y cada
-- restricción borrada antes de crearse.

alter table public.members
  add column if not exists phone text,
  add column if not exists emergency_contact_name text,
  add column if not exists emergency_contact_phone text,
  add column if not exists emergency_contact_relationship text;

alter table public.members
  drop constraint if exists members_phone_check;
alter table public.members
  add constraint members_phone_check check (
    phone ~ '^\+?[0-9 ()-]+$'
    and char_length(phone) <= 30
    and char_length(regexp_replace(phone, '[^0-9]', '', 'g')) between 8 and 15
  );

alter table public.members
  drop constraint if exists members_emergency_contact_phone_check;
alter table public.members
  add constraint members_emergency_contact_phone_check check (
    emergency_contact_phone ~ '^\+?[0-9 ()-]+$'
    and char_length(emergency_contact_phone) <= 30
    and char_length(regexp_replace(emergency_contact_phone, '[^0-9]', '', 'g'))
      between 8 and 15
  );

alter table public.members
  drop constraint if exists members_emergency_contact_name_check;
alter table public.members
  add constraint members_emergency_contact_name_check check (
    btrim(emergency_contact_name) <> ''
    and char_length(emergency_contact_name) <= 100
  );

alter table public.members
  drop constraint if exists members_emergency_contact_relationship_check;
alter table public.members
  add constraint members_emergency_contact_relationship_check check (
    btrim(emergency_contact_relationship) <> ''
    and char_length(emergency_contact_relationship) <= 100
  );

-- Las tres o ninguna.
alter table public.members
  drop constraint if exists members_emergency_contact_complete;
alter table public.members
  add constraint members_emergency_contact_complete check (
    num_nonnulls(
      emergency_contact_name,
      emergency_contact_phone,
      emergency_contact_relationship
    ) in (0, 3)
  );
