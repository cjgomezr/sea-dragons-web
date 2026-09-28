# PRD: E8 · Asistencia

**Estado:** aprobado · **Fecha:** 28 de septiembre de 2026 · **Autor:** sesión de planificación (Claude Code)

Fuente: `docs/SRD_Victoria_Seadragons_Club_Platform.md` (v1.4), epic E8 de `docs/plan-maestro.md` y la matriz de permisos de su sección 4. Cubre FR-038 a FR-042 y los criterios AC-016, AC-017 y AC-017b, más la parte de asistencia de FR-015, FR-019 y FR-022 (la columna del directorio, su orden y el perfil). Aplica B4 (la fórmula del porcentaje) y B7 (la participación sale del RSVP y de los grupos, nunca del rol) de `docs/preguntas-abiertas.md`. Ese archivo no deja nada sin resolver para esta épica.

Las decisiones que el SRD no tomaba las tomó el dueño el 28 de septiembre de 2026 y van marcadas como D1 a D5.

## 1. Problema

El coach pasa lista en la piscina, si la pasa, en un cuaderno o en la memoria. Nadie sabe cuánto entrena cada quien: el porcentaje de asistencia que el SRD pone en el directorio, en el perfil y en el dashboard (FR-015, FR-022, FR-076) hoy no existe porque no hay de dónde sacarlo. Y el team builder (E10) y los packs de sesiones de los socios Casual (E13) dependen de saber quién estuvo en cada sesión.

E7 ya publica las sesiones y sabe quién dijo que iba. Falta lo que pasó de verdad.

## 2. Usuarios y contexto

- **Coach y Admin:** pasan lista al empezar el entrenamiento, desde el móvil al borde de la piscina o desde el portátil después. Quieren marcar quince personas en un minuto, ver los totales mientras marcan, y poder corregir un error días después (D5).
- **Cualquier miembro:** ve su porcentaje y cuántas sesiones lleva en su perfil, y el de los demás en el directorio.
- **Committee y Player:** no registran asistencia (matriz de permisos, `buildTeamsAndTrackAttendance`).
- **Hoy lo resuelven así:** no lo resuelven. El coach cuenta cabezas.

## 3. Objetivo y métricas de éxito

- Objetivo: que cada sesión de entrenamiento quede registrada con quién estuvo, y que el porcentaje de asistencia de cada miembro salga solo de eso, con la fórmula del SRD.
- Métricas:
  - Pasar lista a una sesión de quince personas lleva menos de un minuto: todos empiezan en "Presente" y solo se tocan las excepciones (AC-016).
  - Los contadores de la pantalla coinciden siempre con lo marcado, antes y después de guardar (FR-040).
  - El porcentaje de un miembro coincide con el cálculo a mano sobre sus sesiones elegibles (AC-017), y con cero sesiones dice "sin datos" (AC-017b).
  - Ningún Committee ni Player puede leer ni escribir una hoja de asistencia, ni por API (AC-007).

## 4. Alcance

**Incluido (v1):**

- Registrar la asistencia de una sesión de entrenamiento: una hoja por sesión con `Present`, `Late` o `Absent` por miembro, con los contadores en vivo, que se guarda entera y se confirma (FR-038 a FR-041).
- Corregir una hoja ya guardada, sin límite de tiempo, por Admin o Coach (D5).
- El porcentaje de asistencia y el total de sesiones de cada miembro, con la fórmula de FR-042, en el directorio (columna y orden, FR-015 y FR-019) y en el perfil propio (FR-022).
- La tasa de asistencia del club en los últimos 30 días, servida por API para el dashboard de E14 (FR-076).
- La pantalla de Asistencia del mockup, solo para Admin y Coach.

**Explícitamente fuera (por ahora):**

- Asistencia a competiciones, reuniones y sociales: solo los entrenamientos llevan hoja (D2, y el modelo del SRD: "has one AttendanceSheet (Training)").
- El dashboard y su tesela de asistencia: E14 pinta lo que esta épica sirve.
- Descontar sesiones de los packs Casual al guardar: E13 (FR-064). Esta épica deja el dato del que E13 tira: la hoja guardada con `Present` y `Late`.
- Usar la asistencia para armar equipos: E10.
- Que un miembro se marque a sí mismo, o que el RSVP cuente como asistencia: solo Admin y Coach registran.
- Avisos por asistencia (a quien faltó, al coach que no pasó lista): la política de avisos del plan maestro no los pide.
- Exportar la asistencia: el SRD v1.2 lo descarta ("no dashboard export").
- Borrar una hoja: se corrige.

## 5. Requerimientos funcionales

### RF-1 · La asistencia se guarda con reglas en la base · Must

Una fila por sesión y miembro, con su estado, quién la registró y cuándo. Solo cuelgan de eventos de tipo `training`.

