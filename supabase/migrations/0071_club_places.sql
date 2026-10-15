-- Los lugares que el club ya usó (issue #646, RF-5 y D1 de
-- `docs/prd/e24-rediseno-calendario.md`).
--
-- El buscador de lugares enseña primero los del club, ordenados por cuántos
-- eventos los tienen. Salen de los eventos y de las series del club con lugar
-- estructurado (`0069_event_places.sql`), nunca de otro club. La serie entra
-- para que su lugar aparezca aunque ninguna sesión lo tenga ya, pero no suma:
-- sus sesiones ya cuentan como eventos.
--
-- PostgREST no agrupa sin funciones de agregado, que Supabase trae apagadas,
-- y leer todas las filas para contarlas en el servidor se cortaría en el tope
-- de filas de la API. Por eso agrupa la base.

create or replace function public.club_places(p_club_id uuid)
  returns table (
    place_name text,
    place_address text,
    place_lat double precision,
    place_lng double precision,
    event_count integer
  )
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select used.place_name,
         used.place_address,
         used.place_lat,
         used.place_lng,
         sum(used.counts)::integer as event_count
    from (
      select e.place_name, e.place_address, e.place_lat, e.place_lng,
             1 as counts
        from public.events e
       where e.club_id = p_club_id
         and e.place_name is not null
      union all
      select s.place_name, s.place_address, s.place_lat, s.place_lng,
             0 as counts
        from public.event_series s
       where s.club_id = p_club_id
         and s.place_name is not null
    ) used
   group by used.place_name, used.place_address, used.place_lat,
            used.place_lng
   order by event_count desc, used.place_name
$$;

-- La llama el servidor después de comprobar que quien busca puede organizar
-- eventos en ese club.
revoke all on function public.club_places(uuid)
  from public, anon, authenticated;
grant execute on function public.club_places(uuid) to service_role;

notify pgrst, 'reload schema';
