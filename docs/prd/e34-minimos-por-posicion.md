# PRD: E34 · Mínimos por posición en el auto-balance

**Estado:** aprobado · **Fecha:** 26 de octubre de 2026 · **Autor:** Camilo Gómez, con Claude

Épica añadida después del plan (fila E34 de `docs/plan-maestro.md`). Cambia la regla de cobertura de FR-046 del SRD (v1.8). Depende de E26 (posiciones en la configuración del club) y de E28 (las fichas de cobertura del Team builder).

## Decisiones

- **D1.** **Desaparece el rol de juego.** Hoy cada posición tiene un rol fijo de tres (`goalkeeper`, `defender`, `forward`: `POSITION_COVERAGES` y el `check` de `club_positions.coverage` en `0046`). Lo sustituye un número por posición: el **mínimo por equipo**.
- **D2.** **El mínimo vive en Club → Positions**, uno por posición y para todo el club. Lo cambia solo el Admin, como el resto de las posiciones. No hay ajuste por evento.
- **D3.** **Solo mínimo, sin máximo.** El auto-balance ya iguala el número de jugadores (FR-046, objetivo 3).
- **D4.** **El mínimo va de 0 a 20.** 0 quiere decir "no importa" y es el valor de una posición nueva. El tope de 20 no sale de ningún deporte: solo evita un valor absurdo escrito por error. Lo decidió el dueño el 26 de octubre de 2026, para que sirva a deportes con equipos grandes. Un mínimo que la escuadra no permite cumplir se reparte por mitades (D5).
- **D5.** **Lo exigido se reparte con justicia cuando faltan jugadores.** Para una posición con mínimo N y C jugadores en la escuadra, cada equipo debe tener al menos `min(N, ⌊C / 2⌋)`. Con N = 1 es exactamente la regla de hoy: con dos o más se exige uno por equipo, con uno o ninguno nada. El auto-balance nunca se bloquea por no poder cumplir: cumple lo que puede.
- **D6.** **Abreviatura por posición y por idioma.** Cada posición lleva una abreviatura corta (de 1 a 4 caracteres) en inglés y en español, como su nombre: GK y POR. Es lo que enseñan las fichas de cobertura. Si falta, se usan las tres primeras letras del nombre en ese idioma, en mayúsculas. Sin iconos por posición.
- **D7.** **Las fichas de cobertura del builder enseñan solo las posiciones con mínimo mayor que 0**, en el orden del club. Un club con todo a 0 no enseña la fila de cobertura.
- **D8.** **Un aviso por cualquier mínimo incumplido.** Sustituye al aviso fijo de "sin portero" (`teams.coverage.noGoalkeeper`): la ficha de la posición que falta sale en aviso y dice cuántos faltan. Solo avisa cuando la escuadra permitía cumplirlo (D5) y el equipo tiene jugadores.
- **D9.** **Las posiciones archivadas no exigen nada.** Su mínimo se guarda, pero no cuenta mientras estén archivadas. Un jugador con una posición archivada sigue contando para esa posición si se reactiva.
- **D10.** **Para el club de hoy no cambia nada.** La migración pone mínimo 1 a cada posición que hoy tiene rol, y 0 a las demás. La abreviatura de las que tienen rol se siembra con la de hoy (GK, DEF, ATT en inglés; POR, DEF, ATA en español), así que las fichas se ven igual.
- **D11.** **La columna `coverage` se retira al final**, en su propio ticket, cuando ya nada la lea. Producción reaplica el histórico de migraciones en cada merge, así que hay que cuidar que `0046` no la vuelva a crear (ver notas técnicas).

## 1. Problema

El auto-balance reparte los puestos con tres roles fijos: portero, defensa y ataque. Sirve para el rugby subacuático tal como lo juega hoy el club, pero no para un club que defina más posiciones o que necesite más de uno de algo por equipo. Tampoco se puede pedir "dos defensas por equipo": la regla es siempre "al menos uno". Y el Admin tiene que entender dos conceptos, la posición y su rol, cuando lo que le importa es una sola cosa: cuántos de cada posición quiere en cada equipo.

