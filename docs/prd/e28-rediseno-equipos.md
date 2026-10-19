# PRD: E28 · El rediseño del Team builder

**Estado:** borrador · **Fecha:** 19 de octubre de 2026 · **Autor:** sesión de planificación (Claude Code)

Fuente: el diseño que el dueño hizo con Claude Design, guardado en `docs/design/design_handoff_teams/`. Contiene el prototipo `Teams Upgrade.dc.html`, su `README.md` de handoff, `support.js` y seis capturas en `screenshots/`. Se construyen **#1a** en escritorio y **#2a** en móvil, por debajo de 768 px. Es una épica añadida después del plan. Rehace la pantalla de Equipos de E10 (`src/components/teams/*`) sin cambiar el flujo de borrador, guardar y publicar. Añade un único dato nuevo: el nombre y el color de los dos equipos a nivel de club.

El `README.md` del handoff es parte de este PRD. Tiene las medidas, los colores, los textos y cada estado. Cuando no coinciden, manda lo que dice aquí.

Las decisiones van de D1 a D14. Salen del handoff y del código actual, y el dueño las ratifica al aprobar este PRD.

- **D1.** **El nombre y el color de los equipos pasan a ser del club.** Dos columnas por equipo en `club_settings` (`team_a_name`, `team_a_color`, `team_b_name`, `team_b_color`), con los valores de hoy por defecto: Team Kelp `#1C6EA4` y Team Tide `#C99A3E` (`DEFAULT_TEAM_LABELS`). Un borrador nuevo y el auto-balance leen los del club, no la constante.
- **D2.** **Los cambia el Admin o el Coach**, los mismos que arman equipos (`buildTeamsAndTrackAttendance`), con `PATCH /api/v1/club/team-labels`. El Committee y el Player reciben 403.
- **D3.** **Las reglas de un equipo:** nombre recortado de 1 a 24 caracteres; color, uno de los doce del muestrario del handoff; los dos colores, distintos. Cualquier otra cosa es 400 con el campo que falla.
- **D4.** **Un reparto ya publicado guarda su nombre y su color**, como hoy (`team_splits` guarda los suyos). Cambiar los del club cambia también el borrador abierto en pantalla, pero no los repartos publicados, salvo que se vuelvan a publicar.
- **D5.** **Los repartos guardados con colores de antes siguen valiendo.** El guardado de un reparto sigue aceptando cualquier `#RRGGBB` (`team-builder-api.ts`), para no romper borradores viejos. Solo el endpoint de D2 exige el muestrario.
- **D6.** **Los doce colores tienen nombre propio.** `TeamColorName` gana `gold`, `teal` y `navy`. `nameTeamColor` devuelve el nombre exacto cuando el hex es uno del muestrario, y la familia como hoy cuando no. Así la tarjeta del calendario y la del inicio (E27) dicen "peto dorado" y no "amarillo".
- **D7.** **Las fotos siguen la regla del directorio y de Asistencia.** `photoUrl` firmada en cada jugador (plantilla, Team builder y auto-balance), o null. `TeamPlayerRow` deja de pasar `photoUrl={null}`.
- **D8.** **"Auto-balance" es un solo botón** que reparte y deja el modo en automático. Sustituye al segmento Manual/Auto y a "Equilibrar equipos". Mover a alguien a mano pasa el modo a manual, como hoy (RF-5 de E10). El estado ("Auto-equilibrado" o "Editado a mano") se lee junto al botón.
- **D9.** **La cobertura de puestos usa lo de hoy** (`position-coverage.ts`): portero, defensa y ataque según el rol de la posición (E26 D4). "Sin portero" sale solo si el equipo tiene jugadores.
- **D10.** **El nombre corto de un equipo** (pestañas del móvil y botones Añadir del banco) es el nombre sin "Team " ni "Equipo " al principio. Si no empieza así, es el nombre entero, cortado con puntos suspensivos.
- **D11.** **Lo que no cambia:** el borrador y su guardado, publicar con su confirmación y el número de avisados, la sugerencia de intercambio, arrastrar en escritorio, los anuncios `aria-live`, el selector de evento y el aviso al salir con cambios.
- **D12.** **Los colores sueltos se vuelven tokens o reutilizan los de E21 a E27** (`--color-hover`, `--color-segment-selected`). Los doce del muestrario son una constante con nombre, no tokens del tema.
- **D13.** **Ningún objetivo táctil baja de 44 px en el móvil**, como en E22 a E27. El español usa tú.
- **D14.** **Están diseñados el escritorio y el móvil, en tema oscuro.** El corte es 768 px. El tema claro aplica el mismo diseño con los tokens claros, y la tableta usa el de escritorio. Lo que no está dibujado (cargando, error al guardar, sin evento) lo revisa el `ui-reviewer` contra `design-system.md`.

