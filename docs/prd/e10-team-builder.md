# PRD: E10 · Team builder

**Estado:** aprobado · **Fecha:** 28 de septiembre de 2026 · **Autor:** sesión de planificación (Claude Code)

Fuente: `docs/SRD_Victoria_Seadragons_Club_Platform.md` (v1.4), epic E10 de `docs/plan-maestro.md` y la matriz de permisos de su sección 4. Cubre FR-043 a FR-049 y FR-086, con los criterios AC-018, AC-019, AC-019b, AC-019c, AC-020 y AC-053, y NFR-002. Aplica B4 (el 5,0 virtual del no evaluado), B7 (la escuadra sale del RSVP, nunca del rol) y C2 (el algoritmo del auto-balance, escrito) de `docs/preguntas-abiertas.md`. Ese archivo no deja nada sin resolver para esta épica.

Las decisiones que el SRD no tomaba las tomó el dueño el 28 de septiembre de 2026 y van marcadas como D1 a D6.

## 1. Problema

En cada entrenamiento y en cada scrimmage el coach parte al grupo en dos equipos, a ojo, con quien haya llegado. Salen equipos desiguales, alguien se queda sin portero, y los jugadores se enteran de su equipo al borde de la piscina. El SRD lo resume en "unbalanced scrimmage teams" y pide dos cosas: un modo manual que ayude a repartir y un auto-balance que reparta solo, con los OVR de E9 y con las posiciones cubiertas.

E7 ya sabe quién dijo que va y E9 sabe cuánto vale cada uno. Falta juntarlo.

## 2. Usuarios y contexto

- **Coach y Admin:** arman los equipos antes o durante la sesión, desde el portátil o el móvil. Quieren pulsar un botón y tener dos equipos parejos, y poder mover a alguien a mano si el algoritmo no vio algo (una lesión, dos que no deben jugar juntos).
- **Jugador (cualquier miembro convocado):** quiere saber en qué equipo juega y con quién, y enterarse antes de llegar.
- **Committee:** no arma equipos (matriz de permisos, `buildTeamsAndTrackAttendance`).
- **Hoy lo resuelven así:** el coach reparte a voz en el agua.

## 3. Objetivo y métricas de éxito

- Objetivo: que el coach obtenga dos equipos parejos y con las posiciones cubiertas en una acción, los ajuste a mano si quiere, y cada jugador vea su equipo antes de la sesión.
- Métricas:
  - Con doce jugadores y dos porteros, el auto-balance da seis y seis con un portero por lado, y ningún intercambio de a un par que conserve los porteros reduce más la diferencia (AC-019).
  - Con treinta jugadores, el auto-balance responde en menos de dos segundos en el percentil 95 (AC-019c, NFR-002).
  - Los totales de cada equipo y la diferencia cambian al instante al mover a un jugador (AC-018).
  - Cada jugador asignado recibe su aviso y ve su equipo y la alineación completa (AC-020).

## 4. Alcance

**Incluido (v1):**

- Un reparto por evento en dos equipos con nombre, en modo manual o automático (FR-043, FR-044).
- La escuadra: quienes respondieron "Sí" al evento entran a la lista disponible; quienes respondieron "Quizás" aparecen aparte para arrastrarlos si llegan (D1, B7).
- Los totales en vivo: jugadores, puntaje combinado, fuerza media y diferencia (FR-045).
- El auto-balance en el servidor, con el algoritmo de C2, la cobertura de posiciones como restricción dura y el 5,0 virtual del no evaluado (FR-046, FR-086).
- La sugerencia de intercambio (FR-047).
- Publicar el reparto: cada jugador asignado recibe un aviso y ve su equipo y la alineación (FR-048, FR-049).
- Qué posiciones del club cuentan como portero, defensa y ataque para la cobertura (D4).

**Explícitamente fuera (por ahora):**

