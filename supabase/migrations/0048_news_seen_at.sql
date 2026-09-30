-- La marca de la última visita a Noticias de cada socio (#424, D2 del PRD
-- de E14).
--
-- El dashboard cuenta como "sin leer" las noticias publicadas después de esta
-- marca. Nula quiere decir que el socio nunca abrió Noticias, y entonces la
-- cuenta mira los últimos 30 días: por eso la columna nace sin valor por
-- defecto, y las filas que ya existían se quedan nulas.
--
-- Sin privilegios nuevos: `0003_members.sql` deja a `authenticated` sólo
-- leer su fila, y la marca la escribe el servidor con la llave de servicio
-- (`POST /api/v1/account/news-seen`), siempre sobre quien llama.
--
-- Idempotente como el resto del histórico.

alter table public.members
  add column if not exists news_seen_at timestamptz;