## 1. Problema

El Team builder funciona, pero cuesta leerlo. Los dos equipos se llaman siempre igual y no se pueden cambiar, aunque el club use otros petos. Los jugadores no tienen cara. Mover y quitar son botones de texto que ocupan media fila. El modo y "Equilibrar" son dos controles para una sola acción. No se ve si a un equipo le falta portero. En el móvil, los dos equipos y el banco van uno debajo de otro, y guardar y publicar quedan al final.

## 2. Usuarios y contexto

- **Coach, en la piscina y desde el móvil:** arma los equipos antes de la sesión con quienes dijeron que van.
- **Admin, desde el portátil:** arma o revisa los equipos y los publica.
- **Player:** no ve esta pantalla. Ve su equipo en el evento (E10) y, con E27, en el inicio.
- **Hoy lo resuelven así:** con los nombres fijos, mirando las posiciones fila a fila para saber si hay portero, y bajando hasta el final para publicar.

## 3. Objetivo y métricas de éxito

- **Objetivo:** que armar dos equipos parejos se haga de un vistazo, con los petos del club, también en el móvil.
- **Métricas:**
  - Un Coach cambia el nombre y el color de un equipo una vez, y los siguientes eventos ya salen así: lo comprueba un test de la API y uno de la pantalla.
  - Ningún reparto publicado cambia de nombre ni de color al editar los del club: lo comprueba un test de integración.
  - En el móvil, Guardar y Publicar están siempre a mano, y ningún botón baja de 44 px.
  - Nada de lo que hoy hace el Team builder se pierde: sus tests de comportamiento siguen pasando, adaptados a los controles nuevos.

## 4. Alcance

**Incluido (v1):**

- Nombre y color de los equipos a nivel de club, con su endpoint y su edición desde la pantalla (ventana en escritorio, hoja en el móvil).
- Nombres propios para los doce colores.
- Fotos de los jugadores con el anillo del color de su equipo.
- Cabecera con Guardar y Publicar, barra con el evento, el estado del modo y Auto-balance.
- Totales con la barra partida y la diferencia.
- Columnas de equipo con la tira de color, la cobertura de puestos y filas con botones de icono.
- Banco con Añadir por equipo, y la sugerencia de intercambio con el estilo nuevo.
- El móvil con pestañas (equipo A, equipo B y banco) y la barra fija de Guardar y Publicar.

**Fuera de alcance (no v1):**

- La tarjeta "Juegas en" del inicio (es de E27).
- Más de dos equipos, o nombres y colores distintos por evento.
- Arrastrar con el dedo en el móvil.
- Editar los nombres y colores desde `/club`: se editan desde el Team builder.
- Cambiar cómo calcula el auto-balance o la sugerencia de intercambio.

## 5. Requerimientos funcionales

### RF-1 · Los equipos del club (Must)

- **Dado** la migración, **cuando** se aplica, **entonces** `club_settings` tiene los cuatro campos con Team Kelp `#1C6EA4` y Team Tide `#C99A3E` por defecto, y comprobaciones de longitud y de formato en la base.
- **Dado** un Admin o un Coach, **cuando** manda `PATCH /api/v1/club/team-labels` con dos equipos válidos, **entonces** se guardan y la respuesta los devuelve.
- **Dado** un nombre vacío o de más de 24 caracteres, un color fuera del muestrario o los dos colores iguales, **cuando** se manda, **entonces** responde 400 con el campo que falla.
- **Dado** un Committee o un Player, **cuando** lo manda, **entonces** responde 403.
- **Dado** un evento sin reparto guardado, **cuando** se abre el Team builder, **entonces** el borrador usa los equipos del club.
- **Dado** un reparto publicado, **cuando** se cambian los equipos del club, **entonces** el reparto publicado sigue con los suyos (D4).

### RF-2 · Los nombres de los colores (Must)

- **Dado** cada uno de los doce colores, **cuando** se nombra, **entonces** `nameTeamColor` devuelve su nombre (`red`, `orange`, `gold`, `yellow`, `green`, `teal`, `blue`, `navy`, `purple`, `pink`, `black`, `white`), con su texto en inglés y español.
- **Dado** un color que no es del muestrario, **cuando** se nombra, **entonces** devuelve la familia como hoy.