## 2. Usuarios y contexto

- **Admin**, desde la configuración del club en el escritorio o el móvil: decide cuántos de cada posición quiere por equipo.
- **Coach**, en la piscina y desde el móvil: pulsa Auto-balance y espera dos equipos parejos y completos, y ve de un vistazo si a un equipo le falta algo.
- **Hoy lo resuelve así:** elige el rol de cada posición entre tres. Si necesita dos de algo, o una posición que no encaja en los tres roles, arma los equipos a mano.

## 3. Objetivo y métricas de éxito

- **Objetivo:** que cada club diga cuántos de cada posición quiere por equipo, con cualquier número de posiciones, y que el auto-balance lo cumpla antes de igualar el nivel.
- **Métricas:**
  - Con los datos actuales del club, el auto-balance da el mismo reparto antes y después de la migración (se prueba con un test de regresión sobre las escuadras de los tests de E10 y E28).
  - Una escuadra de 30 jugadores con cinco posiciones con mínimo se reparte en menos de 2 s en el p95 (NFR-002, AC-019c).

## 4. Alcance

**Incluido:**

- El mínimo por equipo y la abreviatura por idioma en cada posición: base, migración, siembra de clubes nuevos y API de posiciones.
- El auto-balance y la sugerencia de intercambio con los mínimos del club.
- El campo de mínimo y de abreviatura en Club → Positions, en escritorio y en la hoja del móvil, en lugar del selector de rol.
- Las fichas de cobertura y el aviso genéricos en las tarjetas de equipo del builder.
- Retirar el rol: la columna `coverage`, el tipo `PositionCoverage` y los textos que ya no se usan.
- SRD v1.8: FR-046 y AC-019 con la regla nueva.

**Explícitamente fuera (por ahora):**

- Máximo por equipo o "exactamente N".
- Mínimos distintos por evento o por tipo de evento.
- Agrupar varias posiciones para cubrir un mínimo juntas ("cualquier defensa").
- Iconos por posición.
- Cambiar el algoritmo de reparto (serpiente e intercambios) más allá de la regla de cobertura.
- Recalcular repartos ya guardados o publicados al cambiar un mínimo.

## 5. Requerimientos funcionales

### RF-1 · Mínimo y abreviatura en cada posición · Must

Cada posición del club guarda un mínimo por equipo de 0 a 20 y una abreviatura opcional por idioma.

- **Dado** el club de hoy con Goalkeeper, Defender y Forward con rol, **cuando** se aplica la migración, **entonces** las tres tienen mínimo 1 y las abreviaturas GK/POR, DEF/DEF y ATT/ATA, y cualquier otra posición tiene mínimo 0 y sin abreviatura.
- **Dado** que producción reaplica todas las migraciones, **cuando** se aplica dos veces, **entonces** no vuelve a poner 1 a una posición que el Admin dejó en 0 ni pisa una abreviatura cambiada.
- **Dado** un club nuevo, **cuando** se crea, **entonces** sus tres posiciones sembradas nacen con mínimo 1 y sus abreviaturas.
- **Dado** un Admin, **cuando** cambia el mínimo de una posición con `PATCH /api/v1/club/settings/positions/{id}`, **entonces** se guarda, queda en la bitácora (NFR-010) y `GET` lo devuelve.
- **Dado** un mínimo fuera de 0 a 20, o no entero, **cuando** llega a la API, **entonces** responde 400 y no guarda nada.
- **Dado** una abreviatura vacía, **cuando** se guarda, **entonces** se guarda como sin abreviatura; **dada** una de más de 4 caracteres, **entonces** responde 400.
- **Dado** un Coach, un Committee o un Player, **cuando** intenta cambiar el mínimo o la abreviatura, **entonces** responde 403, como hoy con las posiciones.

