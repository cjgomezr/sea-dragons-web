# PRD: E7 · Calendario y eventos + RSVP

**Estado:** aprobado · **Fecha:** 23 de septiembre de 2026 · **Autor:** sesión de planificación (Claude Code)

Fuente: `docs/SRD_Victoria_Seadragons_Club_Platform.md` (v1.4), epic E7 de `docs/plan-maestro.md` y la matriz de permisos de su sección 4. Cubre FR-028 a FR-037 y los criterios AC-013, AC-014, AC-015, AC-046, AC-050, AC-051 y AC-052. Aplica la regla B7 de `docs/preguntas-abiertas.md` (la participación sale del RSVP y de los grupos, nunca del rol) y la política de avisos del plan maestro. `docs/preguntas-abiertas.md` no deja nada sin resolver para esta épica.

## 1. Problema

El club entrena dos veces por semana, compite, se reúne y organiza sociales, y hoy todo eso se anuncia por WhatsApp. Nadie sabe con antelación cuántos van a ir: el coach llega a la piscina sin saber si tiene doce jugadores o seis, y la historia del SRD lo pide con esas palabras: "so that coaches know real numbers".

Además el plan entero espera por esta épica. La asistencia (E8) se registra sobre sesiones que todavía no existen, el team builder (E10) arma equipos con quienes confirmaron, y el dashboard (E14) muestra los próximos eventos. Sin eventos, esas tres épicas no tienen sobre qué trabajar.

## 2. Usuarios y contexto

- **Committee y Admin:** publican el calendario. La historia del SRD: quieren crear un entrenamiento semanal con sus días y su fecha de fin, "so that the whole winter schedule is published in one action". Lo hacen desde el escritorio casi siempre.
- **Cualquier miembro (Player, Coach, Committee, Admin):** mira qué hay y dice si va. Desde el móvil, casi siempre. Un Coach que juega confirma igual que un Player (B7).
- **Coach:** quiere saber cuántos van y quiénes, para planificar la sesión. No crea eventos (ASS-006).
- **Hoy lo resuelven así:** un mensaje en el grupo de WhatsApp y un recuento a ojo de las respuestas.

## 3. Objetivo y métricas de éxito

- Objetivo: que el club publique su calendario en la aplicación y cada miembro vea lo suyo y diga si va, con un número real antes de cada sesión.
- Métricas:
  - Publicar una temporada de entrenamientos de martes y jueves lleva una sola acción (AC-014).
  - Responder a un evento lleva un toque desde la agenda, sin abrir otra pantalla.
  - Ningún miembro ve, ni por API, un evento cuya audiencia no lo incluye (AC-052).
  - Los conteos de "van" y "quizás" coinciden siempre con las respuestas guardadas de quienes forman parte de la audiencia.

## 4. Alcance

**Incluido (v1):**

- Eventos puntuales y series semanales, de los cuatro tipos, con audiencia "todo el club" o grupos (FR-028 a FR-031).
- La agenda: de hoy en adelante, con acceso a los pasados (FR-033).
- El RSVP en cada fila de la agenda, con sus conteos y los nombres de quién va (FR-034 a FR-036).
- Cada fila se despliega con las notas del evento y quién va.
- El diálogo para crear eventos, solo para Admin y Committee.
- Editar y cancelar un evento suelto, una ocurrencia o una serie entera de hoy en adelante.
- Avisar a la audiencia al crear (FR-037) y, como mejora, al cambiar o cancelar.

**Explícitamente fuera (por ahora):**

- Las vistas de mes y de semana (ASS-010). El control del mockup no se dibuja.
- Hora de fin o duración de un evento: el SRD solo pide la hora.
- Responder a una serie entera de una vez: el RSVP es por ocurrencia.
- Borrar eventos y deshacer una cancelación.
- Cambiar los días o las fechas de una serie ya creada: se cancela el resto y se crea otra.
- Que el aviso lleve al evento: los avisos de E6 no tienen destino.
- Avisos por correo: la política de avisos no los pide para eventos.
- Auditoría de eventos: NFR-010 no la pide.
- Que un Coach vea sesiones fuera de su audiencia para registrar asistencia: lo decide E8.
- Recordatorios antes del evento y generación diferida de ocurrencias con `pg_cron`: E16b.

## 5. Requerimientos funcionales

### RF-1 · Los eventos, sus series y su audiencia se guardan con reglas en la base · Must

