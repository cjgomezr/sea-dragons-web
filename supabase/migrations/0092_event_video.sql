-- El vídeo de cada sesión (#965, RF-4 y D5 del PRD de E37): un enlace de
-- YouTube por fila de `events`. Cada sesión de una serie ya es su propia
-- fila, así que cada una lleva el suyo, y la serie no tiene columna: el
-- vídeo no se hereda ni se copia.
--
-- Qué enlace vale (sólo vídeos de YouTube por https) lo decide
-- `src/lib/events/session-video.ts` antes de escribir. Aquí sólo se cierra el
-- largo, medido recortado para que sólo espacios tampoco valga: sin vídeo es
-- `null`.
--
-- Las funciones que editan una sesión o parten su serie (`update_event`,
-- `update_series`, `split_series`) nombran las columnas que cambian, así que
-- no lo tocan. Lo prueba `event-video-migration.test.ts`.
--
-- Lo escribe sólo el servidor con la llave de servicio, como el resto de
-- `events`: `authenticated` sólo tiene `select` (`0034_events.sql`).

alter table public.events
  add column if not exists video_url text;

-- Con guardia y no `drop` + `add`: producción reaplica el histórico entero
-- en cada merge, y así no revalida la tabla cada vez.
do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.events'::regclass
       and conname = 'events_video_url_length'
  ) then
    alter table public.events
      add constraint events_video_url_length
      check (char_length(btrim(video_url)) between 1 and 300);
  end if;
end;
$$;