### RF-2 · El auto-balance cumple los mínimos · Must

El auto-balance reparte primero los mínimos (D5) y después iguala el nivel, como pide FR-046 en su orden.

- **Dado** Goalkeeper con mínimo 1 y dos porteros en la escuadra, **cuando** se pulsa Auto-balance, **entonces** cada equipo tiene un portero (AC-019, igual que hoy).
- **Dado** Defender con mínimo 2 y cuatro defensas, **cuando** se pulsa Auto-balance, **entonces** cada equipo tiene al menos dos.
- **Dado** Defender con mínimo 2 y solo tres defensas, **cuando** se pulsa Auto-balance, **entonces** cada equipo tiene al menos uno, y el auto-balance no falla.
- **Dado** una posición con mínimo 1 y un solo jugador, **cuando** se pulsa Auto-balance, **entonces** no se exige nada para esa posición.
- **Dado** una posición con mínimo 0, **cuando** se pulsa Auto-balance, **entonces** sus jugadores solo cuentan para el nivel.
- **Dado** una posición archivada con mínimo 1, **cuando** se pulsa Auto-balance, **entonces** no se exige (D9).
- **Dado** un jugador sin posición, **cuando** se reparte, **entonces** no cuenta para ningún mínimo.
- **Dado** el club con los mínimos que deja la migración, **cuando** se pulsa Auto-balance sobre las escuadras de los tests de E10 y E28, **entonces** el reparto es el mismo que antes del cambio.
- **Dado** una escuadra de 30 con cinco posiciones con mínimo, **cuando** se pulsa Auto-balance, **entonces** responde en menos de 2 s en el p95.

### RF-3 · La sugerencia de intercambio cierra huecos de mínimos · Must

- **Dado** un reparto a mano al que le falta un mínimo que la escuadra permite cumplir, **cuando** se calcula la sugerencia, **entonces** propone el intercambio que lo cierra y dice que cubre los puestos, como hoy.
- **Dado** un reparto que cumple todos los mínimos, **cuando** se calcula la sugerencia, **entonces** propone el intercambio que más acerca el nivel sin romper ningún mínimo.

### RF-4 · Mínimo y abreviatura en Club → Positions · Must

La columna "Role in auto-balance" de la tabla de posiciones se cambia por **"Minimum per team"** ("Mínimo por equipo"), y la abreviatura se edita junto al nombre.

- **Dado** el Admin en Club → Positions en el escritorio, **cuando** se pinta la tabla, **entonces** cada posición activa tiene un control numérico de 0 a 20 con su valor, con nombre accesible "Minimum per team for {posición}".
- **Dado** el Admin, **cuando** cambia el número, **entonces** se guarda al momento, como hoy el rol, y sale "{posición}: {n} per team · saved" (o "no minimum" con 0).
- **Dado** el guardado falla, **cuando** vuelve el error, **entonces** el control vuelve al valor anterior y lo dice, como los demás cambios de la sección.
- **Dado** el Admin renombrando una posición, **cuando** se abre la edición, **entonces** puede escribir también la abreviatura en cada idioma, con el texto de ayuda "Up to 4 characters. Shown on the team cards." y el límite en el campo.
- **Dado** el móvil, **cuando** abre la hoja de una posición, **entonces** el mínimo es un paso a paso (− n +) de 44 px y la abreviatura va junto al nombre de cada idioma.
- **Dado** una posición archivada, **cuando** se pinta, **entonces** su mínimo no se edita y no se enseña.
- **Dado** el texto de entrada de la sección, **cuando** se pinta, **entonces** explica que el mínimo es lo que auto-balance intenta dar a cada equipo.

### RF-5 · Fichas de cobertura y aviso en el builder · Must

