-- La marca del club sale del código (#291, RF-1 del PRD de E18a). Hasta aquí
-- el nombre estaba repetido en cuatro archivos, las iniciales `VS` escritas a
-- mano y el color de acento en `src/app/globals.css`. Para instalar la
-- plataforma en otro club, eso tiene que vivir en la base.
--
-- Cuelga de `public.clubs` y no de una tabla aparte: hay un club por
-- instalación (CON-004), el nombre ya vivía aquí, y una segunda tabla obligaría
-- a mantener dos filas en paralelo para decir lo mismo.

alter table public.clubs
  add column if not exists initials text,
  -- El `--color-accent` del tema claro de `globals.css`, copiado tal cual. Es
  -- el default para que un club nuevo nazca con un acento válido y legible.
  add column if not exists accent_color text not null default '#1c6ea4',
  -- Sólo la ruta: subir el logo es de otro ticket.
  add column if not exists logo_path text;

-- Se borran y se vuelven a crear para que la migración aplique dos veces: `add
-- constraint` no tiene `if not exists`.
alter table public.clubs drop constraint if exists clubs_name_length;
alter table public.clubs
  add constraint clubs_name_length
  check (char_length(btrim(name)) between 1 and 60);

-- Sin iniciales es nulo, no la cadena vacía: así quien la lea tiene un único
-- caso "no hay" que atender.
alter table public.clubs drop constraint if exists clubs_initials_length;
alter table public.clubs
  add constraint clubs_initials_length
  check (char_length(initials) between 1 and 3);

alter table public.clubs drop constraint if exists clubs_accent_color_hex;
alter table public.clubs
  add constraint clubs_accent_color_hex
  check (accent_color ~ '^#[0-9A-Fa-f]{6}$');

-- Sólo si siguen vacías: al repetirse, la migración no debe pisar unas
-- iniciales que un Admin haya cambiado después.
update public.clubs
   set initials = 'VS'
 where slug = 'victoria-seadragons'
   and initials is null;

-- La pantalla de entrar enseña la marca antes de que nadie inicie sesión, así
-- que `anon` la lee. Sólo esas cuatro columnas: `0008_sonda_salud.sql` le quitó
-- la tabla entera, y el resto de la fila (id, slug, created_at) sigue sin
-- hacerle falta. Escribir no puede nadie más que la llave de servicio, que ya
-- tenía todos los privilegios.
grant select (name, initials, accent_color, logo_path)
  on public.clubs to anon;

drop policy if exists clubs_select_anon on public.clubs;
create policy clubs_select_anon
  on public.clubs
  for select
  to anon
  using (true);