- **Dado** un evento de entrenamiento y un miembro de su club, **cuando** se guarda su asistencia, **entonces** queda una sola fila con `present`, `late` o `absent`, quién la registró y la hora; guardarla otra vez reescribe esa misma fila.
- **Dado** un evento que no es de entrenamiento, **cuando** se intenta guardar asistencia, **entonces** la base la rechaza.
- **Dado** un estado fuera del catálogo, **cuando** se intenta guardar, **entonces** la base la rechaza.
- **Dado** un evento y un miembro de clubes distintos, **cuando** se intenta guardar, **entonces** la base la rechaza sin triggers, con claves compuestas por club como en `event_rsvps`.
- **Dado** una cuenta autenticada, **cuando** consulta la tabla directamente, **entonces** lee como mucho sus propias filas y no puede escribir ninguna: Admin y Coach registran a través del servidor.
- **Dado** que se borra la identidad de un miembro o un evento, **cuando** termina la cascada, **entonces** sus filas de asistencia desaparecen. Cancelar un evento no borra nada (E7 marca, no borra).

### RF-2 · Abrir la hoja de una sesión · Must

La lista de quién se espera en la sesión, con el estado de cada uno, para marcar.

- **Dado** un Admin o un Coach, **cuando** abre la hoja de un entrenamiento, **entonces** ve a cada miembro activo de la audiencia del evento, sea cual sea su rol (B7), con su estado: el guardado si la hoja ya se guardó, y `present` si es nueva (FR-039).
- **Dado** una hoja nueva, **cuando** se lista, **entonces** los que respondieron "Sí" al RSVP van primero, luego los "Quizás", luego los demás, y dentro de cada grupo por nombre; cada fila enseña la respuesta que dio, como pista (D1).
- **Dado** una hoja ya guardada, **cuando** se lista, **entonces** salen todos los que tienen fila guardada aunque hayan salido de la audiencia o estén de baja, con la marca de baja si aplica, más quien entró en la audiencia después, en `present` (D1).
- **Dado** un Coach que no está en la audiencia del entrenamiento, **cuando** abre la hoja, **entonces** la ve igual: para asistencia, Admin y Coach ven todos los entrenamientos del club.
- **Dado** un Committee o un Player, **cuando** pide la hoja, **entonces** recibe 403.
- **Dado** un evento que no es de entrenamiento, de otro club o que no existe, **cuando** se pide su hoja, **entonces** 404.
- **Dado** un entrenamiento que todavía no empezó, **cuando** se pide su hoja, **entonces** 422: la asistencia se registra desde la hora de inicio en adelante.
- **Dado** un entrenamiento cancelado, **cuando** se pide su hoja, **entonces** 422.

### RF-3 · Guardar la hoja · Must

- **Dado** una hoja con quince miembros, **cuando** el Coach marca a dos `late`, a uno `absent` y guarda, **entonces** las quince filas quedan guardadas con esos estados, quién guardó y la hora, y la respuesta confirma el guardado con los totales (AC-016, FR-041).
- **Dado** una hoja guardada, **cuando** el Admin o un Coach cambia un estado días después y guarda, **entonces** se reescribe sin límite de tiempo y queda en la bitácora quién la cambió (D5).
- **Dado** una lista con un miembro que no es de la audiencia ni tiene fila previa, o con un id que no es del club, **cuando** se guarda, **entonces** 422 y no se escribe nada.
- **Dado** una lista con un estado fuera del catálogo o con un miembro repetido, **cuando** se guarda, **entonces** 400 y no se escribe nada.
- **Dado** dos personas que guardan la misma hoja a la vez, **cuando** llegan las dos peticiones, **entonces** la hoja queda como la dejó la última: se guarda entera, todo o nada, nunca mezclada.
- **Dado** un doble toque en "Guardar", **cuando** llegan dos peticiones iguales, **entonces** quedan las mismas filas y una sola entrada en la bitácora por petición aplicada.
- **Dado** un entrenamiento cancelado o que no empezó, **cuando** se guarda, **entonces** 422 como al abrir.

### RF-4 · Las sesiones que se pueden pasar · Must

- **Dado** un Admin o un Coach, **cuando** pide las sesiones para pasar lista, **entonces** recibe los entrenamientos del club ya empezados y no cancelados de los últimos 30 días, del más reciente al más antiguo, cada uno con si ya tiene hoja guardada y sus totales.
- **Dado** un entrenamiento de hace más de 30 días, **cuando** se quiere corregir, **entonces** se llega por su id (desde el calendario de pasados de E7), no desde esa lista.

### RF-5 · El porcentaje y el total de cada miembro · Must

La fórmula de FR-042: `(present + late) / sesiones elegibles`, redondeada al entero más cercano.