- **Dado** el club de hoy, **cuando** se abre el builder, **entonces** las fichas de cada equipo son GK, DEF y ATT con su número, como hoy (D10).
- **Dado** una posición con mínimo mayor que 0, **cuando** se pinta la tarjeta de un equipo, **entonces** hay una ficha con su abreviatura y cuántos tiene el equipo; el lector oye "{posición}: {n}".
- **Dado** que ninguna posición tiene mínimo, **cuando** se pinta la tarjeta, **entonces** no hay fila de cobertura.
- **Dado** un equipo con jugadores al que le falta un mínimo que la escuadra permitía cumplir, **cuando** se pinta, **entonces** esa ficha sale en aviso con "Missing {abreviatura}" si falta uno, o "{n} short of {abreviatura}" si faltan más, y el lector oye "Missing {n} {posición}".
- **Dado** un equipo vacío, **cuando** se pinta, **entonces** no avisa de nada.
- **Dado** el móvil, **cuando** hay muchas fichas, **entonces** pasan a la línea siguiente sin salirse de la tarjeta a 320 px.

### RF-6 · Retirar el rol · Should

- **Dado** que ya nada lee `club_positions.coverage`, **cuando** se aplica la migración que la retira, **entonces** desaparece la columna y su `check`, y reaplicar todo el histórico (como hace producción) no la vuelve a crear.
- **Dado** el código, **cuando** se busca `PositionCoverage`, `POSITION_COVERAGES` o los textos `clubSettings.positions.coverage.*` y `teams.coverage.goalkeeper|defender|forward|noGoalkeeper`, **entonces** no queda ninguno.

## 6. Casos borde y estados de error

- **Escuadra sin nadie con posición:** el auto-balance solo iguala el nivel, sin mínimos.
- **Mínimos imposibles de cumplir a la vez:** por ejemplo, mínimo 3 en dos posiciones y una escuadra de 6. El reparto minimiza el número total de huecos y después iguala el nivel; nunca responde con error.
- **Escuadra impar:** el jugador de más va al equipo de menor nivel (AC-019b), sin romper un mínimo ya cumplido.
- **El Admin cambia un mínimo con el builder abierto:** el builder usa lo que leyó al abrirse; el cambio llega al recargar. Los repartos guardados o publicados no cambian.
- **Abreviaturas repetidas** (dos posiciones con "DEF"): se permiten; el lector distingue por el nombre entero.
- **Abreviatura en un solo idioma:** en el otro se usa la regla de las tres letras del nombre de ese idioma (D6), o del otro idioma si ese nombre también falta.
- **Posición sin nombre en el idioma de la pantalla:** como hoy, se usa el del otro idioma.
- **Concurrencia:** dos Admin cambian el mínimo de la misma posición a la vez; gana el último, como el resto de los cambios de posiciones.

## 7. UX / UI

- **Sin mockup:** revisión heurística contra `design-system.md`. Es un control numérico donde hoy está el selector de rol, y las fichas que ya existen con otra fuente.
- **Flujo principal:** el Admin abre Club → Positions, pone Defender en 2 y sale. El Coach abre el builder del sábado, pulsa Auto-balance y ve en cada equipo "DEF 2".
- **Viewports:** 375 / 768 / 1440, y 320 para las fichas.

## 8. Requerimientos no funcionales

- **Rendimiento:** NFR-002. El auto-balance responde en menos de 2 s en el p95 con 30 jugadores y cinco posiciones con mínimo; el cálculo conserva su presupuesto de 1,5 s.
- **Accesibilidad:** axe sin violaciones. El control numérico tiene nombre accesible, y las fichas dicen el nombre entero al lector.
- **Seguridad:** el mínimo y la abreviatura solo los cambia el Admin, en el servidor (NFR-004), con el mismo permiso que el resto de las posiciones.
- **Bitácora:** cada cambio de mínimo o de abreviatura queda en `audit_log` (NFR-010).
- **API (CON-002):** las respuestas cambian de forma: las posiciones ganan `minPerTeam` y `shortNames`, y el builder deja de mandar `coverage` por jugador y pasa a mandar la posición y los mínimos del club. No hay app móvil todavía, así que no rompe a ningún cliente.

