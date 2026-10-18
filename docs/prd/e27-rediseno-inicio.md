# PRD: E27 · El rediseño del inicio

**Estado:** borrador · **Fecha:** 19 de octubre de 2026 · **Autor:** sesión de planificación (Claude Code)

Fuente: el diseño que el dueño hizo con Claude Design, guardado en `docs/design/design_handoff_dashboard/`. Contiene el prototipo `Dashboard Upgrade.dc.html`, su `README.md` de handoff, `support.js` y seis capturas en `screenshots/`. Se construyen **#1a** en escritorio y **#2a** en móvil (por debajo de 768 px), en las tres vistas del selector "Ver como": Player, socio vencido y Admin/Coach. Es una épica añadida después del plan. Rehace la pantalla de inicio de E14 (`DashboardScreen` y `GET /api/v1/dashboard`), reutiliza lo visual de E22 (noticias), E24 (calendario) y E10 (equipos), y añade un único dato nuevo: el inicio de la temporada.

El `README.md` del handoff es parte de este PRD. Tiene las medidas, los colores, los textos y cada estado. Cuando no coinciden, manda lo que dice aquí.

Las decisiones van marcadas de D1 a D17. D1, D2 y D3 las tomó el dueño el 19 de octubre de 2026. Las demás salen del código actual y el dueño las ratifica al aprobar este PRD.

- **D1.** **La temporada la configura el Admin.** `club_settings` gana `season_starts_on` (fecha, opcional), que se edita en la pestaña General de `/club`. La temporada va desde esa fecha hasta hoy. Sin fecha, o con una fecha futura, cuenta desde el 1 de enero del año en curso. No hay fecha de fin: la temporada siguiente empieza cuando el Admin pone otra fecha.
- **D2.** **Un socio restringido ve en el inicio solo los títulos de las noticias.** Cada una con su categoría y su fecha, sin portada, sin extracto y sin el punto de sin leer. Encima, una fila con candado: "Las noticias son para socios al día." y "Renovar" a Pagos. Pulsar un título lleva a Pagos, como hoy pasa al intentar abrir Noticias. La sección Noticias y su API siguen cerradas para él (`MEMBER_ONLY_ROUTES`), y la API del inicio no le manda ni el texto ni la portada. El dueño lo decidió el 19 de octubre de 2026, afinando lo que pedía el handoff.
- **D3.** **Admin, Coach y Committee ven la columna de gestión** ("Pendientes" y "Números del club"). El Player ve la suya ("Mi asistencia" y "Membresía"). Cada pendiente sale solo a quien puede resolverlo (D9).
- **D4.** **"Próximo" es el siguiente evento que el socio puede ver**, de cualquier tipo, no solo entrenamientos. Lo decide la audiencia del evento, como en el calendario. Un evento que ya empezó y no ha terminado sigue siendo el próximo hasta su hora de fin.
- **D5.** **No hay regla nueva para las reuniones.** El handoff dice que las reuniones solo salen a Admin y Coach; hoy lo decide la audiencia del evento y así sigue. Una reunión con audiencia "todo el club" la ve todo el club, aquí y en el calendario.
- **D6.** **La franja de equipo usa lo que guarda el reparto:** nombre del equipo, su color (el muestrario y el tinte) y la posición del socio (`members.position_id`). No hay "color del peto" con nombre, así que el texto es "**{equipo}** · {posición}", sin "blue bib". Sin posición, solo el equipo.
- **D7.** **El punto de "sin leer" sale de `news_seen_at`**, como el contador de hoy: una noticia publicada después de la última visita a Noticias (o en los últimos 30 días si nunca entró) lleva el punto. No hay lectura por noticia.
- **D8.** **El aviso del socio restringido depende de su bloqueo**, como hoy (`MembershipNotice`): `pending` pide activar la membresía, `past_due` avisa del pago fallido y `cancelled` dice "Tu membresía venció el {fecha}". La fecha es el fin del último periodo pagado (`currentPeriodEnd`), que hoy no se devuelve. Sin fecha, el título no la lleva. El botón siempre lleva a Pagos.
- **D9.** **Quién ve cada pendiente** sigue la matriz de capacidades: las solicitudes de rol, `manageUsersAndRoles` (Admin); tomar asistencia y publicar equipos, `buildTeamsAndTrackAttendance` (Admin y Coach); "{n} no han respondido", todo el que ve la columna de gestión, porque solo abre el evento.
- **D10.** **"Tomar asistencia" es el entrenamiento pasado más reciente sin hoja**, dentro de los últimos 30 días (la misma ventana que `GET /api/v1/attendance/sessions`). Uno solo, aunque falten varios.
- **D11.** **"Asistencia del club" es la de hoy** (`club_attendance_rate`, últimos 30 días) comparada con los 30 días anteriores. La flecha y el texto van en éxito si subió, en peligro si bajó, y sin flecha si es igual o falta uno de los dos datos. Sale a los tres roles de gestión; enlaza a Asistencia solo si el rol puede abrirla.
- **D12.** **"+ Evento" sale a quien puede crear eventos** (`createEvents`: Admin y Committee), como hoy (`canCreateTrainings`). El handoff dice Admin y Coach, pero el Coach no puede crear eventos.
- **D13.** **"Mi asistencia" usa la regla de `attendance_stats`** (presente o tarde sobre sesiones elegibles), recortada a la temporada (D1). "Últimas 10" son las 10 sesiones elegibles más recientes, sean o no de esta temporada. En la columna de gestión, la celda se esconde si el socio no tiene sesiones elegibles.
- **D14.** **La franja de la semana va de hoy a hoy + 6.** Un evento de varios días sale en cada día que ocupa. Los puntos son uno por tipo presente, hasta tres. Sin elegir, el día marcado es el del evento "Próximo" si cae en la franja, y si no, hoy.
- **D15.** **Los colores sueltos se vuelven tokens o reutilizan los de E21 a E26** (`--color-hover`, `--color-segment-selected` y los de tipo de evento de E24). Ningún hex nuevo en las reglas.
- **D16.** **Ningún objetivo táctil baja de 44 px**, como en E22 a E26. El español usa tú.
- **D17.** **Están diseñados el escritorio y el móvil, en tema oscuro.** El corte es 768 px. El tema claro aplica el mismo diseño con los tokens claros, y la tableta usa el de escritorio. Lo que no está dibujado (cargando, sin eventos, sin noticias, secciones que fallan) lo revisa el `ui-reviewer` contra `design-system.md`.

