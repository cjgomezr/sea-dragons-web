# PRD: E14 · Dashboard y búsqueda global

**Estado:** aprobado · **Fecha:** 29 de septiembre de 2026 · **Autor:** sesión de planificación (Claude Code)

Fuente: `docs/SRD_Victoria_Seadragons_Club_Platform.md` (v1.4), epic E14 de `docs/plan-maestro.md` y la matriz de permisos de su sección 4. Cubre FR-076, FR-077 y FR-078 y los criterios AC-031 y AC-032. FR-079 (el tema claro y oscuro) ya se entregó con E17 y no vuelve aquí. `docs/preguntas-abiertas.md` no deja nada sin resolver para esta épica.

Las decisiones que el SRD no tomaba las tomó el dueño el 29 de septiembre de 2026 y van marcadas como D1 a D5.

## 1. Problema

La aplicación ya sabe quién entrena, cuándo es la próxima sesión y qué se publicó, pero para enterarse hay que recorrer cuatro secciones. La pantalla de inicio sigue siendo el marcador del bootstrap ("Estado del servicio"), y no hay forma de buscar un socio, un evento o una noticia sin ir primero a su sección. El SRD pide un dashboard que resuma el club en una mirada y una búsqueda global desde la navegación (FR-076 a FR-078), y el plan maestro cierra Release 1 con esta épica porque junta datos de casi todas las anteriores.

## 2. Usuarios y contexto

- **Cualquier miembro, sobre todo desde el móvil:** abre la aplicación para saber cuándo es el próximo entrenamiento y si hay algo nuevo. Quiere responder al RSVP desde ahí mismo y llegar a la noticia con un toque.
- **Admin y Coach, desde el portátil:** miran cómo va el club (tasa de asistencia, socios activos) y saltan a crear el siguiente entrenamiento.
- **Cualquiera con una búsqueda en la cabeza:** "Geelong", "Mateo", "piscina". Quiere resultados agrupados sin saber de antemano en qué sección están.
- **Hoy lo resuelven así:** entran en Calendario, luego en Noticias, luego en Directorio, y para la tasa del club miran el directorio fila por fila.

## 3. Objetivo y métricas de éxito

- Objetivo: que la pantalla de inicio conteste en una mirada "qué viene, qué hay nuevo, cómo va el club", y que cualquier cosa del club se encuentre desde un solo cuadro de búsqueda.
- Métricas:
  - El dashboard pinta las cuatro teselas, los tres próximos eventos y las tres últimas noticias en menos de un segundo (percentil 95), con una sola petición a la API (AC-031).
  - Buscar "Geelong" devuelve el scrimmage y las noticias que lo nombran, agrupados por tipo, en menos de un segundo (AC-032).
  - Nadie encuentra por la búsqueda nada que no vería en su sección: los mismos permisos, sin excepción (D3).
  - Responder al RSVP del próximo entrenamiento desde el inicio deja el calendario igual que si se hubiera hecho allí.

## 4. Alcance

**Incluido (v1):**

- El dashboard como pantalla de inicio (`/`), para todos los roles, con saludo, cuatro teselas, los tres próximos eventos y las tres últimas noticias (FR-076, FR-077).
- La tesela del próximo entrenamiento con el RSVP integrado, como en el mockup del móvil.
- La cuenta de noticias sin leer, con su definición (D2) y su marca de visita a Noticias.
- La búsqueda global de socios, eventos y noticias desde la barra superior en escritorio y desde una lupa en el móvil, con resultados agrupados por tipo (FR-078, D4).
- Una API `GET /api/v1/dashboard` y otra `GET /api/v1/search` (CON-002).

**Explícitamente fuera (por ahora):**

- La tesela "Overall" del mockup del móvil: enseñaría al jugador su OVR, y E10 decidió que el jugador nunca lo ve (D3 del PRD de E10). Se sustituye (D1).
- El botón "Export" del mockup de escritorio: ningún FR lo pide.
- Marcar noticias como leídas una a una, o un contador por noticia: solo la cuenta desde la última visita (D2).
- Búsqueda por texto completo con ranking, sinónimos o acentos ignorados más allá de lo que da `unaccent` (D5).
- Buscar dentro de adjuntos, evaluaciones, hojas de asistencia o repartos de equipos.
- Notificaciones desde el dashboard: la campana ya existe (E6).

## 5. Requerimientos funcionales

### RF-1 · Las teselas · Must