- **Dado** un evento, **cuando** se mira en la base, **entonces** tiene club, título, tipo, fecha, hora de inicio, lugar, notas opcionales, audiencia, estado y, si viene de una serie, su serie.
- **Dado** un tipo fuera de Training, Competition, Meeting y Social, **cuando** se guarda, **entonces** la base lo rechaza (AC-051).
- **Dado** un título vacío o de más de 80 caracteres, un lugar vacío o de más de 120, o notas de más de 2000, **cuando** se guarda, **entonces** la base lo rechaza.
- **Dado** una fecha y una hora, **cuando** se guardan, **entonces** son de Melbourne (`CLUB_TIME_ZONE`) y el momento de inicio se deriva de las dos.
- **Dado** una audiencia de grupos, **cuando** se guarda con un grupo de otro club, **entonces** la base lo rechaza.
- **Dado** una serie, **cuando** se mira en la base, **entonces** guarda sus días de la semana, su fecha de inicio y de fin, y los campos que comparten sus ocurrencias.
- **Dado** un grupo que se borra, **cuando** un evento lo tenía de audiencia, **entonces** el evento deja de tenerlo y sigue existiendo.
- **Dado** un usuario autenticado, **cuando** consulta los eventos directamente, **entonces** solo ve los de su audiencia, y no puede escribir nada. Un cliente anónimo no ve nada.

### RF-2 · Crear un evento puntual · Must

- **Dado** un Committee, **cuando** crea una Competition dirigida a "Senior Squad", **entonces** el evento existe con esa audiencia (FR-028, AC-013).
- **Dado** un Coach o un Player, **cuando** intenta crear un evento por API, **entonces** recibe 403 y no se crea nada (ASS-006).
- **Dado** una fecha y hora que ya pasaron, **cuando** se intenta crear, **entonces** se rechaza con 422.
- **Dado** una audiencia de grupos vacía, o con un grupo que no existe en el club, **cuando** se intenta crear, **entonces** se rechaza con 422.

### RF-3 · Crear una serie semanal · Must

- **Dado** una Training de martes y jueves del 1 de julio al 31 de agosto, **cuando** se crea, **entonces** existe una ocurrencia por cada martes y cada jueves de ese rango, ambos extremos incluidos (FR-030, FR-031, AC-014).
- **Dado** que crear una ocurrencia falla, **cuando** pasa, **entonces** no queda ni la serie ni ninguna ocurrencia: todo o nada.
- **Dado** una serie a las 19:00 que cruza el cambio de horario de abril, **cuando** se generan las ocurrencias, **entonces** todas empiezan a las 19:00 de Melbourne.
- **Dado** un rango de más de un año, o sin ningún día de la semana elegido, o con la fecha de fin antes de la de inicio, **cuando** se intenta crear, **entonces** se rechaza con 422.
- **Dado** un rango que no contiene ninguno de los días elegidos, **cuando** se intenta crear, **entonces** se rechaza con 422 diciendo que no saldría ninguna sesión.
- **Dado** una serie que empieza hoy a una hora que ya pasó, **cuando** se crea, **entonces** la ocurrencia de hoy no se genera y las demás sí.

Las ocurrencias se generan al crear la serie. El plan maestro ya lo decidió al partir E16: E7 se entrega sin `pg_cron`.

### RF-4 · Cada miembro ve solo lo suyo · Must

- **Dado** un evento dirigido a "Senior Squad", **cuando** lo busca un miembro de ese grupo, **entonces** lo ve; **cuando** lo busca uno que no está en ningún grupo de la audiencia, **entonces** no lo ve (FR-032, AC-050).
- **Dado** un evento para todo el club, **cuando** lo busca cualquier miembro activo, **entonces** lo ve.
- **Dado** un miembro fuera de la audiencia, **cuando** pide el evento por su identificador a la API, **entonces** recibe 404, y la base tampoco se lo devuelve (AC-052).
- **Dado** un Admin o un Committee, **cuando** abre el calendario, **entonces** ve todos los eventos del club, porque son quienes los gestionan.
- **Dado** un Coach, **cuando** abre el calendario, **entonces** ve solo los de su audiencia, como cualquier miembro.

### RF-5 · Responder a un evento · Must

