-- El idioma de los correos de cada socio (E17, RF-6; issue #187).
--
-- Los dos correos del club (confirmar la cuenta y recuperar la contraseña)
-- salen después de responder, a veces mucho después de la petición, así que no
-- pueden mirar la cookie de quien navega. El registro guarda aquí el idioma que
-- tenía la aplicación, y los envíos lo leen de la fila.
--
-- El valor por defecto es el español a propósito, aunque la aplicación caiga
-- en inglés cuando no tiene ninguna pista: `add column` con `default` rellena
-- las filas que ya existían, y esos socios se registraron con la aplicación en
-- español. El registro escribe siempre la columna, así que el defecto sólo
-- alcanza a esas filas y a una escritura hecha a mano.
--
-- La lista es la de `SUPPORTED_LOCALES` en `src/lib/i18n/locale.ts`. Un tercer
-- idioma tiene que añadirse en los dos sitios; si sólo se añade en la
-- aplicación, la base rechaza el registro en vez de guardar un idioma que los
-- correos no sabrían leer.
--
-- Sin privilegios nuevos: `0003_members.sql` ya deja a `authenticated` sólo
-- leer su fila, y la escribe el servidor con la llave de servicio.
--
-- Idempotente como el resto del histórico.

alter table public.members
  add column if not exists email_locale text not null default 'es';

alter table public.members
  drop constraint if exists members_email_locale_check;
alter table public.members
  add constraint members_email_locale_check check (
    email_locale in ('en', 'es')
  );
