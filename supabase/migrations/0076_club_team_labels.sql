-- Los equipos del club (#755, RF-1 y D1 a D3 del PRD de E28). Hasta aquí los
-- dos equipos de un reparto nuevo se llamaban siempre Team Kelp y Team Tide
-- (`DEFAULT_TEAM_LABELS`). Pasan a ser datos del club que el Admin o el Coach
-- cambian con `PATCH /api/v1/club/team-labels`.
--
-- Cuelgan de `public.clubs`, como el resto de su configuración
-- (`0022_club_brand.sql`): el PRD habla de `club_settings`, pero esa tabla no
-- existe y una segunda fila por club diría lo mismo en dos sitios. Los valores
-- por defecto son los de antes, así que un reparto nuevo no cambia hasta que
-- alguien los cambie.
--
-- Un reparto guardado no lee de aquí: `team_splits` guarda su nombre y su
-- color (`0046`), y por eso cambiar los del club no toca uno publicado (D4).
-- Tampoco exige el muestrario (D5): sólo lo exige el endpoint, que es el único
-- que conoce los doce colores. La base comprueba la forma.
--
-- Los privilegios no cambian. Escribe la llave de servicio, que ya tenía todos;
-- `authenticated` lee la tabla entera desde `0001_clubs.sql`; y `anon` sólo
-- las columnas de la marca, entre las que estas no están.

alter table public.clubs
  add column if not exists team_a_name text not null default 'Team Kelp',
  add column if not exists team_a_color text not null default '#1C6EA4',
  add column if not exists team_b_name text not null default 'Team Tide',
  add column if not exists team_b_color text not null default '#C99A3E';

-- Se borran y se vuelven a crear para que la migración aplique dos veces: `add
-- constraint` no tiene `if not exists`. El límite del nombre es el de
-- `CLUB_TEAM_NAME_MAX_LENGTH` y se mide recortado, como el del reparto.
alter table public.clubs drop constraint if exists clubs_team_a_name_length;
alter table public.clubs
  add constraint clubs_team_a_name_length
  check (char_length(btrim(team_a_name)) between 1 and 24);

alter table public.clubs drop constraint if exists clubs_team_b_name_length;
alter table public.clubs
  add constraint clubs_team_b_name_length
  check (char_length(btrim(team_b_name)) between 1 and 24);

alter table public.clubs drop constraint if exists clubs_team_a_color_hex;
alter table public.clubs
  add constraint clubs_team_a_color_hex
  check (team_a_color ~ '^#[0-9A-Fa-f]{6}$');

alter table public.clubs drop constraint if exists clubs_team_b_color_hex;
alter table public.clubs
  add constraint clubs_team_b_color_hex
  check (team_b_color ~ '^#[0-9A-Fa-f]{6}$');

-- Sin distinguir mayúsculas: `#1c6ea4` y `#1C6EA4` son el mismo peto.
alter table public.clubs drop constraint if exists clubs_team_colors_distinct;
alter table public.clubs
  add constraint clubs_team_colors_distinct
  check (upper(team_a_color) <> upper(team_b_color));