- **Dado** un miembro de la audiencia, **cuando** responde "Quizás" y luego "Sí" antes de que empiece, **entonces** queda guardado "Sí" con la hora de la última respuesta (FR-034, FR-035, AC-015).
- **Dado** un evento que ya empezó, **cuando** alguien intenta responder, **entonces** se rechaza con 422.
- **Dado** un evento cancelado, **cuando** alguien intenta responder, **entonces** se rechaza con 422.
- **Dado** un miembro fuera de la audiencia, incluido un Admin o un Committee, **cuando** intenta responder, **entonces** recibe 404.
- **Dado** una ocurrencia de una serie, **cuando** se responde, **entonces** la respuesta vale solo para esa ocurrencia.
- **Dado** un doble toque, **cuando** llegan dos peticiones iguales, **entonces** queda una sola respuesta.

### RF-6 · Conteos y quién va · Must

- **Dado** un evento con respuestas, **cuando** se lista, **entonces** muestra cuántos van y cuántos quizás (FR-036).
- **Dado** quien puede ver un evento, **cuando** lo despliega, **entonces** ve los nombres de quienes van y de quienes quizás. Solo el nombre, ni correo ni otros datos. Las respuestas "No" no se listan.
- **Dado** un miembro que respondió y después salió de la audiencia, o fue dado de baja, **cuando** se cuenta, **entonces** su respuesta no cuenta ni aparece.

### RF-7 · La agenda · Must

- **Dado** un miembro, **cuando** abre el calendario, **entonces** ve sus eventos de hoy en adelante, ordenados por fecha ascendente, cada uno con fecha, título, tipo, hora, lugar y los conteos (FR-033, AC-046).
- **Dado** esa agenda, **cuando** elige ver los pasados, **entonces** ve los eventos ya ocurridos, del más reciente al más antiguo.
- **Dado** más de 50 eventos en la vista, **cuando** se abre, **entonces** ve los 50 primeros y un "Ver más" que trae los siguientes 50.
- **Dado** un evento cancelado, **cuando** aparece en la agenda, **entonces** lleva la marca "Cancelado" y no ofrece RSVP.
- **Dado** que no hay eventos en la vista, **cuando** se abre, **entonces** una frase lo dice, y a Admin y Committee los invita a crear el primero.

### RF-8 · La fila se despliega · Should

- **Dado** un evento en la agenda, **cuando** se pulsa su fila, **entonces** se despliega con sus notas y los nombres de RF-6.
- **Dado** un Admin o un Committee, **cuando** despliega una fila, **entonces** ve además la audiencia: "Todo el club" o los nombres de los grupos.
- **Dado** un Player o un Coach, **cuando** despliega una fila, **entonces** no ve la audiencia.

### RF-9 · El diálogo para crear eventos · Must

- **Dado** un Admin o un Committee, **cuando** abre el calendario, **entonces** ve el botón "+ Evento"; un Coach o un Player no lo ve.
- **Dado** el diálogo, **cuando** se abre, **entonces** tiene título, tipo, fecha, hora, lugar, notas, repetición (una vez o semanal) y audiencia, como el prototipo más el campo de audiencia.
- **Dado** "Semanal", **cuando** se elige, **entonces** la fecha se sustituye por los días de la semana, el inicio y el fin.
- **Dado** un envío válido, **cuando** se guarda, **entonces** el diálogo se cierra, el evento aparece en la agenda y un mensaje lo confirma.
- **Dado** un error de la API, **cuando** vuelve, **entonces** se muestra traducido junto al campo o arriba del diálogo, sin perder lo escrito.

### RF-10 · Avisar al crear · Must

- **Dado** un evento nuevo, **cuando** se crea, **entonces** cada miembro activo de su audiencia recibe un aviso con el título, el tipo, la fecha y la hora (FR-037, AC-013).
- **Dado** una serie nueva, **cuando** se crea, **entonces** cada miembro de su audiencia recibe **un** aviso de la serie, con los días y el rango, no uno por ocurrencia.
- **Dado** quien crea el evento, **cuando** está en la audiencia, **entonces** no recibe el aviso: ya lo sabe.
- **Dado** que guardar los avisos falla, **cuando** pasa, **entonces** el evento queda creado igual y el error queda registrado (E6, RF-2).
- **Dado** una audiencia de cien miembros, **cuando** se avisa, **entonces** los avisos se guardan en una sola escritura.

### RF-11 · Editar y cancelar un evento o una ocurrencia · Should