- **Dado** un miembro que entró el 1 de mayo y fue audiencia de diez entrenamientos con hoja guardada desde ese día, nueve de ellos `present` o `late`, **cuando** se calcula, **entonces** su porcentaje es 90 (AC-017).
- **Dado** entrenamientos de abril, entrenamientos a los que no fue convocado y sesiones que no son de entrenamiento, **cuando** se calcula, **entonces** ninguno cambia el número (AC-017).
- **Dado** un entrenamiento que fue audiencia del miembro pero cuya hoja nadie guardó, **cuando** se calcula, **entonces** no cuenta: sin hoja no hay estado que sumar (D3).
- **Dado** un entrenamiento cancelado, **cuando** se calcula, **entonces** no cuenta.
- **Dado** un miembro con cero sesiones elegibles, **cuando** se pide su porcentaje, **entonces** la respuesta lo dice como "sin datos", nunca como 0 (AC-017b).
- **Dado** un miembro, **cuando** se pide su total, **entonces** recibe cuántas sesiones tiene en `present` o `late` (FR-022).
- **Dado** 500 miembros y 50.000 filas de asistencia (NFR-008), **cuando** se pide el directorio, **entonces** los porcentajes salen en una sola consulta agregada, no una por miembro.

### RF-6 · El porcentaje en el directorio y en el perfil · Must