- Más de dos equipos, o repartir por grupos (juveniles, masters): un solo reparto en dos por evento.
- Guardar plantillas de equipos entre eventos.
- Armar equipos con los que están presentes según la hoja de asistencia (E8): la escuadra sale del RSVP. Si más adelante se quiere, es un origen más de la lista disponible.
- Estadísticas de equipos (victorias, historial).
- Ver los OVR de los demás siendo jugador: solo nombres y posición (D3, FR-055).
- Avisos por correo.
- Editar los nombres o los colores de los equipos más allá de los dos de cada evento.

## 5. Requerimientos funcionales

### RF-1 · El reparto se guarda con reglas en la base · Must

Un reparto por evento: sus dos equipos con nombre y color, el modo, si está publicado, y a qué equipo va cada jugador.

- **Dado** un evento, **cuando** se guarda un reparto, **entonces** queda uno solo por evento, con dos equipos con nombre y color, el modo (`manual` o `auto`) y la fecha de publicación (nula mientras es borrador).
- **Dado** un reparto, **cuando** se asigna un jugador, **entonces** queda una sola fila por jugador y reparto, en uno de los dos equipos; asignarlo otra vez lo mueve.
- **Dado** un jugador o un evento de otro club, **cuando** se intenta asignar, **entonces** la base lo rechaza por las claves compuestas, como en `event_rsvps`.
- **Dado** un reparto publicado, **cuando** un jugador asignado lo consulta con su sesión, **entonces** lee su reparto y las filas de los dos equipos; un reparto en borrador no lo lee nadie con su sesión, y ninguna cuenta escribe.
- **Dado** que se borra la identidad de un jugador, **cuando** termina la cascada, **entonces** su fila del equipo desaparece y el reparto sigue.
- **Dado** que se cancela el evento, **cuando** se consulta el reparto, **entonces** sigue existiendo pero ya no se edita ni se publica.

### RF-2 · Qué posiciones cubren qué · Must (D4)

Las posiciones son del club (E18a) y se renombran. Para que la cobertura de FR-046 sepa cuál es el portero, cada posición del club puede llevar una función: `goalkeeper`, `defender`, `forward` o ninguna.