## 1. Problema

El inicio abre con cuatro números que sirven sobre todo al Admin. Lo que un socio quiere saber al entrar (qué toca, si va, en qué equipo juega) queda abajo o no está. En el PC no se puede responder al próximo evento desde el inicio; en el móvil sí, pero solo para el próximo entrenamiento. Un socio con la membresía vencida ve un inicio casi vacío que no explica qué pierde. El Admin y el Coach no tienen un sitio que les diga qué tienen pendiente.

## 2. Usuarios y contexto

- **Player, sobre todo desde el móvil:** entra para ver el próximo evento, responder y saber en qué equipo juega.
- **Coach:** además mira si falta tomar asistencia o publicar equipos.
- **Admin:** además revisa solicitudes de rol y los números del club, sobre todo desde el portátil.
- **Committee:** organiza eventos y quiere saber quién no ha respondido.
- **Socio con la membresía vencida, pendiente o con el pago fallido:** ve qué hay, pero no puede responder.
- **Hoy lo resuelven así:** abriendo el calendario para responder, Asistencia para ver qué falta, el directorio para las solicitudes y Equipos para los repartos.

## 3. Objetivo y métricas de éxito

- **Objetivo:** que lo siguiente que toca esté arriba para todos, y que cada rol vea lo suyo debajo.
- **Métricas:**
  - Un socio responde al próximo evento desde el inicio con un toque, en el PC y en el móvil.
  - Un Admin ve en el inicio cada pendiente que le aplica, y ninguno que no pueda resolver: lo comprueban los tests de la API por rol.
  - Un socio restringido no puede responder desde el inicio, y el aviso le dice por qué y le lleva a Pagos.
  - Lo que hoy hace el inicio no se pierde: el saludo, el aviso de contacto, `+ Evento`, los estados de carga y fallo y los dos idiomas.

