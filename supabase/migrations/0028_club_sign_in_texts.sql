-- Los textos del inicio de sesión que escribe el club (#301, RF-5 del PRD de
-- E18a): el lema y el párrafo de bienvenida del panel de marca. Hasta aquí
-- eran las claves `auth.brand.headline` y `auth.brand.copy` de los catálogos,
-- escritas para este club.
--
-- Una fila por idioma, como los nombres de las posiciones (`0025`, decisión
-- D2 del PRD). Sin fila, o con el texto nulo, la pantalla usa el del catálogo
-- en ese idioma: eso se decide al leer, no aquí.

create table if not exists public.club_sign_in_texts (
  -- En cascada, como las posiciones: la limpieza de los clubes desechables de
  -- las pruebas de integración borra el club entero.
  club_id uuid not null references public.clubs (id) on delete cascade,
  locale text not null
    constraint club_sign_in_texts_locale_check check (locale in ('en', 'es')),
  -- Nulo es "el de la aplicación", nunca la cadena vacía: se mide recortado,
  -- así que sólo espacios tampoco vale. Los límites caben a 375 px sin
  -- desbordar el panel de marca.
  tagline text
    constraint club_sign_in_texts_tagline_length
    check (char_length(btrim(tagline)) between 1 and 140),
  welcome text
    constraint club_sign_in_texts_welcome_length
    check (char_length(btrim(welcome)) between 1 and 320),
  constraint club_sign_in_texts_pkey primary key (club_id, locale)
);

alter table public.club_sign_in_texts enable row level security;

-- La pantalla de entrar los enseña antes de que nadie inicie sesión, así que
-- `anon` los lee, igual que la marca en `0022_club_brand.sql`. No son datos
-- de nadie: es lo que el club publica en su portada.
drop policy if exists club_sign_in_texts_select_public
  on public.club_sign_in_texts;
create policy club_sign_in_texts_select_public
  on public.club_sign_in_texts
  for select
  to anon, authenticated
  using (true);

-- Revocar primero: el proyecto concede todo a `anon` y `authenticated` sobre
-- cada tabla nueva. Escribir es de la llave de servicio; la pantalla del
-- Admin pasa por el servidor.
revoke all on public.club_sign_in_texts from anon, authenticated;
grant select on public.club_sign_in_texts to anon, authenticated;
grant select, insert, update, delete on public.club_sign_in_texts
  to service_role;