- **Dado** un club con las tres posiciones sembradas, **cuando** se aplica la migración, **entonces** Goalkeeper, Defender y Forward quedan con su función; una posición creada después nace sin función.
- **Dado** la pantalla de posiciones del club (#300), **cuando** el Admin edita una posición, **entonces** puede elegir su función entre las tres o ninguna, y dos posiciones pueden compartir función.
- **Dado** un jugador sin posición o con una posición sin función, **cuando** se arma el reparto, **entonces** no cuenta para ninguna cobertura y se reparte solo por puntaje.

### RF-3 · La escuadra del evento · Must

- **Dado** un Admin o un Coach, **cuando** abre el team builder de un evento, **entonces** ve como disponibles a los miembros activos de la audiencia que respondieron "Sí", y aparte a los que respondieron "Quizás", cada uno con nombre, posición, función de la posición y su OVR (o "sin evaluar" con 5,0 virtual) (D1, FR-086).
- **Dado** un miembro que respondió "No" o no respondió, **cuando** se lista la escuadra, **entonces** no aparece.
- **Dado** un evento de entrenamiento o competición, futuro o del día de hoy hasta que termine el día en Melbourne, **cuando** se abre, **entonces** se puede armar (D2); una reunión o un social, un evento pasado o uno cancelado, 422.
- **Dado** un Committee o un Player, **cuando** pide la escuadra o cualquier endpoint del builder, **entonces** 403, en la frontera y en el dominio.
- **Dado** un evento de otro club o que no existe, **cuando** se pide, **entonces** 404.
- **Dado** un Coach que no es de la audiencia del evento, **cuando** abre el builder, **entonces** lo ve igual: quien arma no tiene por qué jugar.

### RF-4 · Modo manual · Must

- **Dado** el reparto en borrador, **cuando** el coach mueve a un jugador disponible a un equipo, **entonces** el jugador sale de la lista, aparece en ese equipo, y los totales de los dos equipos y la diferencia cambian al instante (FR-044, FR-045, AC-018).
- **Dado** un jugador en un equipo, **cuando** el coach lo devuelve a la lista o lo pasa al otro equipo, **entonces** los totales cambian igual.
- **Dado** el reparto en borrador, **cuando** el coach guarda, **entonces** las asignaciones quedan en la base con modo `manual`, sin avisar a nadie todavía.
- **Dado** un jugador que ya no está en la escuadra (cambió su RSVP a "No" o salió de la audiencia), **cuando** se abre el reparto, **entonces** aparece marcado como fuera de la escuadra y el coach puede quitarlo; guardar con él dentro responde 422.
- **Dado** dos coaches guardando el mismo reparto a la vez, **cuando** llegan las dos peticiones, **entonces** queda el último, entero.

### RF-5 · Auto-balance · Must

El algoritmo de C2, en el servidor, determinista.

- **Dado** una escuadra de doce con dos porteros, **cuando** se ejecuta, **entonces** cada equipo recibe seis jugadores y exactamente un portero, y ningún intercambio de a un par que conserve la cobertura reduce más la diferencia de puntaje (AC-019).
- **Dado** una escuadra de trece, **cuando** se ejecuta, **entonces** los tamaños son siete y seis, y el sobrante va al equipo de menor puntaje combinado (AC-019b).
- **Dado** una escuadra con dos o más defensas y dos o más atacantes, **cuando** se ejecuta, **entonces** cada equipo recibe al menos un defensa y un atacante; con uno solo de una función, la cobertura de esa función no se exige.
- **Dado** tres jugadores sin evaluación, **cuando** se ejecuta, **entonces** entran con 5,0, no se crea ninguna evaluación, y el resultado los marca "sin evaluar" (AC-053, FR-086).
- **Dado** la misma escuadra dos veces, **cuando** se ejecuta, **entonces** sale el mismo reparto: el desempate entre iguales es por nombre y luego por id, fijado por tests.
- **Dado** treinta jugadores, **cuando** se ejecuta, **entonces** responde en menos de dos segundos en el percentil 95, medido en un test (AC-019c, NFR-002).
- **Dado** el resultado, **cuando** se enseña, **entonces** el reparto queda en borrador con modo `auto` y el coach puede seguir moviendo a mano; el modo pasa a `manual` si toca algo.

### RF-6 · Sugerencia de intercambio · Should

- **Dado** un reparto en borrador, manual o automático, **cuando** existe un intercambio de a un par que reduce la diferencia de puntaje o mejora la cobertura, **entonces** el builder enseña el mejor, con los dos nombres y qué mejora (FR-047).
- **Dado** que no existe ninguno, **cuando** se mira, **entonces** no hay sugerencia.
- **Dado** la sugerencia, **cuando** el coach la acepta, **entonces** se aplica y se recalcula.

### RF-7 · Publicar y avisar · Must

- **Dado** un reparto en borrador con jugadores asignados, **cuando** el coach publica, **entonces** cada jugador asignado recibe un aviso con el evento, su equipo y su color, y el reparto queda publicado (FR-049, AC-020).
- **Dado** un reparto publicado, **cuando** el coach cambia asignaciones y vuelve a publicar, **entonces** solo reciben aviso los jugadores cuyo equipo cambió o que entran o salen.
- **Dado** un reparto con la lista disponible no vacía, **cuando** el coach publica, **entonces** se publica igual: quien no fue asignado no juega y no recibe aviso.
- **Dado** un reparto vacío, **cuando** se intenta publicar, **entonces** 422.
- **Dado** que falla el envío de avisos, **cuando** se publica, **entonces** el reparto queda publicado y el fallo se registra, como en el resto de avisos.

### RF-8 · Lo que ve el jugador · Must

- **Dado** un jugador asignado a un reparto publicado, **cuando** abre el evento en el calendario o su aviso, **entonces** ve "Juegas en {equipo}", el color, su posición y la alineación completa de su equipo con nombres y posiciones, más el otro equipo (FR-048, AC-020).
- **Dado** un jugador, **cuando** mira la alineación, **entonces** no ve ningún OVR (D3, FR-055).
- **Dado** un miembro de la audiencia sin asignar, **cuando** abre el evento, **entonces** ve que hay equipos publicados y que él no está en ninguno.
- **Dado** un reparto en borrador, **cuando** un jugador abre el evento, **entonces** no ve nada de equipos.

### RF-9 · La pantalla del team builder · Must

Sigue `docs/mockups/team-light.png` y `team-dark.png`; el jugador, `mobile-team-light.png` y `mobile-team-dark.png`.

- **Dado** un Admin o un Coach, **cuando** entra en Equipos, **entonces** elige el evento (los armables de hoy en adelante, el más cercano abierto), ve el control Manual / Auto-balance, el botón "Balancear equipos", la barra de totales con la diferencia, las dos columnas con nombre, posición y OVR de cada jugador, la lista disponible y la de "Quizás", y la sugerencia de intercambio.
- **Dado** el modo manual, **cuando** arrastra o toca "a Kelp" / "a Tide" en un jugador, **entonces** se mueve y los totales cambian; en el móvil los botones sustituyen al arrastre.
- **Dado** cambios sin guardar, **cuando** cambia de evento o cierra, **entonces** la pantalla avisa.
- **Dado** "Publicar equipos", **cuando** se pulsa, **entonces** pide confirmación diciendo cuántos jugadores recibirán aviso, y confirma al terminar.
- **Dado** el móvil a 375, **cuando** se mira, **entonces** las dos columnas van una debajo de otra y todo cabe sin scroll horizontal.
- **Dado** axe, **cuando** analiza cualquier estado, **entonces** no reporta violaciones; los movimientos se anuncian.

## 6. Casos borde y estados de error

- **Escuadra vacía:** nadie ha dicho que va; la pantalla lo dice y el auto-balance responde 422.
- **Un solo jugador:** va a un equipo; el otro queda vacío.
- **Sin porteros o con uno:** no se exige portero por lado; con uno, va al equipo que le toque por puntaje.
- **Todos sin evaluar:** todos a 5,0; el reparto es por posición y tamaño, determinista.
- **Un jugador cambia su RSVP después de publicado:** sigue en su equipo; la pantalla del coach lo marca "ya no viene" para que decida.
- **Cancelan el evento:** el reparto se conserva para el historial, deja de editarse y la vista del jugador dice que el evento se canceló.
- **El coach edita la audiencia del evento:** quien sale de la audiencia sale de la escuadra; si estaba asignado, queda marcado como fuera.
- **Dos coaches a la vez:** RF-4.
- **Publicar dos veces sin cambios:** no avisa a nadie la segunda.
- **Falla el auto-balance por tiempo (NFR-002):** devuelve el mejor reparto alcanzado hasta ese momento, nunca un error, y lo dice.
- **Nombres largos a 375:** se parten sin romper las columnas.

## 7. UX / UI

- Mockups: `docs/mockups/team-light.png` y `team-dark.png` (builder), `mobile-team-light.png` y `mobile-team-dark.png` (jugador). El selector de evento y las listas de disponibles y "Quizás" no están dibujados: revisión heurística contra `design-system.md` siguiendo la forma de las columnas. La función de la posición va en la pantalla de posiciones del club existente.
- Pantallas:
  - **Equipos (Admin, Coach):** ruta `/equipos`, que ya existe como marcador y ya está reservada en `RESTRICTED_ROUTES`. Selector de evento, control de modo, barra de totales, dos columnas, disponibles y "Quizás", sugerencia, guardar y publicar.
  - **Mi equipo (jugador):** dentro del evento desplegado en el calendario, la tarjeta "Juegas en Team Kelp" con color y posición, y la alineación de los dos equipos.
  - **Posiciones del club:** la columna "Función" con las tres opciones.
- Nombres y colores por defecto: "Team Kelp" azul y "Team Tide" amarillo, como el mockup, editables por evento (D5).
- Flujo principal: el coach abre Equipos el sábado, ve el scrimmage con catorce "Sí" y dos "Quizás", pulsa "Balancear equipos", mueve a uno a mano, publica, y catorce jugadores reciben el aviso y ven su equipo.
- Viewports: 375 / 768 / 1440, en tema claro y oscuro, en inglés y en español.

## 8. Requerimientos no funcionales

- Seguridad: la capacidad `buildTeamsAndTrackAttendance` se aplica en el servidor para el 100% de las peticiones del builder (NFR-004). La vista del jugador cuelga del camino de lectura de eventos y solo sirve repartos publicados. Los OVR no salen nunca del camino del builder (FR-055).
- Rendimiento: el auto-balance es una función pura en el servidor y su tiempo se mide en un test con treinta jugadores (NFR-002). La escuadra con sus OVR sale en una consulta, no una por jugador.
- Bitácora: publicar deja una entrada con quién, qué evento y cuántos asignados, sin nombres (NFR-010).
- Idiomas: todo texto nuevo sale de los catálogos, incluidos los avisos; ningún texto escribe el nombre del club.
- API: todo pasa por la API v1 (CON-002).
- Accesibilidad: sin violaciones de axe; los movimientos entre columnas se anuncian.

## 9. Preguntas abiertas

Ninguna que bloquee. Las decisiones del dueño:

- **D1 · La escuadra:** los "Sí" entran a la lista disponible; los "Quizás" aparecen aparte para arrastrarlos si llegan. "No" y sin respuesta, fuera.
- **D2 · Cuándo se arma:** entrenamientos y competiciones, futuros o del día de hoy hasta que termine el día en Melbourne.
- **D3 · Lo que ve el jugador:** su equipo, la alineación con nombres y posiciones, y nunca los OVR.
- **D4 · Cobertura de posiciones:** cada posición del club lleva una función (`goalkeeper`, `defender`, `forward` o ninguna); las tres sembradas nacen con la suya.
- **D5 · Equipos:** dos por evento, "Team Kelp" azul y "Team Tide" amarillo por defecto, nombre y color editables por evento.
- **D6 · Publicar avisa:** guardar no avisa; publicar avisa a los asignados, y volver a publicar solo a quien cambió.

## 10. Descomposición en tickets (para write-ticket)

| #   | Issue | Título propuesto                                                                           | Tamaño | Depende de | Auto-merge sugerido                             |
| --- | ----- | ------------------------------------------------------------------------------------------ | ------ | ---------- | ----------------------------------------------- |
| 1   | #399  | Guarda el reparto de equipos de cada evento y la función de cada posición, con RLS         | M      | ninguna    | No: tablas nuevas con RLS                       |
| 2   | #400  | Reparte una escuadra en dos equipos con el auto-balance de FR-046, determinista y en 2 s   | M      | ninguna    | No: lógica de negocio con presupuesto de tiempo |
| 3   | #401  | Sirve la escuadra y guarda, balancea y publica el reparto por API, con el aviso al jugador | M      | 1, 2       | No: permisos, avisos y bitácora                 |
| 4   | #402  | Da a Admin y Coach la pantalla del team builder del mockup                                 | M      | 3          | No: pantalla nueva con permisos                 |
| 5   | #403  | Enseña a cada jugador su equipo y la alineación en el evento, con su aviso                 | M      | 3          | No: pantalla nueva y catálogo de avisos         |
| 6   | #404  | Deja al Admin marcar la función de cada posición en la pantalla de posiciones del club     | S      | 1          | No: pantalla existente con dato de negocio      |

Traen migración el 1 (las tablas y la función de las posiciones). El 2 es una función pura sin base: va en paralelo con el 1 desde el primer día. Tras el 3, el 4 y el 5 van en paralelo; el 6 se puede hacer en cualquier momento tras el 1. Con dos personas la épica se cierra en tres vueltas.