### RF-3 · Las fotos (Must)

- **Dado** un jugador con foto que el Coach puede ver según la regla del directorio, **cuando** sale en el Team builder, **entonces** su avatar es la foto; si no, sus iniciales.
- **Dado** un jugador en un equipo, **cuando** se pinta, **entonces** su avatar lleva un anillo de 2 px del color de ese equipo; en el banco, sin anillo.

### RF-4 · Cabecera, barra y totales (Must)

- **Dado** el Team builder en escritorio, **cuando** se pinta, **entonces** la cabecera lleva "EQUIPOS", el evento como H1, Guardar (con el punto y "Sin guardar" si hay cambios) y Publicar con `paper-plane-tilt`.
- **Dado** la barra, **cuando** se pinta, **entonces** lleva el selector de evento, el estado del modo y el botón Auto-balance (D8).
- **Dado** Auto-balance, **cuando** se pulsa, **entonces** reparte como hoy "Equilibrar equipos", el modo queda en automático y sale "Equipos equilibrados y guardados".
- **Dado** los totales, **cuando** se pintan, **entonces** muestran la suma de cada equipo, "Parejos" en éxito si la diferencia es de 1 o menos, o "{x} de diferencia" en aviso, y la barra de 8 px partida por suma en los colores de cada equipo.
- **Dado** Publicar, **cuando** se pulsa, **entonces** sale la confirmación de hoy con el borde de acento y "¿Publicar equipos? Se avisará a {n} jugadores de su equipo."

### RF-5 · Las columnas de equipo (Must)

- **Dado** cada equipo, **cuando** se pinta, **entonces** su tarjeta lleva la tira de 4 px de su color, el muestrario de 22 px, el nombre, "{n} jugadores · media {x}", el botón de editar y las fichas de cobertura POR, DEF y ATA.
- **Dado** un equipo con jugadores y sin portero, **cuando** se pinta, **entonces** la ficha de portero dice "Sin portero" con el icono de aviso.
- **Dado** una fila de jugador, **cuando** se pinta, **entonces** lleva el avatar, el nombre (con puntos suspensivos), la posición en mono, el OVR (o "—" si no está evaluado) y dos botones de icono: Cambiar ("Mover a {jugador} a {equipo}") y Quitar ("Sacar a {jugador} de {equipo}").
- **Dado** un equipo vacío, **cuando** se pinta, **entonces** dice "Arrastra jugadores aquí o usa Añadir en el banco."
- **Dado** escritorio, **cuando** arrastro una fila a otro equipo o al banco, **entonces** se mueve como hoy, con su anuncio.

### RF-6 · Editar un equipo (Must)

- **Dado** el botón de editar, **cuando** lo pulso en escritorio, **entonces** se abre la ventana "Editar equipo" anclada a la cabecera de la columna, con el nombre, "Color del peto · {color}" y los doce círculos, y el foco va al nombre.
- **Dado** el color del otro equipo, **cuando** se pinta, **entonces** está desactivado, al 35 %, con `prohibit` y el nombre "{Color} (lo usa {equipo})".
- **Dado** Aplicar, **cuando** se pulsa, **entonces** manda el PATCH de RF-1, actualiza el borrador abierto y sale "Equipo actualizado · se usa en todos los eventos desde ahora".
- **Dado** el nombre vacío, **cuando** se pinta, **entonces** Aplicar está desactivado.
- **Dado** que el PATCH falla, **cuando** vuelve el error, **entonces** la ventana sigue abierta con el aviso y lo escrito.
- **Dado** Escape o Cancelar, **cuando** se pulsa, **entonces** se cierra sin cambios y el foco vuelve al botón de editar.
- **Dado** el móvil, **cuando** pulso editar, **entonces** es una hoja inferior con el nombre de 48 px, círculos de 44 px y Cancelar y Aplicar.

### RF-7 · Banco y sugerencia (Must)

- **Dado** el banco, **cuando** se pinta, **entonces** hay dos columnas, "DISPONIBLES · VAN {n}" y "QUIZÁS {n}", con filas sin anillo y un botón Añadir por equipo con el punto de su color y su nombre corto (D10).
- **Dado** listas vacías, **cuando** se pintan, **entonces** dicen "Todos los que van ya tienen equipo." y "Nadie dijo quizás.".
- **Dado** una sugerencia de intercambio, **cuando** se pinta, **entonces** va con borde de acento discontinuo, la bombilla, el texto de hoy y "Intercambiar".

