-- El inicio de la temporada (#744, RF-1 y D1 del PRD de E27). "Mi asistencia"
-- del inicio cuenta la temporada, y la app no tenía temporadas: el Admin fija
-- en la pestaña General de `/club` el día en que empieza la actual.
--
-- Cuelga de `public.clubs`, como el resto de la configuración de General
-- (`0022_club_brand.sql`). Sin valor por defecto y nula: sin fecha, la
-- temporada cuenta desde el 1 de enero del año en curso, y esa cuenta la hace
-- el servidor (`seasonStartFor`), no la base.
--
-- Los privilegios no cambian. Escribe la llave de servicio, que ya tenía todos;
-- `authenticated` lee la tabla entera desde `0001_clubs.sql`; y `anon` sólo
-- las columnas de la marca, entre las que esta no está.

alter table public.clubs
  add column if not exists season_starts_on date;