Cuatro teselas en el orden del mockup. Tres son iguales para todos; la primera depende del rol (D1).

- **Dado** un Admin o un Coach, **cuando** abre el inicio, **entonces** la primera tesela es la tasa de asistencia del club de los últimos 30 días, con "últimos 30 días" debajo, tal como la sirve `club_attendance_rate` (#394); sin ninguna hoja en ese periodo dice "Sin datos".
- **Dado** un Committee o un Player, **cuando** abre el inicio, **entonces** la primera tesela es su propia asistencia (porcentaje y sesiones, la de `GET /api/v1/account/attendance`), y "Sin datos" si no tiene sesiones elegibles.
- **Dado** cualquier rol, **cuando** abre el inicio, **entonces** la segunda tesela es el número de socios con cuenta `active` del club y debajo cuántos de ellos se unieron en los últimos 30 días según su fecha de alta (`joined_on`), como "+3 este mes", o nada si ninguno.
- **Dado** cualquier rol, **cuando** abre el inicio, **entonces** la tercera tesela es el tiempo hasta el próximo entrenamiento de su audiencia ("2 d", "5 h", "hoy 19:00"), con el día y el lugar debajo; sin entrenamiento a la vista dice "Sin entrenamiento programado".
- **Dado** cualquier rol, **cuando** abre el inicio, **entonces** la cuarta tesela es la cuenta de noticias sin leer (D2) y debajo cuántas de ellas son anuncios, o nada si ninguna es anuncio; con cero dice "Al día".
- **Dado** una tesela con un enlace natural (asistencia, directorio, calendario, noticias), **cuando** se pulsa, **entonces** lleva a esa sección; la tasa del club lleva a Asistencia solo para Admin y Coach.

### RF-2 · Próximos eventos y últimas noticias · Must

- **Dado** cualquier rol, **cuando** abre el inicio, **entonces** ve los tres próximos eventos de su audiencia (cualquier tipo, no cancelados, desde ahora), cada uno con el bloque de fecha, el título, la hora, el lugar y el chip de tipo del calendario, y cada uno enlaza a su fila desplegada en el calendario (FR-077).
- **Dado** cualquier rol, **cuando** abre el inicio, **entonces** ve las tres últimas noticias publicadas que puede leer (las reglas del feed de E11), con el chip de categoría, el título y "hace N", y cada una enlaza a la publicación (FR-077).
- **Dado** menos de tres eventos o noticias, **cuando** se pinta, **entonces** salen los que haya; con ninguno, una frase y el enlace a la sección.
- **Dado** los enlaces "Calendario" y "Todas", **cuando** se pulsan, **entonces** llevan a la sección completa.

### RF-3 · El próximo entrenamiento con RSVP · Must

- **Dado** el móvil, **cuando** el inicio enseña el próximo entrenamiento, **entonces** la tarjeta lleva los botones Sí, Quizás y No del calendario (`EventRsvp`), con la respuesta actual marcada, y responder ahí guarda igual que en el calendario y actualiza los conteos.
- **Dado** el escritorio, **cuando** se pinta la lista de próximos eventos, **entonces** cada fila lleva su chip y su enlace; el RSVP se responde en el calendario, como en el mockup.
- **Dado** un entrenamiento que ya empezó, **cuando** se calcula el próximo, **entonces** no cuenta: "próximo" es el primero cuya hora de inicio está por delante de ahora, en la hora del club (NFR-003).

### RF-4 · El saludo y los accesos del rol · Should

- **Dado** cualquier rol, **cuando** abre el inicio, **entonces** el saludo lleva su nombre de pila y cambia con la hora del club: "Buenos días", "Buenas tardes", "Buenas noches", en su idioma.
- **Dado** un Admin o un Coach en escritorio, **cuando** abre el inicio, **entonces** ve el botón "Nuevo entrenamiento", que lleva al calendario con el formulario de crear abierto y el tipo entrenamiento preseleccionado (E7, #313).
- **Dado** un Committee o un Player, **cuando** abre el inicio, **entonces** no ve ese botón.

### RF-5 · Las noticias sin leer · Must

- **Dado** un miembro que nunca abrió Noticias, **cuando** se cuenta, **entonces** son las noticias que puede leer publicadas en los últimos 30 días (D2).
- **Dado** un miembro que abrió Noticias, **cuando** se cuenta, **entonces** son las publicadas después de su última visita; abrir la sección de Noticias registra la visita, y abrir una publicación desde el inicio también.
- **Dado** una noticia retirada o despublicada, **cuando** se cuenta, **entonces** no cuenta.

### RF-6 · La API del dashboard · Must

- **Dado** una cuenta activa, **cuando** pide `GET /api/v1/dashboard`, **entonces** recibe en una sola respuesta las cuatro teselas (con la variante de la primera según su rol), los tres eventos y las tres noticias, calculados en el servidor con las mismas funciones de dominio que sus secciones: `readClubAttendanceRate`, `readOwnAttendance`, `listAgenda` y `listNewsFeed`. Nada se recalcula aquí.
- **Dado** que una de las fuentes falla (la base no contesta para la tasa, por ejemplo), **cuando** se responde, **entonces** esa tesela llega marcada como no disponible y el resto del dashboard se sirve; el fallo queda en el log.
- **Dado** una cuenta sin sesión, **cuando** pide el dashboard o la búsqueda, **entonces** 401, como el resto de la API.

### RF-7 · La búsqueda global · Must

- **Dado** un texto de dos o más caracteres, **cuando** se pide `GET /api/v1/search?q=`, **entonces** la respuesta trae hasta cinco socios, cinco eventos y cinco noticias, agrupados por tipo y en ese orden, y por grupo cuántos hay en total (D4).
- **Dado** los socios, **cuando** se buscan, **entonces** coinciden por nombre y son los que el directorio le enseñaría a quien busca (`canSeeInDirectory`, inactivos solo para el Admin), con la posición y la foto como en el directorio.
- **Dado** los eventos, **cuando** se buscan, **entonces** coinciden por título o lugar, entre los de su audiencia (o todos para quien ve el calendario entero), próximos y pasados, con la fecha, la hora y el chip de tipo; cancelados con su marca.
- **Dado** las noticias, **cuando** se buscan, **entonces** coinciden por título o cuerpo, entre las que puede leer, con la categoría y la fecha.
- **Dado** la coincidencia, **cuando** se compara, **entonces** ignora mayúsculas y acentos ("geelong" encuentra "Geelong", "munoz" encuentra "Muñoz") y busca por subcadena (D5).
- **Dado** un texto de un carácter o vacío, **cuando** se pide, **entonces** 400 y la pantalla no llama.
- **Dado** un resultado, **cuando** se pulsa, **entonces** lleva al socio (perfil o ficha según el rol), a la fila del evento en el calendario o a la publicación.

### RF-8 · La búsqueda en la pantalla · Must

- **Dado** el escritorio, **cuando** se mira cualquier pantalla, **entonces** el cuadro "Buscar socios, eventos, noticias" está en la barra superior del contenido, como en el mockup, y el foco llega con la tecla `/` desde fuera de un campo de texto.
- **Dado** el móvil, **cuando** se mira la cabecera, **entonces** hay una lupa junto a la campana que abre la búsqueda a pantalla completa con el teclado listo; volver atrás la cierra (D4).
- **Dado** que se escribe, **cuando** pasan 300 ms sin teclear y hay dos o más caracteres, **entonces** se pide una vez; teclear más cancela la petición anterior.
- **Dado** resultados, **cuando** se enseñan, **entonces** van bajo tres cabeceras (Socios, Eventos, Noticias) con la cuenta total de cada grupo, "Ver todos" cuando hay más de cinco, y los grupos vacíos no se pintan; sin ninguno, "Nada coincide con X".
- **Dado** el teclado, **cuando** se navega, **entonces** el cuadro es un combobox accesible: flechas para moverse, Enter abre, Escape cierra y vacía; el lector de pantalla anuncia cuántos resultados hay.
- **Dado** "Ver todos" de socios, **cuando** se pulsa, **entonces** abre el directorio con el texto ya puesto en su búsqueda; el de eventos abre el calendario y el de noticias abre Noticias.

## 6. Casos borde y estados de error

- **Club recién creado:** cero eventos, cero noticias, un socio: las teselas dicen "Sin entrenamiento programado", "Al día", "1" y "Sin datos"; las listas enseñan su frase y su enlace.
- **Miembro sin audiencia:** ni eventos ni entrenamiento a la vista; el resto igual.
- **Tasa del club sin hojas en 30 días:** "Sin datos", no 0 %.
- **Muchos resultados:** cinco por grupo y la cuenta total; el resto por "Ver todos".
- **Texto con comodines o comillas:** se busca tal cual como subcadena; nunca se interpreta.
- **Texto larguísimo:** se recorta a 100 caracteres antes de buscar.
- **Red caída en la búsqueda:** la lista dice que no se pudo buscar y ofrece reintentar; el cuadro conserva el texto.
- **Una fuente del dashboard caída:** su tesela o su lista dice "No disponible" y el resto se pinta (RF-6).
- **Dos respuestas de RSVP seguidas en la tarjeta:** el mismo doble toque de E7: una sola petición y el estado que devuelve el servidor.
- **Cambio de idioma:** saludo, teselas, cabeceras y "hace N" cambian; el texto buscado se conserva.

## 7. UX / UI

- Mockups: `docs/mockups/dashboard-light.png` y `dashboard-dark.png` (escritorio: barra de búsqueda, saludo, cuatro teselas, Upcoming y Latest news); `docs/mockups/mobile-home-light.png` y `mobile-home-dark.png` (móvil: saludo, dos teselas, la tarjeta del próximo entrenamiento con RSVP, últimas noticias). En el móvil las cuatro teselas van en dos filas de dos, y la segunda del mockup ("Overall") se sustituye por socios activos y noticias sin leer (D1). La lupa del móvil, la búsqueda a pantalla completa y los resultados agrupados no están dibujados: revisión heurística contra `design-system.md`, siguiendo la forma del panel de notificaciones.
- Flujo principal: abrir la aplicación, ver el inicio, responder al próximo entrenamiento, tocar una noticia. Búsqueda: escribir, ver los grupos, pulsar un resultado.
- Viewports a soportar: 375 / 768 / 1440.

## 8. Requerimientos no funcionales

- Rendimiento: el dashboard en una petición y por debajo de un segundo (p95); la búsqueda por debajo de un segundo con 500 socios, 5.000 eventos y 1.000 noticias (NFR-008), con índices `trigram` o `unaccent` si hacen falta.
- Accesibilidad: `design-system.md`, axe sin violaciones, el combobox de la búsqueda según el patrón ARIA, y las teselas leídas como "Tasa de asistencia: 86 %".
- Seguridad: las dos APIs exigen sesión; la búsqueda aplica en el servidor exactamente las reglas de visibilidad de cada dominio, nunca filtra en el cliente (D3).
- Bilingüe (E17): todo texto nuevo en los dos catálogos.

## 9. Preguntas abiertas

Ninguna que bloquee. Decisiones tomadas:

- **D1 · La primera tesela según el rol:** Admin y Coach ven la tasa del club; Committee y Player ven su propia asistencia. La tesela "Overall" del mockup del móvil no se construye porque el jugador nunca ve su OVR (D3 de E10); su sitio lo ocupan socios activos y noticias sin leer.
- **D2 · "Sin leer" es desde la última visita a Noticias:** se guarda una marca de visita por miembro (`news_seen_at`); sin marca, cuentan las de los últimos 30 días. Sin lectura por publicación.
- **D3 · La búsqueda ve lo mismo que las secciones:** ninguna excepción, ni para el Admin.
- **D4 · Dónde vive la búsqueda:** en escritorio, la barra superior del contenido, como el mockup; en el móvil, una lupa junto a la campana que abre una búsqueda a pantalla completa. No es una pestaña.
- **D5 · Coincidencia por subcadena sin acentos ni mayúsculas:** suficiente para un club; el texto completo con ranking queda para cuando haga falta.

## 10. Descomposición en tickets (para write-ticket)

| #   | Issue | Título propuesto                                                                                     | Tamaño | Depende de | Auto-merge sugerido                          |
| --- | ----- | ---------------------------------------------------------------------------------------------------- | ------ | ---------- | -------------------------------------------- |
| 1   | #424  | Sirve el dashboard por API: teselas por rol, próximos eventos, últimas noticias y la marca de visita | M      | ninguna    | No: reglas de negocio nuevas y una migración |
| 2   | #426  | Pinta el dashboard del mockup como pantalla de inicio, con el RSVP del próximo entrenamiento         | M      | #424       | No: pantalla nueva, `ui-review`              |
| 3   | #425  | Sirve la búsqueda global por API, con los permisos de cada dominio y sin acentos                     | M      | ninguna    | No: permisos                                 |
| 4   | #427  | Pone la búsqueda en la barra superior y en la lupa del móvil, con resultados agrupados               | M      | #425       | No: pantalla nueva, `ui-review`              |

Los tickets 1 y 3 van en paralelo; el 2 y el 4 detrás de cada uno.
