-- El nombre del registro del club (#967, RF-7 y D11 del PRD de E37). La app
-- pide, verifica y avisa de la caducidad del registro federativo de cada
-- socio, y hasta ahora lo llamaba "AUF" en todos sus textos. El Admin lo
-- escribe en la pestaña General de `/club`; nulo es la palabra de la app
-- ("Registration" / "Registro").
--
-- El club que ya existe usaba "AUF", así que lo conserva. Esa siembra sólo
-- corre cuando la columna nace: producción reaplica el histórico entero en
-- cada merge, y repetir el `update` pisaría el nombre que el Admin guardó (o
-- el nulo que eligió). Un club nuevo nace nulo.
--
-- Los privilegios no cambian. Escribe la llave de servicio, que ya tenía todos;
-- `authenticated` lee la tabla entera desde `0001_clubs.sql`; y `anon` sólo
-- las columnas de la marca, entre las que esta no está (la marca se lee con
-- la llave de servicio).

do $$
begin
  if not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'clubs'
       and column_name = 'registration_name'
  ) then
    alter table public.clubs add column registration_name text;

    update public.clubs set registration_name = 'AUF';

    -- 16 caben en los chips y filtros del móvil (D11). Recortado, como el
    -- nombre del club en `clubs_name_length`.
    alter table public.clubs
      add constraint clubs_registration_name_length
      check (char_length(btrim(registration_name)) between 1 and 16);
  end if;
end
$$;