- **Dado** un Admin o un Committee, **cuando** edita un evento futuro, **entonces** cambian solo los campos que tocó, y las respuestas se conservan.
- **Dado** una ocurrencia de una serie, **cuando** se edita sola, **entonces** cambia solo esa y las demás siguen igual.
- **Dado** un evento futuro, **cuando** se cancela, **entonces** queda marcado como cancelado, sus respuestas se guardan pero dejan de contar, y nadie puede responder más.
- **Dado** un evento que ya empezó, o ya cancelado, **cuando** se intenta editar o cancelar, **entonces** se rechaza con 422.
- **Dado** un Coach o un Player, **cuando** lo intenta por API, **entonces** recibe 403.

### RF-12 · Editar y cancelar una serie · Should

- **Dado** una serie, **cuando** se edita, **entonces** el título, el tipo, la hora, el lugar, las notas y la audiencia cambian en todas sus ocurrencias futuras no canceladas, incluidas las que se habían editado solas. El diálogo lo advierte antes de guardar.
- **Dado** una serie, **cuando** se cancela, **entonces** se cancelan todas sus ocurrencias futuras, y las pasadas no se tocan.
- **Dado** una serie sin ocurrencias futuras, **cuando** se intenta editar o cancelar, **entonces** se rechaza con 422.
- **Dado** que la edición falla a medias, **cuando** pasa, **entonces** no cambia ninguna ocurrencia: todo o nada.

### RF-13 · Avisar de cambios y cancelaciones · Could

- **Dado** un evento o una serie a los que cambia la fecha, la hora o el lugar, **cuando** se guarda, **entonces** su audiencia recibe un aviso con lo nuevo. Un cambio de título, tipo o notas no avisa.
- **Dado** un evento o una serie que se cancelan, **cuando** pasa, **entonces** su audiencia recibe un aviso. Una serie cancelada da un solo aviso.
- **Dado** quien hizo el cambio, **cuando** está en la audiencia, **entonces** no recibe el aviso.

## 6. Casos borde y estados de error

- **Sin eventos:** la agenda lo dice con una frase, en la vista de próximos y en la de pasados.
- **Serie larga:** una serie de un año de lunes a domingo son 366 ocurrencias; es el máximo, y se crean en una sola escritura.
- **Cambio de horario:** las ocurrencias guardan la hora de Melbourne, no un desfase fijo.
- **Se borra un grupo de la audiencia:** el evento lo pierde. Si no le queda ningún grupo, solo lo ven Admin y Committee, que pueden cambiarle la audiencia o cancelarlo.
- **Un miembro sale de la audiencia después de responder:** deja de ver el evento; su respuesta se guarda pero no cuenta.
- **Un miembro pasa a `inactive`:** sus respuestas dejan de contar y no recibe avisos.
- **Dos organizadores editan el mismo evento a la vez:** gana el último que guarda.
- **Responder justo cuando empieza el evento:** decide la hora del servidor; si ya empezó, 422, y la pantalla lo dice.
- **Doble toque en el RSVP o doble envío del diálogo:** una sola respuesta y un solo evento.
- **Falla la red al responder:** la pantalla no da la respuesta por guardada y deja reintentar.
- **Falla la base al avisar:** el evento se crea, edita o cancela igual; los avisos se pierden y queda el error en el servidor.
- **Título o lugar largos en la pantalla a 375:** se parten sin romper la fila.

## 7. UX / UI

- Mockups: `docs/mockups/calendar-light.png`, `calendar-dark.png`, `mobile-calendar-light.png` y `mobile-calendar-dark.png` para la agenda. El diálogo de crear solo está en el prototipo (`docs/Seadragons Platform.dc.html`, el modal de evento); su revisión es heurística contra `design-system.md` siguiendo ese dibujo, más el campo de audiencia que el prototipo no trae.
- Pantallas:
  - **Calendario (todos):** la agenda del mockup, con el bloque de fecha, título, chip de tipo, hora y lugar, los botones Sí, Quizás y No en la fila, y los conteos. El control Mes/Semana/Agenda no se dibuja (ASS-010). Un control cambia entre próximos y pasados.
  - **Fila desplegada:** notas, quién va y quién quizás; la audiencia solo para Admin y Committee; editar y cancelar solo para ellos y solo en eventos futuros.
  - **Diálogo de evento (Admin, Committee):** crear y editar comparten el diálogo. Al editar una ocurrencia, se elige entre "solo esta" y "toda la serie de hoy en adelante".
  - **Cancelar:** una confirmación que dice cuántos habían dicho que van.
- Flujo principal: el Committee pulsa "+ Evento", elige semanal, marca martes y jueves, pone el rango y "Senior Squad", guarda; los miembros del grupo ven las sesiones y reciben un aviso; cada uno toca "Sí" en la fila.
- Viewports: 375 / 768 / 1440, en tema claro y oscuro, en inglés y en español.