## 9. Preguntas abiertas

Ninguna. Las cuatro del arranque las cerró el dueño el 26 de octubre de 2026: el mínimo vive en Club (D2), las fichas usan una abreviatura del club (D6), solo mínimo (D3) y un aviso por cualquier mínimo (D8).

## 10. Descomposición en tickets (para write-ticket)

| #   | Título propuesto                                                                                  | Tamaño | Depende de | Auto-merge sugerido                                        |
| --- | ------------------------------------------------------------------------------------------------- | ------ | ---------- | ---------------------------------------------------------- |
| 1   | Guarda en cada posición un mínimo por equipo y una abreviatura por idioma, sembrados desde el rol | M      | ninguna    | No: migración con datos de producción y permisos de la API |
| 2   | Reparte con el auto-balance y la sugerencia los mínimos por posición del club                     | M      | 1          | No: cambia la lógica de negocio de FR-046                  |
| 3   | Cambia el rol por el mínimo por equipo y la abreviatura en Club → Positions                       | M      | 1          | No: pantalla nueva con revisión de UI                      |
| 4   | Enseña en las tarjetas del builder las fichas de los mínimos del club y avisa del que falta       | S      | 1, 2       | No: cambia lo que ve el Coach y lleva revisión de UI       |
| 5   | Retira el rol de juego de las posiciones                                                          | S      | 2, 3, 4    | No: borra una columna en producción                        |

`ui-review` sugerido en 3 y 4. Los tickets 2 y 3 pueden ir en paralelo después del 1.

## Notas técnicas

- **Migración (ticket 1):** columna `min_per_team smallint not null default 0` con `check (min_per_team between 0 and 20)` en `club_positions`, y `short_name text` con `check (char_length(short_name) between 1 and 4)` en `club_position_names`. El relleno desde `coverage` va dentro del mismo guardia que crea la columna (`if not exists ... then add column; update ...; end if`), como hace `0046`: así reaplicar no pisa lo que cambió el Admin. Cambia también `clubs_seed_default_positions()`.
- **Retirar `coverage` (ticket 5):** `0046` crea la columna con `if not exists`, y producción reaplica todo el histórico. Si la nueva migración solo la borra, la siguiente pasada de `0046` la vuelve a crear vacía. Hay que cambiar el guardia de `0046` para que no la cree cuando ya existe `min_per_team`, o equivalente, y probarlo con el test de aplicar el histórico dos veces y con el de `apply-migrations.test.ts`. Ver la trampa en la skill `nextjs-supabase-practices` §7.
- **Dónde está el rol hoy:** `src/lib/club/club-positions.ts` (`POSITION_COVERAGES`), `src/lib/teams/position-coverage.ts` (la regla y `countTeamCoverage`), `swap-suggestion.ts`, `squad.ts`, `team-builder.ts`, `supabase-team-builder-gateways.ts`, `src/components/teams/TeamCoverage.tsx` (fichas e iconos), `src/components/club/PositionCoverageControl.tsx`, `ClubPositionsSection.tsx`, `ClubPositionsPhone.tsx` y la ruta `src/app/api/v1/club/settings/positions/[id]/route.ts`.
- **La regla (ticket 2):** `countCoverageGaps` pasa a recibir los requisitos del club (`{ positionId, minPerTeam }` de las posiciones activas) y cuenta, por equipo, `max(0, min(N, ⌊C/2⌋) − tiene)`. Con N = 1 da lo mismo que hoy, que es lo que protege el test de regresión.
- **SRD v1.8:** FR-046 cambia su objetivo (1) a "each team receives at least the club's minimum per team for each position, or half of that position's players in the squad (rounded down) when there are fewer", y AC-019 se reescribe con "Goalkeeper with a minimum of 1". Se cambia en el PR de este PRD.
- Carga la skill `nextjs-supabase-practices` en todos los tickets.
