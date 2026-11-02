-- Las redes del club (#963, RF-1 y D1 a D3 del PRD de E37): un enlace por
-- red, que el Admin pega en la sección Redes de la configuración. Una fila
-- por red puesta; quitar una red borra su fila.
--
-- Qué dominio vale para cada red lo decide `src/lib/club/social-links.ts`,
-- que valida antes de escribir. Aquí sólo se cierran las redes y el largo.

create table if not exists public.club_social_links (
  -- En cascada, como los textos del inicio de sesión: la limpieza de los
  -- clubes desechables de las pruebas de integración borra el club entero.
  club_id uuid not null references public.clubs (id) on delete cascade,
  network text not null
    constraint club_social_links_network_check
    check (network in (
      'instagram', 'tiktok', 'youtube', 'facebook', 'whatsapp', 'website'
    )),
  -- Se mide recortado, así que sólo espacios tampoco vale: sin enlace no hay
  -- fila.
  url text not null
    constraint club_social_links_url_length
    check (char_length(btrim(url)) between 1 and 300),
  constraint club_social_links_pkey primary key (club_id, network)
);

alter table public.club_social_links enable row level security;

-- Son públicas a propósito (D2): la pantalla de entrar las enseñará antes de
-- que nadie inicie sesión, así que `anon` las lee, como los textos de
-- `0028_club_sign_in_texts.sql`.
drop policy if exists club_social_links_select_public
  on public.club_social_links;
create policy club_social_links_select_public
  on public.club_social_links
  for select
  to anon, authenticated
  using (true);

-- Revocar primero: el proyecto concede todo a `anon` y `authenticated` sobre
-- cada tabla nueva. Escribir es de la llave de servicio; la pantalla del
-- Admin pasa por el servidor.
revoke all on public.club_social_links from anon, authenticated;
grant select on public.club_social_links to anon, authenticated;
grant select, insert, update, delete on public.club_social_links
  to service_role;