## 8. Requerimientos no funcionales

- Seguridad: la capacidad `createEvents` se aplica en el servidor para el 100% de las peticiones (NFR-004). La frontera decide por camino y no por método (`src/lib/auth/routes.ts`), así que las escrituras del organizador viven en un camino propio declarado en `RESTRICTED_ROUTES`, separado del de lectura y RSVP, que alcanza cualquier cuenta activa.
- Visibilidad: la audiencia se aplica en la base (RLS, con `is_member_in_groups`) y en la API. La interfaz solo esconde.
- Privacidad: la lista de quién va trae solo nombres.
- Idiomas: todo texto nuevo sale del catálogo (`src/lib/i18n/messages/en.ts` y `es.ts`), incluidos los avisos. Las fechas y horas se formatean con `src/lib/i18n/format.ts`. Ningún texto nuevo escribe el nombre del club (ver #293).
- Rendimiento: la agenda pide los conteos de sus 50 eventos en una sola consulta, no una por fila.
- API: todo pasa por la API v1 (CON-002).
- Accesibilidad: sin violaciones de axe; los botones de RSVP anuncian cuál está elegido.

## 9. Preguntas abiertas

Ninguna. El dueño tomó estas decisiones el 23 de septiembre de 2026:

- Editar y cancelar entran en E7, para un evento, una ocurrencia y una serie. Cancelar marca, no borra, para que E8 conserve el historial.
- No hay pantalla de detalle: la fila de la agenda se despliega.
- Quien ve un evento ve también los nombres de quién va y quién quizás.
- La agenda muestra de hoy en adelante, con acceso a los pasados.

Queda anotada una decisión tomada en la sesión: quien crea, cambia o cancela un evento no recibe su propio aviso. AC-013 dice "each of those members"; se lee como "cada miembro al que hay que contárselo".

## 10. Descomposición en tickets (para write-ticket)

| #   | Título propuesto                                                                     | Tamaño | Depende de | Auto-merge sugerido                      |
| --- | ------------------------------------------------------------------------------------ | ------ | ---------- | ---------------------------------------- |
| 1   | Guarda los eventos, sus series y su audiencia en la base, visibles solo a quien toca | M      | ninguna    | No: tablas nuevas con RLS por audiencia  |
| 2   | Crea eventos puntuales y series semanales por API, con todas sus ocurrencias         | M      | 1          | No: lógica nueva con permisos            |
| 3   | Guarda el RSVP de un miembro y déjalo cambiar hasta que empiece el evento            | M      | 2          | No: lógica nueva con permisos            |
| 4   | Sirve la agenda y el detalle de un evento por API, con conteos y quién va            | M      | 3          | No: frontera de visibilidad (AC-052)     |
| 5   | Avisa a la audiencia cuando se crea un evento o una serie                            | M      | 2, #293    | No: fan-out nuevo de avisos              |
| 6   | Convierte Calendario en la agenda del mockup, con el RSVP en cada fila               | M      | 4, #293    | No: pantalla nueva                       |
| 7   | Despliega cada evento con sus notas y quién va, y deja ver los pasados               | M      | 6          | No: pantalla nueva                       |
| 8   | Da a Admin y Committee el diálogo para crear eventos puntuales y semanales           | M      | 6          | No: pantalla nueva con permisos          |
| 9   | Deja editar y cancelar un evento suelto o una ocurrencia, por API                    | M      | 4          | No: lógica nueva con permisos            |
| 10  | Deja editar y cancelar una serie de hoy en adelante, por API                         | M      | 9          | No: cambios masivos sobre datos con RSVP |
| 11  | Edita y cancela eventos y series desde el calendario                                 | M      | 7, 8, 10   | No: pantalla nueva con permisos          |
| 12  | Avisa a la audiencia cuando un evento cambia de hora o lugar, o se cancela           | S      | 5, 10      | No: amplía el catálogo de avisos         |

Traen migración el 1, el 2 (la función que crea todo o nada), el 3, el 5, el 9, el 10 y el 12. La cadena 1, 2, 3 ordena las primeras; si al rebasar otro ticket ya tomó el número, se renumera.

El único bloqueo externo es #293, que saca el nombre del club de los catálogos. Lo llevan el 5 y el 6, los primeros que escriben textos; los demás lo heredan por sus dependencias.
