-- NFR-012 en la base: no existe ninguna cuenta activa de un menor sin el
-- consentimiento de su tutor registrado (FR-082, issue #134).
--
-- La aplicación ya no activa esa cuenta. Estas restricciones son lo que lo
-- garantiza también ante una escritura que no pase por ella: la llave de
-- servicio, una consulta a mano, un script de soporte.
--
-- `0003_members.sql` decía que esto no podía ser un `check` porque "depende de
-- la edad de hoy". Ya no depende: la edad que manda es la del DÍA DEL REGISTRO
-- en Melbourne, que es una columna de la fila (`created_at`). Es la decisión
-- del ticket #134, y `requiresGuardianConsent` en
-- `src/lib/auth/account-activation.ts` la mide exactamente igual.
--
-- `created_at at time zone 'Australia/Melbourne'` es inmutable (el nombre de la
-- zona es constante), así que la restricción da el mismo veredicto hoy que
-- dentro de un año sobre la misma fila.
--
-- Idempotente como el resto del histórico: se borra y se vuelve a crear.

-- Un consentimiento es un hecho con fecha: quién, su correo y cuándo, los tres
-- o ninguno. Una marca de tiempo sin tutor no se podría enseñar a nadie.
-- El `coalesce` no sobra: `btrim(null) <> ''` da null, y un `check` que da null
-- deja pasar la fila, así que sin él entraría un consentimiento sin nombre o
-- sin correo.
alter table public.members
  drop constraint if exists members_guardian_consent_complete;
alter table public.members
  add constraint members_guardian_consent_complete check (
    (guardian_consent_at is null
      and guardian_name is null
      and guardian_email is null)
    or (guardian_consent_at is not null
      and coalesce(btrim(guardian_name), '') <> ''
      and coalesce(btrim(guardian_email), '') <> '')
  );

-- El borde es "menor de 18": quien cumple 18 el mismo día del registro es
-- mayor. Sin fecha de nacimiento no hay menor que proteger todavía, y esa
-- cuenta tampoco se activa, porque la fecha es uno de sus pendientes.
alter table public.members
  drop constraint if exists members_active_minor_requires_guardian_consent;
alter table public.members
  add constraint members_active_minor_requires_guardian_consent check (
    account_status <> 'active'
    or guardian_consent_at is not null
    or date_of_birth is null
    or date_of_birth <= (
      (created_at at time zone 'Australia/Melbourne')::date
      - interval '18 years'
    )::date
  );
