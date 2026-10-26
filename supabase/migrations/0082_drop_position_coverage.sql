-- El rol de juego de cada posición (`coverage`, `0046`) se retira (#889,
-- RF-6 y D11 del PRD de E34). El auto-balance, la pantalla de posiciones y
-- las fichas del builder ya leen el mínimo por equipo de `0081`, y el rol no
-- lo lee nadie. El `check` se va con la columna.
--
-- Producción reaplica el histórico entero en cada merge. Para que la columna
-- no vuelva, el guardia de `0046` tampoco la crea cuando ya existe
-- `min_per_team`, y ni la siembra de `0046` ni la de `0081` la escriben.
alter table public.club_positions drop column if exists coverage;

notify pgrst, 'reload schema';