## 4. Alcance

**Incluido (v1):**

- La fecha de inicio de la temporada en la pestaña General de `/club`.
- La tarjeta "Próximo" con imagen o fondo del tipo, cuándo, dónde, Cómo llegar, RSVP, la franja de equipo y el aviso de reparto sin publicar.
- "Esta semana": la franja de siete días y los eventos del día elegido con mi respuesta.
- La columna del Player: mi asistencia de la temporada con las últimas 10, y la membresía.
- La columna de gestión: pendientes y números del club.
- Noticias con portada, fijada, extracto y punto de sin leer.
- El inicio del socio restringido: el mismo inicio, en lectura, con su aviso.
- El móvil (#2a) con el mismo contenido en una columna.
- Retirar las cuatro casillas de hoy (`tiles.*`) y los componentes que dejan de usarse.

**Fuera de alcance (no v1):**

- Temporadas con fecha de fin, o varias temporadas guardadas.
- Lectura de noticias por noticia.
- Una regla nueva de quién ve las reuniones (D5).
- Responder desde los eventos de "Esta semana": la fila lleva al evento, como hoy en la agenda.
- Cambiar qué abre la sección Noticias a un socio restringido (D2).
- Notificaciones de los pendientes.

## 5. Requerimientos funcionales

### RF-1 · La temporada (Must)

El Admin fija la fecha de inicio de la temporada en General; el inicio cuenta la asistencia desde ahí (D1).

- **Dado** un Admin en `/club?tab=general`, **cuando** elige una fecha en "Inicio de temporada" y guarda con la barra de cambios, **entonces** se guarda en `club_settings.season_starts_on` y el aviso de guardado sale como en el resto de General.
- **Dado** el campo vacío, **cuando** se guarda, **entonces** la columna queda en null y la temporada cuenta desde el 1 de enero.
- **Dado** un Committee, **cuando** abre `/club`, **entonces** no ve el campo (General no es suya) y la API le rechaza el cambio con 403.
- **Dado** otro Admin que cambió la configuración mientras tanto, **cuando** se guarda, **entonces** sale el conflicto de General de hoy (`club_settings_changed`).

### RF-2 · Lo que devuelve el inicio (Must)

`GET /api/v1/dashboard` devuelve los datos nuevos del README del handoff, con estos ajustes. Cada bloque falla por su cuenta (`{ kind: "unavailable" }`), como hoy.

- **Dado** un socio, **cuando** pide el inicio, **entonces** `nextUp` es el evento de D4 con `id`, `title`, `eventType`, `startsOn`, `startTime`, `endTime`, `endsOn`, `location`, `place`, `coverUrl`, `audience`, `goingCount`, `maybeCount` y `myResponse`, o `none`.
- **Dado** un Player en el reparto publicado de ese evento, **cuando** pide el inicio, **entonces** `nextUp.myTeam` es `{ name, color, position }`; si el reparto es borrador, no existe, no está en él o es un socio restringido, es null.
- **Dado** un Admin o un Coach, **cuando** el próximo evento tiene reparto, **entonces** `nextUp.teamsStatus` es `draft` o `published`; sin reparto, `none`. A los demás roles no se les manda.
- **Dado** cualquier socio, **cuando** pide el inicio, **entonces** `week` trae los eventos que ve de hoy a hoy + 6 (D14), con `id`, `title`, `eventType`, `startsOn`, `endsOn`, `startTime`, `endTime`, `location` y `myResponse`.
- **Dado** un socio con sesiones elegibles, **cuando** pide el inicio, **entonces** `me.attendance` es `{ percent, attended, sessions, last10 }` según D13; sin sesiones elegibles, null.
- **Dado** cualquier socio, **cuando** pide el inicio, **entonces** `membership` es `{ status, renewsOn }` si está al día, o `{ status, block, endedOn }` si está restringido (D8).
- **Dado** Admin, Coach o Committee, **cuando** pide el inicio, **entonces** recibe `todos` (D9, D10) y `club` (`attendance` con `percent` y `previousPercent`, `members` con `active` y `joinedThisMonth`, `unreadNews`). Un Player no los recibe.
- **Dado** un socio al día, **cuando** pide el inicio, **entonces** `latestNews` trae hasta tres noticias con `coverUrl`, `isPinned`, `isUnread`, `excerpt`, `category` y `publishedAt`: primero la fijada si la hay, luego las más nuevas.
- **Dado** un socio restringido, **cuando** pide el inicio, **entonces** `latestNews` trae las mismas tres noticias solo con `id`, `title`, `category` y `publishedAt` (D2): ni `coverUrl`, ni `excerpt`, ni `isUnread`.

### RF-3 · La tarjeta "Próximo" (Must)

- **Dado** un evento próximo con portada, **cuando** se pinta, **entonces** sale la portada; sin portada, el fondo y el icono de su tipo (E24), con "PRÓXIMO · EN {n} DÍAS" (o "HOY" y "MAÑANA") y la barra de 4 px del color del tipo.
- **Dado** el evento, **cuando** se pinta, **entonces** salen su tipo, su audiencia, el título, "{día} · {inicio} – {fin} · {duración}" (sin fin si no lo tiene) y el lugar con "Cómo llegar" si tiene coordenadas o dirección, con el mismo enlace del calendario.
- **Dado** un socio al día, **cuando** pulsa Voy, Quizás o No puedo, **entonces** se guarda con `useEventRsvp` como en el calendario, el botón marcado toma el tinte de su respuesta y "{n} van · {m} quizás" se actualiza cuando el servidor confirma.
- **Dado** un socio restringido, **cuando** se pinta, **entonces** en lugar de los botones sale la fila con candado "Responder es para socios al día." y "Renovar" a Pagos.
- **Dado** un Player con `myTeam`, **cuando** se pinta, **entonces** sale la franja "JUEGAS EN", con el muestrario y el tinte del color del equipo, y "Alineaciones ›" al evento con su reparto.
- **Dado** un Admin o un Coach con `teamsStatus = draft`, **cuando** se pinta, **entonces** sale la fila discontinua "Los equipos están guardados pero **sin publicar**." con "Abrir equipos ›" al Team builder de ese evento.
- **Dado** que no hay evento próximo, **cuando** se pinta, **entonces** la tarjeta dice "No hay nada próximo." y, a quien puede crear eventos, ofrece "+ Evento".

### RF-4 · Esta semana (Must)

- **Dado** el inicio, **cuando** se pinta, **entonces** salen siete días desde hoy, cada uno con el día de la semana, la fecha y hasta tres puntos de los tipos que tiene; hoy lleva el día de la semana en acento.
- **Dado** la franja, **cuando** pulso un día, **entonces** queda marcado (`aria-pressed`) y debajo salen sus eventos con la barra del tipo, inicio y fin, título y lugar, y mi respuesta: Voy (éxito), Quizás (aviso) o "Responder" (acento). Un socio restringido no ve "Responder".
- **Dado** un día sin eventos, **cuando** lo elijo, **entonces** sale "Nada el {día}.".
- **Dado** un evento de la lista, **cuando** lo pulso, **entonces** abre ese evento en el calendario.
- **Dado** el teclado, **cuando** el foco está en la franja, **entonces** las flechas izquierda y derecha mueven el foco entre días.

### RF-5 · La columna del Player (Must)

- **Dado** un Player con `me.attendance`, **cuando** se pinta, **entonces** "Mi asistencia" enseña "Esta temporada", el porcentaje y "{n} de {m} sesiones", y "Últimas 10" con un bloque por sesión (presente en éxito, tarde en aviso, ausente en peligro) y su leyenda. Cada bloque tiene nombre para el lector de pantalla ("{fecha}: tarde").
- **Dado** un Player sin sesiones elegibles, **cuando** se pinta, **entonces** la tarjeta dice "Todavía no hay sesiones esta temporada.".
- **Dado** un Player al día, **cuando** se pinta, **entonces** "Membresía activa" con "{plan} · se renueva el {fecha}" en éxito, y la flecha a Pagos.
- **Dado** un socio restringido, **cuando** se pinta, **entonces** la tarjeta dice el estado de D8 en peligro, con la flecha a Pagos.

### RF-6 · La columna de gestión (Must)

- **Dado** un Admin, Coach o Committee, **cuando** se pinta, **entonces** "Pendientes" lleva el número de filas y solo las de D9 que aplican: "{n} solicitudes de rol" → Revisar (directorio, solicitudes); "Tomar asistencia" con "{evento} · {fecha}" → Tomar (la hoja de esa sesión); "Publicar equipos" con "{evento} · guardado, sin publicar" → Abrir (Team builder); "{n} no han respondido" con el próximo evento → Ver quién (el evento).
- **Dado** que no hay nada pendiente, **cuando** se pinta, **entonces** sale "✓ Todo al día." en éxito, sin número.
- **Dado** los números del club, **cuando** se pintan, **entonces** salen "Asistencia del club" con la tendencia de D11, "Mi asistencia" (escondida si no tiene sesiones, D13), "Socios" con "+{n} este mes" y "Noticias sin leer" con "{n} avisos". Cada celda enlaza a su sección si el rol puede abrirla.

### RF-7 · Noticias (Must)

- **Dado** noticias, **cuando** se pintan, **entonces** la destacada es la fijada o la más nueva, con portada o el fondo de su categoría (E22), "📌 FIJADA" o la categoría, "{categoría} · {hace cuánto}", título y dos líneas de extracto; las otras dos van en pequeño con miniatura, y la que está sin leer lleva el punto (D7), con nombre para el lector de pantalla.
- **Dado** que no hay noticias, **cuando** se pinta, **entonces** la sección dice "Todavía no hay noticias." y conserva "Todas las noticias".
- **Dado** un socio restringido, **cuando** se pinta, **entonces** ve la fila con candado "Las noticias son para socios al día." con "Renovar", y debajo la lista de títulos con su categoría y su fecha, sin portada, extracto ni punto (D2).
- **Dado** un socio restringido, **cuando** pulsa un título o "Todas las noticias", **entonces** va a Pagos.

### RF-8 · Cabecera y avisos (Must)

- **Dado** el inicio, **cuando** se pinta, **entonces** sale "{DÍA} {d} {MES} · INICIO" en mono y el saludo de `greetingPeriodAt`; a quien puede crear eventos, "+ Evento" (D12).
- **Dado** un socio al día al que le falta el contacto, **cuando** se pinta, **entonces** sale la franja del aviso de contacto con "Añadir contacto" y cerrar, como hoy.
- **Dado** un socio restringido, **cuando** se pinta, **entonces** sale el aviso de D8 con "Renovar membresía" a Pagos, y no sale el de contacto.

### RF-9 · El móvil (Must)

- **Dado** menos de 768 px, **cuando** se pinta, **entonces** va todo en una columna en este orden: saludo, aviso, "Próximo", Pendientes (gestión), Esta semana, Mi asistencia y Membresía lado a lado (Player) o los números del club (gestión), y Noticias; con las medidas del README (#2a).
- **Dado** el móvil, **cuando** se pinta "Próximo", **entonces** "Cómo llegar" ocupa el ancho y los tres botones de respuesta miden 56 px, con el icono encima del texto.
- **Dado** el móvil, **cuando** se pinta el inicio, **entonces** no hay scroll horizontal a 320 px.

### RF-10 · Se retira lo viejo (Must)

- **Dado** el inicio nuevo, **cuando** está todo, **entonces** `tiles.*`, `upcomingEvents` y `nextTraining` salen de la respuesta, y `DashboardTiles`, `NextTrainingCard`, `ReadOnlyTrainingCard` y `UpcomingPanel` se borran con sus estilos y textos, sin que quede código muerto.

## 6. Casos borde y estados de error

- **Cargando:** cada bloque tiene su esqueleto; el saludo no espera a los demás.
- **Un bloque falla:** ese bloque dice que no se pudo cargar, con "Reintentar"; los demás se pintan.
- **Falla la membresía:** como hoy, falla todo el inicio con el aviso de error de la pantalla.
- **Evento de varios días como próximo:** "{día inicio} {hora} – {día fin} {hora}" como en el calendario.
- **Evento sin hora de fin (anterior a E24):** sin fin ni duración.
- **Evento cancelado:** no cuenta como próximo ni sale en la semana.
- **Responder falla:** el mismo aviso de `describeRsvpFailure` bajo los botones, y la respuesta anterior queda.
- **Equipo sin posición del socio:** solo el nombre del equipo (D6).
- **Temporada con fecha futura:** cuenta desde el 1 de enero (D1).
- **Socio que se unió esta temporada:** solo cuentan sus sesiones desde `joined_on`, como en `attendance_stats`.
- **Menos de 10 sesiones:** "Últimas 10" pinta las que hay.
- **Committee sin pendientes que le apliquen:** "✓ Todo al día.".
- **Idioma:** todos los textos nuevos en `en.ts` y `es.ts`; las fechas con el formato del idioma.

## 7. UX / UI

- Diseño: `docs/design/design_handoff_dashboard/` (#1a escritorio, #2a móvil; capturas 01 a 06).
- Reutilizar: los colores, fondos e iconos de tipo de E24 (`design_handoff_calendar`), las portadas y fijadas de E22 (`design_handoff_news`), `EventRsvp`, `MembershipNotice` y `ContactReminderNotice`.
- Viewports a revisar: 375, 768 y 1440, en claro y oscuro.
- El `ui-reviewer` compara contra las capturas 01 a 06 (Modo A) y revisa contra `design-system.md` lo no dibujado.

## 8. Requerimientos no funcionales

- **Rendimiento:** el inicio sigue siendo una sola petición; los bloques nuevos no añaden más de una consulta por bloque.
- **Seguridad:** cada dato de gestión se calcula en el servidor según la capacidad del que pide (D9, D11); un Player nunca recibe `todos` ni `club`.
- **Accesibilidad:** WCAG AA, axe sin violaciones en cada estado, foco visible, 44 px mínimos (D16).
- **Dependencias:** ninguna nueva.

## 9. Preguntas abiertas

Ninguna. Las tres que dejó el handoff (temporada, noticias del socio vencido y la vista del Committee) las decidió el dueño el 19 de octubre de 2026 (D1 a D3).

## 10. Descomposición en tickets (para write-ticket)

Todos con `ui-review`, salvo el 1, el 2 y el 3. Las capturas de Playwright `inicio-*` se rehacen ticket a ticket.

| #   | Título propuesto                                                          | Tamaño | Depende de | Auto-merge sugerido                                    |
| --- | ------------------------------------------------------------------------- | ------ | ---------- | ------------------------------------------------------ |
| 1   | Añade el inicio de temporada a la pestaña General del club                | S      | #720       | No: migración y permisos de General                    |
| 2   | Devuelve en el inicio el próximo evento, la semana y la membresía         | M      | ninguna    | No: lógica nueva en la API, socios restringidos        |
| 3   | Devuelve en el inicio la asistencia de la temporada, pendientes y números | M      | 1          | No: datos por rol (D9)                                 |
| 4   | Rehace la cabecera, los avisos y la tarjeta Próximo con RSVP y equipo     | M      | 2          | No: pantalla nueva                                     |
| 5   | Añade Esta semana con la franja de siete días                             | M      | 2          | No: pantalla nueva                                     |
| 6   | Añade la columna del Player con mi asistencia y la membresía              | S      | 3, 4       | No: pantalla nueva                                     |
| 7   | Añade la columna de gestión con pendientes y números del club             | M      | 3, 4       | No: pantalla nueva y datos por rol                     |
| 8   | Rehace las noticias del inicio con portada, fijada y sin leer             | S      | 2, 4       | No: lo que ve el socio restringido (D2)                |
| 9   | Ordena el inicio en el móvil y retira las casillas viejas                 | M      | 5, 6, 7, 8 | No: borra código y mueve todas las capturas `inicio-*` |

Notas:

- El 1 espera al #720 porque los dos tocan la pestaña General; si el #720 ya entró, no bloquea.
- El 2 incluye `latestNews` con portada, fijada, sin leer y extracto, que usa el 8.
- Cada ticket de pantalla (4 a 8) hace su parte en escritorio y en móvil; el 9 deja el orden del móvil (RF-9) y borra lo viejo (RF-10).