- **Dado** el directorio, **cuando** se lista, **entonces** cada miembro trae su porcentaje o "sin datos", y se puede ordenar por asistencia en los dos sentidos (FR-015, FR-019, AC-010); "sin datos" va al final en cualquier sentido.
- **Dado** el perfil propio, **cuando** se abre, **entonces** enseña el porcentaje y el total de sesiones (FR-022).
- **Dado** la ficha reservada al Admin (#242), **cuando** se abre, **entonces** enseña lo mismo que el perfil.

### RF-7 · La tasa del club · Should

- **Dado** los entrenamientos con hoja guardada de los últimos 30 días, **cuando** se pide la tasa del club, **entonces** es `(present + late) / filas` redondeada al entero, o "sin datos" sin ninguna hoja. La sirve la API para el dashboard de E14 (FR-076).

### RF-8 · La pantalla de Asistencia · Must

Sigue `docs/mockups/attendance-light.png` y `attendance-dark.png`.

- **Dado** un Admin o un Coach, **cuando** entra en Asistencia, **entonces** ve la sesión más reciente abierta: título y fecha, las fichas para cambiar de sesión, los tres contadores y la lista con foto o iniciales, nombre, posición y los tres botones por fila.
- **Dado** la hoja, **cuando** toca un estado, **entonces** los contadores cambian al momento, sin guardar todavía (FR-040).
- **Dado** cambios sin guardar, **cuando** pulsa "Guardar asistencia", **entonces** se manda la hoja entera y la pantalla confirma con los totales guardados; hasta entonces el botón dice que hay cambios.
- **Dado** cambios sin guardar, **cuando** intenta cambiar de sesión, **entonces** la pantalla avisa antes de descartar.
- **Dado** un fallo de red o un 422 al guardar, **cuando** llega, **entonces** la pantalla lo dice, no da nada por guardado y conserva lo marcado.
- **Dado** un Committee o un Player, **cuando** escribe la dirección de Asistencia a mano, **entonces** la frontera lo devuelve al panel y la entrada no aparece en su menú.
- **Dado** el móvil a 375, **cuando** se mira, **entonces** cada fila cabe con sus tres botones de 44 px sin scroll horizontal.

## 6. Casos borde y estados de error

- **Sin entrenamientos empezados en 30 días:** la pantalla lo dice con una frase y ofrece ir al calendario.
- **Audiencia vacía:** un entrenamiento cuyo grupo se borró tiene hoja vacía; la pantalla lo dice y no hay nada que guardar.
- **Un miembro entra en la audiencia después de guardar la hoja:** aparece en `present` la próxima vez que se abre, sin fila hasta que se vuelve a guardar; su porcentaje no cuenta esa sesión mientras tanto.
- **Un miembro sale de la audiencia o pasa a `inactive` después de guardar:** su fila se queda y sigue contando en su historial (FR-085).
- **Cancelan un entrenamiento después de pasar lista:** las filas se quedan pero la sesión deja de contar para el porcentaje y no se puede volver a guardar.
- **Editan la hora del entrenamiento a una futura después de pasar lista:** la hoja queda como está y no se puede volver a guardar hasta que empiece.
- **Coach que juega:** aparece en la lista como cualquier miembro de la audiencia y se marca a sí mismo (B7).
- **Miembro con fecha de alta posterior a una sesión guardada en la que estuvo:** la sesión no cuenta para él (FR-042 manda), pero su fila se conserva.
- **Redondeo:** 50 sesiones con 24,5 % redondean a 25 con la regla "la mitad sube", fijada por tests, como el OVR de E9.
- **Doble toque y dos coaches a la vez:** RF-3.
- **Falla la bitácora:** la hoja se guarda igual; el fallo queda en el log del servidor, como en el resto de escrituras.

## 7. UX / UI

- Mockups: `docs/mockups/attendance-light.png` y `attendance-dark.png`. No hay mockup móvil: revisión heurística contra `design-system.md` siguiendo el de escritorio, con los tres botones a lo ancho de la fila como el RSVP del calendario. La columna del directorio y el bloque del perfil siguen sus mockups existentes (`directory-*.png`, `mobile-profile-*.png`).
- Pantallas:
  - **Asistencia (Admin, Coach):** ruta `/asistencia`, con entrada "Asistencia" en el menú solo para ellos, entre Calendario y Equipos como en el mockup. Cabecera con título y fecha de la sesión y el botón de guardar; fichas de las sesiones recientes; tres contadores con su punto de color; lista con avatar, nombre, chip de posición, la pista del RSVP y el segmento `Presente · Tarde · Ausente`.
  - **Directorio:** la columna de asistencia y "Asistencia" en el control de orden.
  - **Perfil y ficha:** "Asistencia" con el porcentaje grande y "N sesiones" debajo, o "Sin datos".
- Flujo principal: el Coach abre Asistencia al empezar la sesión, ve a todos en Presente con los que dijeron "Sí" arriba, toca "Tarde" en dos y "Ausente" en uno, ve 11 · 2 · 1, guarda y lee la confirmación.
- Viewports: 375 / 768 / 1440, en tema claro y oscuro, en inglés y en español.

## 8. Requerimientos no funcionales

- Seguridad: la capacidad `buildTeamsAndTrackAttendance` se aplica en el servidor para el 100% de las peticiones (NFR-004). Los caminos de asistencia van en `RESTRICTED_ROUTES`; el dominio vuelve a comprobar el rol. La tabla no da privilegios de escritura a ningún miembro: se escribe con la llave de servicio.
- Bitácora: cada guardado deja una entrada con quién, qué sesión y cuándo, sin los estados (NFR-010).
- Idiomas: todo texto nuevo sale de los catálogos; ningún texto escribe el nombre del club.
- Rendimiento: los porcentajes del directorio y la tasa del club salen de una consulta agregada; guardar una hoja es una escritura todo o nada.
- API: todo pasa por la API v1 (CON-002).
- Accesibilidad: sin violaciones de axe; el segmento anuncia el estado elegido y los contadores se anuncian al cambiar.

## 9. Preguntas abiertas

Ninguna que bloquee. Las decisiones del dueño:

- **D1 · Quién aparece en la hoja:** toda la audiencia del entrenamiento, con los que dijeron "Sí" primero y la respuesta de cada uno como pista. Quien tiene fila guardada aparece siempre.
- **D2 · Qué sesiones cuentan:** solo eventos de tipo `training`, como pide FR-042.
- **D3 · Sin hoja guardada no hay sesión elegible:** una sesión que nadie pasó no cuenta para nadie. Es la única lectura de FR-042 que no inventa estados.
- **D4 · Desde cuándo se pasa lista:** desde la hora de inicio de la sesión; antes, 422.
- **D5 · Correcciones:** Admin y Coach editan sin límite de tiempo, y queda en la bitácora.

## 10. Descomposición en tickets (para write-ticket)

| #   | Título propuesto                                                                        | Tamaño | Depende de | Auto-merge sugerido                           |
| --- | --------------------------------------------------------------------------------------- | ------ | ---------- | --------------------------------------------- |
| 1   | Guarda la asistencia de cada sesión de entrenamiento, con RLS                           | M      | ninguna    | No: tabla nueva con RLS                       |
| 2   | Abre y guarda la hoja de asistencia de una sesión por API, con las sesiones recientes   | M      | 1          | No: lógica nueva con permisos y bitácora      |
| 3   | Calcula el porcentaje y el total de cada miembro y la tasa del club, y sírvelos por API | M      | 1          | No: fórmula de negocio en directorio y perfil |
| 4   | Da a Admin y Coach la pantalla de Asistencia del mockup                                 | M      | 2          | No: pantalla nueva con permisos               |
| 5   | Pinta el porcentaje en el directorio, con su orden, y en el perfil y la ficha           | S      | 3          | No: pantallas existentes con dato nuevo       |

Traen migración el 1 y el 3 (la función agregada). Tras el 1, el 2 y el 3 van en paralelo; tras ellos, el 4 y el 5. Con dos personas la épica se cierra en dos vueltas.

E10 (team builder) y E14 (dashboard) esperan al 1 y al 3; E13 (packs Casual) al 2.