### RF-8 · El móvil (Must)

- **Dado** menos de 768 px, **cuando** se pinta, **entonces** la cabecera lleva el título, Auto-balance como botón de icono de 44 px y los totales con la barra de 6 px.
- **Dado** el móvil, **cuando** se pinta, **entonces** hay tres pestañas de 40 px (nombre corto del equipo A, del B y Banco), con el punto del color y el número; solo se ve la elegida.
- **Dado** una fila en el móvil, **cuando** se pinta, **entonces** mide al menos 58 px, con el avatar de 38 px, el nombre en hasta dos líneas, "{posición} · OVR x.x" o "Sin evaluar", y botones de 44 px.
- **Dado** el banco en el móvil, **cuando** se pinta, **entonces** cada fila lleva un botón de 44 px por equipo con el punto del color y "+".
- **Dado** el móvil, **cuando** se pinta, **entonces** Guardar y Publicar van fijos abajo, de 48 px, con el borde de arriba en aviso mientras hay cambios sin guardar.
- **Dado** Publicar en el móvil, **cuando** se pulsa, **entonces** la confirmación es una hoja inferior.

## 6. Casos borde y estados de error

- **Sin eventos para armar:** el mensaje de hoy.
- **Guardar o publicar falla:** el aviso de hoy, y el borrador se queda.
- **Conflicto al guardar el reparto:** como hoy.
- **Otro Coach cambió los equipos del club mientras tanto:** gana el último PATCH; no hay conflicto propio.
- **Jugador sin posición:** la fila no lleva posición y no cuenta en la cobertura.
- **Nombre largo de equipo:** puntos suspensivos en la columna, las pestañas y los botones del banco.
- **Equipos con el mismo color en un reparto viejo:** se pintan como están (D5).
- **Idioma:** todos los textos nuevos en `en.ts` y `es.ts`, y se borran los que ya no se usan (`teams.mode.manual`, `teams.mode.auto` y los textos visibles de Cambiar y Quitar), conservando los nombres accesibles.

## 7. UX / UI

- Diseño: `docs/design/design_handoff_teams/` (#1a escritorio, #2a móvil; capturas 01 a 06).
- Viewports a revisar: 375, 768 y 1440, en claro y oscuro.
- El `ui-reviewer` compara contra las capturas 01 a 06 (Modo A) y revisa contra `design-system.md` lo no dibujado.

## 8. Requerimientos no funcionales

- **Seguridad:** el PATCH de los equipos comprueba la capacidad en el servidor; las fotos se firman con la regla del directorio.
- **Accesibilidad:** WCAG AA, axe sin violaciones en cada estado, foco atrapado en la ventana y la hoja, foco visible.
- **Dependencias:** ninguna nueva.

## 9. Preguntas abiertas

Ninguna. La que dejaba el handoff (los nombres `gold` y `navy`) se resuelve en D6.

## 10. Descomposición en tickets (para write-ticket)

Todos con `ui-review`, salvo el 1 y el 2. Las capturas de Playwright `equipos-*` se rehacen ticket a ticket.

| #   | Título propuesto                                                       | Tamaño | Depende de | Auto-merge sugerido                         |
| --- | ---------------------------------------------------------------------- | ------ | ---------- | ------------------------------------------- |
| 1   | Guarda el nombre y el color de los equipos en el club                  | M      | ninguna    | No: migración, endpoint y permisos          |
| 2   | Da nombre propio a los doce colores de los petos                       | S      | ninguna    | No: cambia textos del calendario            |
| 3   | Pone la foto de cada jugador en el Team builder                        | S      | ninguna    | No: firma fotos con la regla del directorio |
| 4   | Rehace la cabecera, la barra con Auto-balance y los totales            | M      | ninguna    | No: pantalla nueva                          |
| 5   | Rehace las columnas de equipo con cobertura y botones de icono         | M      | 3, 4       | No: pantalla nueva                          |
| 6   | Permite editar el nombre y el color de un equipo desde el Team builder | M      | 1, 2, 5    | No: escribe datos del club                  |
| 7   | Rehace el banco y la sugerencia de intercambio                         | S      | 5          | No: pantalla nueva                          |
| 8   | Lleva el Team builder al móvil con pestañas y la barra de guardar fija | M      | 6, 7       | No: pantalla nueva                          |

Nota: con el 2 hecho, el inicio de E27 puede decir "peto {color}" en la franja de equipo (#747); se ajusta ese ticket.
