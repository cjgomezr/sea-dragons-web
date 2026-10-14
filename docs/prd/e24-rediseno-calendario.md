# PRD: E24 · El rediseño del calendario

**Estado:** borrador · **Fecha:** 14 de octubre de 2026 · **Autor:** sesión de planificación (Claude Code)

Fuente: el diseño que el dueño hizo con Claude Design, guardado en `docs/design/design_handoff_calendar/` (el prototipo `Calendar Upgrade.dc.html`, su `README.md` de handoff, `support.js`, `image-slot.js` y ocho capturas en `screenshots/`). Se construyen **1a** (agenda y panel) y **1c** (crear y editar) en escritorio, y **2a**, **2b** y **2c** en móvil, por debajo de 768 px. La **1b** (rejilla del mes) es una exploración y no se construye. Es una épica añadida después del plan. Cambia cómo se presenta E7 y le añade lo que E7 dejó fuera a propósito: la hora de fin (su sección de fuera de alcance), la imagen, el lugar con mapa y el archivo para el calendario personal.

El `README.md` del handoff es parte de este PRD: tiene las medidas, los colores, los textos y cada estado. Lo que dice aquí manda sobre él cuando no coinciden. Las capturas tienen errores que no se copian: la 03 marca los siete días con el título "Monday & Thursday", y rotula "Starts" tanto la fecha como la hora.

Las decisiones van marcadas como D1 a D14. D1, D2 y D3 las tomó el dueño el 14 de octubre de 2026.

- **D1.** **El lugar se busca con Photon y los lugares del club van primero.** Al escribir, la app sugiere antes los lugares que el club ya usó (por número de eventos) y después los resultados de Photon (OpenStreetMap, gratis). Photon se llama desde nuestro servidor, nunca desde el navegador: con caché, a partir de 3 caracteres, con espera de 300 ms entre teclas, sesgado a Melbourne y limitado a Australia. Nominatim queda descartado porque sus reglas de uso prohíben el autocompletado. Si Photon falla o tarda, el campo sigue aceptando texto libre y los lugares del club.
- **D2.** **"Esta y las siguientes" se hace de verdad.** Editar desde una sesión parte la serie en esa fecha: la serie original termina el día anterior y nace una nueva desde la sesión elegida, con los cambios. Las sesiones anteriores a la elegida no cambian, aunque sean futuras. Desde ese punto también se pueden cambiar los días y la fecha final. Hoy (RF-12 de E7) editar una serie cambia todas las futuras desde hoy y los días no se editan; las dos cosas cambian.
- **D3.** **El mapa embebido entra solo si se ve bien y no frena.** Es el último ticket de la épica y su criterio es explícito: un mapa de OpenStreetMap en un `iframe` que carga solo cuando el panel está a la vista (`loading="lazy"`), sin mover nada al aparecer, y que no retrasa el resto del panel. Todo el mapa es a la vez un enlace que abre Google Maps. Si en la revisión el mapa no cumple (lento, feo en el tema claro o con contenido mixto), el ticket se cierra entregando solo el enlace "Cómo llegar", que existe desde antes (RF-7).
- **D4.** **Los colores por tipo salen de tokens.** Training usa `--color-accent`, Competition `--color-warning`, Social `--color-success` y Meeting un token nuevo, `--color-type-meeting` (`#b7c7d6` en oscuro, con su versión clara). El fondo de la vista previa del mapa reutiliza `--color-editor-bar`. `--color-hover` y `--color-segment-selected` ya existen desde E21 y E22.
- **D5.** **La hora de fin es obligatoria en lo nuevo y opcional al leer.** Los eventos y series anteriores a E24 no la tienen y muestran solo el inicio, como hoy. Al editar uno de ellos, el formulario pide la hora de fin y lo explica.
- **D6.** **Varios días es solo para eventos sueltos.** Un evento de varios días aparece una vez en la agenda, en su día de inicio, con un único RSVP y una única asistencia, como cualquier otro. Las series siguen siendo de un día por sesión.
- **D7.** **La imagen se reduce en el servidor, como la portada de noticias** (E22 D6): dos versiones WebP (miniatura para las filas y grande para el panel y la pantalla del evento), en un bucket privado propio de eventos, servidas con URL firmada solo a quien está en la audiencia. Reutiliza la reducción de `src/lib/news/shrink-news-cover.ts`. La imagen de una serie la heredan sus sesiones; "solo esta sesión" puede ponerle otra.
- **D8.** **El filtro por tipo va a la API.** La agenda se pagina con cursor, así que filtrar en el navegador deja páginas vacías. `GET /api/v1/events` acepta `types` y la pantalla lo guarda en la URL (`?types=`).
- **D9.** **"Agregar a mi calendario" baja un `.ics` de una sola sesión**, generado en el navegador. Una serie completa como regla de repetición no se enteraría de las sesiones canceladas después. Sin hora de fin, el archivo lleva solo el inicio.
- **D10.** **Los cambios de hora de fin, lugar o imagen avisan como cualquier otro cambio.** Los avisos de creación y de cambio (`event-creation-notice`, `event-change-notice`) incluyen la hora de fin y la dirección cuando las hay. Cambiar solo la imagen no avisa.
- **D11.** **Las horas siguen el formato del idioma**, con am/pm en inglés ("7:00 pm"). La lista del mockup ("7:00 / 10:00") es ambigua para un evento de noche.
- **D12.** Están diseñados el **escritorio y el móvil, en tema oscuro**. El corte es 768 px. El tema claro aplica el mismo diseño con los tokens claros, y la tableta usa el de escritorio. Los estados sin dibujo (evento cancelado, pestaña Pasados, vacíos, panel sin evento elegido) los revisa el `ui-reviewer` contra `design-system.md`, como en E21, E22 y E23.
- **D13.** **Ningún objetivo táctil baja de 44 px** y los campos del móvil usan texto de 16 px, como pide el handoff.
- **D14.** **El RSVP cambia de texto, no de valor:** "Going / Maybe / Can't go" y "Voy / Quizás / No puedo". En la base y en la API siguen `yes`, `maybe` y `no`.

## 1. Problema

La agenda es una lista de filas iguales donde un entrenamiento, un torneo y una cena se distinguen solo por una palabra. Un evento no dice cuándo termina, así que nadie sabe si la cena es de dos horas o de cinco. El lugar es texto libre: quien no conoce la piscina tiene que copiarlo y buscarlo a mano, y la dirección muchas veces no está. Crear una serie semanal no enseña qué fechas va a generar hasta después de guardarla, y para cambiar una serie a partir de una fecha hay que cancelarla y crear otra.

## 2. Usuarios y contexto

- **Cualquier miembro, sobre todo desde el móvil:** mira qué hay esta semana, responde si va y busca cómo llegar.
- **Admin y Committee (y Coach para la asistencia), desde el portátil o el móvil:** crean entrenamientos semanales, torneos y eventos sociales, y los ajustan cuando cambia la piscina o el horario.
- **Hoy lo resuelven así:** la hora de fin y la dirección van escritas en las notas, el mapa se busca a mano, y un cambio de horario a mitad de temporada obliga a cancelar la serie y crear otra.

## 3. Objetivo y métricas de éxito

- **Objetivo:** que cada evento diga de un vistazo qué es, cuándo empieza y termina y cómo llegar, y que crear y ajustar series sea seguro.
- **Métricas:**
  - Desde cualquier evento con lugar elegido, un miembro abre la ruta en Google Maps en un toque.
  - Al crear una serie semanal, el organizador ve el número de sesiones y las próximas fechas antes de guardar.
  - Cambiar el horario de una serie desde una fecha no toca ninguna sesión anterior a esa fecha: un test de integración lo comprueba.
  - Nada de lo que hoy hace E7 desaparece: los tests de comportamiento existentes siguen pasando, adaptados a la estructura nueva sin quitarles casos (salvo los de la edición de serie "desde hoy", que D2 sustituye).

## 4. Alcance

**Incluido (v1):**

- Colores, etiquetas y fondo por tipo (D4).
- Hora de fin y eventos de varios días (D5, D6).
- Imagen opcional del evento y de la serie (D7).
- Lugar estructurado (nombre, dirección, coordenadas y "dónde exactamente"), enlace a Google Maps y copiar la dirección.
- Buscador de lugares con los del club primero (D1).
- Filtro por tipo en la API y en la pantalla (D8).
- La agenda 1a con el panel del evento, en lugar del acordeón.
- Agregar a mi calendario (D9).
- El formulario 1c con imagen, tipo, cuándo, duraciones rápidas, repetición con resumen y próximas fechas, y el lugar.
- Partir una serie desde una sesión (D2), con el selector de alcance en el panel y en la hoja ⋯.
- El móvil 2a, 2b y 2c.
- El mapa embebido, con la condición de D3.
- Tema claro y tableta (D12), inglés y español.

**Explícitamente fuera (por ahora):**

- La rejilla del mes (1b).
- Repeticiones que no sean semanales (quincenal, mensual).
- Series de varios días por sesión.
- Exportar una serie entera como regla de repetición, o una suscripción al calendario (URL de iCal).
- Fotos de perfil en los avatares de "Voy": van iniciales, como el resto de la app.
- Un catálogo de lugares que se administre a mano.
- La portada del evento en el panel de inicio y en la búsqueda global (E14): siguen como están.
- Mapas de pago o con API key.

## 5. Requerimientos funcionales

Para medidas, colores y textos de cada pieza, ver el `README.md` del handoff. Cada RF se cumple en inglés y en español, en claro y oscuro, a 375, 768 y 1440.

### RF-1 · Colores y fondo por tipo · Must

Un evento se reconoce por su tipo antes de leerlo.

- **Dado** la etiqueta de tipo, **cuando** se muestra, **entonces** usa el color de su tipo al 24 % sobre el panel con el texto en `--color-text`, con contraste AA en los dos temas, y sustituye a los estilos `.agenda-type-*`.
- **Dado** un evento sin imagen, **cuando** se muestra donde va una, **entonces** se ve el degradado de su tipo con su icono de Phosphor (`timer`, `trophy`, `confetti`, `users-three`) en su color, y el icono es decorativo.
- **Dado** los colores del diseño que no eran tokens, **cuando** se usan, **entonces** salen de tokens definidos en claro, en oscuro y en la preferencia del sistema (D4).

### RF-2 · Hora de fin y varios días · Must

Cada evento nuevo dice cuándo termina (D5, D6).

- **Dado** un evento suelto o una serie nueva, **cuando** se crea sin hora de fin, **entonces** la API lo rechaza con un error de validación.
- **Dado** una hora de fin igual o anterior al inicio en un evento de un día, **cuando** se guarda, **entonces** se rechaza con `end_before_start`.
- **Dado** un evento suelto con fecha de fin, **cuando** se guarda, **entonces** se acepta si la fecha de fin es posterior a la de inicio, o igual con la hora de fin posterior; si no, se rechaza.
- **Dado** una serie, **cuando** se intenta guardar con fecha de fin de evento, **entonces** se rechaza: varios días es solo para eventos sueltos.
- **Dado** un evento anterior a E24, **cuando** se lee, **entonces** `endTime` y `endsOn` son nulos y la pantalla enseña solo el inicio.
- **Dado** la agenda y el detalle, **cuando** se piden, **entonces** devuelven `endTime` y, si hay, `endsOn`.
- **Dado** la creación o un cambio de la hora de fin, **cuando** se avisa a la audiencia, **entonces** el aviso lleva la hora de fin (D10).

### RF-3 · Imagen del evento · Must

Un evento puede llevar una imagen (D7).

- **Dado** un organizador, **cuando** sube una imagen JPEG, PNG o WebP de hasta el límite de las portadas de noticias, **entonces** se guarda reducida a dos WebP y el formulario la enseña.
- **Dado** un archivo de otro tipo o más grande, **cuando** se sube, **entonces** se rechaza con un error en los dos idiomas.
- **Dado** un evento o una serie con imagen, **cuando** un miembro de su audiencia pide la agenda o el detalle, **entonces** recibe `coverUrl` (miniatura en la agenda, grande en el detalle) como URL firmada; fuera de la audiencia no la recibe.
- **Dado** una serie con imagen, **cuando** se leen sus sesiones, **entonces** la heredan, salvo una sesión editada sola con otra imagen o sin imagen.
- **Dado** quitar la imagen, **cuando** se guarda, **entonces** el evento vuelve al fondo de su tipo.
- **Dado** un miembro que no organiza eventos, **cuando** intenta subir una imagen, **entonces** responde 403.

### RF-4 · Lugar estructurado y enlace al mapa · Must

El lugar abre la ruta sin copiarlo a mano.

- **Dado** un lugar elegido del buscador, **cuando** se guarda el evento, **entonces** guarda el nombre, la dirección, la latitud, la longitud y, opcional, "dónde exactamente"; `location` sigue guardando el texto que se muestra.
- **Dado** un lugar con coordenadas, **cuando** se construye el enlace, **entonces** es `https://www.google.com/maps/search/?api=1&query={lat},{lng}`; sin coordenadas, `query=` el nombre y la dirección (o el texto libre) codificados.
- **Dado** el enlace, **cuando** se pulsa, **entonces** abre en una pestaña nueva (`rel="noopener"`); en un teléfono, el sistema lo abre en la aplicación de Google Maps si está instalada.
- **Dado** Copiar dirección, **cuando** se pulsa, **entonces** copia el nombre y la dirección al portapapeles, el botón enseña un check unos segundos y un lector de pantalla anuncia "Dirección copiada"; si el portapapeles falla, se avisa.
- **Dado** un evento anterior a E24 o con texto libre, **cuando** se muestra, **entonces** el enlace busca ese texto y no hay coordenadas.
- **Dado** coordenadas fuera de rango, **cuando** se guardan, **entonces** se rechazan.

### RF-5 · Buscador de lugares · Must

Elegir un lugar sin escribir la dirección (D1).

- **Dado** el campo de lugar, **cuando** el organizador escribe 3 o más caracteres, **entonces** ve primero los lugares que el club ya usó que coinciden, y después hasta 3 resultados de Photon con nombre y dirección.
- **Dado** menos de 3 caracteres, **cuando** escribe, **entonces** no se busca en Photon y se enseñan los lugares del club más usados.
- **Dado** que Photon falla, tarda más de 3 s o no está disponible, **cuando** se busca, **entonces** se enseñan solo los lugares del club y el texto libre sigue valiendo.
- **Dado** un resultado elegido, **cuando** se confirma, **entonces** se ve la tarjeta con el pin verde, el nombre, la dirección, "Ver en el mapa" y una × para cambiarlo, seguida del campo "Dónde exactamente".
- **Dado** el endpoint del buscador, **cuando** lo pide alguien que no organiza eventos, **entonces** responde 403.
- **Dado** la misma búsqueda repetida, **cuando** llega al servidor, **entonces** se responde de la caché sin llamar otra vez a Photon.
- **Dado** el teclado, **cuando** se recorre la lista, **entonces** es un `combobox` con sus opciones anunciadas.

### RF-6 · La agenda en escritorio · Must

Ver la semana de un vistazo.

- **Dado** la agenda, **cuando** se abre, **entonces** enseña los grupos por día ("TODAY" en acento, "SAT · OCT 17" en secundario, "This weekend" para sábado y domingo de la semana en curso) y filas con la barra de color, la hora de inicio y la de fin debajo, la miniatura o el fondo del tipo, el título, la etiqueta, el icono de repetición si es de una serie y el lugar como enlace al mapa.
- **Dado** el enlace del lugar en una fila, **cuando** se pulsa, **entonces** abre el mapa y no elige la fila.
- **Dado** mi respuesta, **cuando** existe, **entonces** la fila enseña su píldora (Voy, Quizás, No puedo); si no, "RSVP" en acento; debajo, "{n} van".
- **Dado** los chips de tipo, **cuando** el miembro apaga o enciende uno, **entonces** la agenda se vuelve a pedir con `types`, la URL guarda `?types=` y recargar deja el mismo filtro.
- **Dado** todos los tipos apagados, **cuando** pasa, **entonces** se ve "No hay eventos de los tipos elegidos" con un botón para encenderlos todos.
- **Dado** Próximos y Pasados, **cuando** se cambia, **entonces** se conservan el filtro, la paginación y los avisos de hoy.
- **Dado** un evento cancelado, **cuando** se muestra, **entonces** se ve tachado o atenuado con la palabra "Cancelado", nunca solo con color.

### RF-7 · El panel del evento · Must

Todo lo de un evento en el panel, sin acordeón.

- **Dado** una fila, **cuando** se elige con clic, Enter o Espacio, **entonces** el panel de 380 px enseña, en orden: imagen o fondo con la barra de color, etiqueta y audiencia, título, bloque de hora (con duración, o el rango de días si es de varios días), bloque de repetición si es de una serie ("Todos los miércoles", "Hasta el 16 dic · quedan 10 sesiones"), tarjeta del lugar con Copiar dirección y "Cómo llegar", "¿Vas?", los que van, notas, equipos (`EventTeams`) en entrenamientos y competiciones, y la fila de acciones.
- **Dado** "¿Vas?", **cuando** el miembro pulsa Voy, Quizás o No puedo, **entonces** se guarda como hoy (`yes`, `maybe`, `no`, D14), el botón elegido toma su color con `aria-pressed`, y con la membresía no al día están desactivados como hoy.
- **Dado** los que van, **cuando** son más de 7, **entonces** se ven 7 avatares con iniciales, "+n más" y "Ver todos", que abre la lista de nombres de hoy.
- **Dado** la fila de acciones, **cuando** quien mira puede, **entonces** ve Tomar asistencia (con las reglas de hoy), Editar y el botón de cancelar en rojo con la confirmación de hoy.
- **Dado** la agenda sin eventos, **cuando** se abre, **entonces** el panel no aparece y se ve el vacío de hoy; con eventos, el primero queda elegido.
- **Dado** el lugar sin dirección ni coordenadas, **cuando** se muestra, **entonces** la tarjeta enseña el texto y "Cómo llegar" busca ese texto.

### RF-8 · Agregar a mi calendario · Should

Llevar el evento al calendario personal (D9).

- **Dado** el botón `calendar-plus`, **cuando** se pulsa, **entonces** se descarga un `.ics` válido (RFC 5545) con título, inicio, fin (si hay), lugar con dirección y notas, en la zona horaria del club.
- **Dado** una sesión de una serie, **cuando** se descarga, **entonces** el archivo es solo de esa sesión.
- **Dado** un evento de varios días, **cuando** se descarga, **entonces** el fin es la fecha y hora de fin.
- **Dado** caracteres especiales (comas, saltos de línea, tildes) en el título o las notas, **cuando** se genera, **entonces** se escapan según el estándar.

### RF-9 · El formulario de crear y editar · Must

Crear un evento como en el diseño 1c.

- **Dado** el formulario, **cuando** se abre, **entonces** tiene en orden: imagen, tipo (cuatro botones con icono), título, cuándo, repetición, lugar, notas y para quién (estos dos como hoy).
- **Dado** inicio y fin, **cuando** son válidos, **entonces** se ve "Dura {duración}"; **cuando** el fin no es posterior, **entonces** se ve "La hora de fin debe ser después del inicio.", el borde del campo en rojo y Crear desactivado.
- **Dado** una duración rápida (1 h · 1 h 30 · 2 h · 3 h), **cuando** se pulsa, **entonces** el fin pasa a ser inicio más esa duración; si cruza la medianoche en un evento suelto, se enciende "Termina otro día" con la fecha siguiente.
- **Dado** "Termina otro día", **cuando** se enciende en un evento suelto, **entonces** aparece la fecha de fin; en una serie el interruptor no existe.
- **Dado** editar un evento anterior a E24, **cuando** se abre, **entonces** la hora de fin está vacía, se explica que ahora es obligatoria y no se puede guardar sin ella (D5).

### RF-10 · La repetición semanal con resumen · Must

Ver qué fechas va a crear una serie antes de guardarla.

- **Dado** Semanal, **cuando** se elige, **entonces** aparecen los siete días (L M M J V S D, círculos de 42 px), "Hasta" y el resumen ("Todos los lunes y jueves, 6 pm – 7:30 pm · 18 sesiones hasta el jue 17 dic") con las 4 primeras fechas y "+n más".
- **Dado** ningún día marcado, **cuando** se mira, **entonces** se ve "Elige al menos un día." y Crear está desactivado.
- **Dado** días que no caen entre el inicio y "Hasta", **cuando** se mira, **entonces** se ve "No cae ninguna sesión entre el inicio y la fecha final." y Crear está desactivado.
- **Dado** el resumen, **cuando** se calcula, **entonces** coincide con las sesiones que crea el servidor (`series_weekdays_empty` y `series_without_sessions` siguen siendo la validación de verdad).

### RF-11 · Partir una serie desde una sesión · Must

Cambiar una serie a partir de una fecha sin tocar las anteriores (D2).

- **Dado** una sesión futura de una serie, **cuando** el organizador guarda "Esta y las siguientes" con cambios de título, tipo, hora, lugar, notas, audiencia o imagen, **entonces** la serie original termina el día anterior a esa sesión, nace una serie nueva desde esa sesión con los cambios, y las sesiones desde esa fecha pasan a la nueva con los cambios aplicados.
- **Dado** sesiones anteriores a la elegida, futuras o pasadas, **cuando** se parte la serie, **entonces** no cambian.
- **Dado** las sesiones movidas, **cuando** se parte la serie, **entonces** conservan sus RSVP, su asistencia y sus equipos.
- **Dado** "Esta y las siguientes" con otros días de la semana u otra fecha final, **cuando** se guarda, **entonces** las sesiones que ya no encajan se cancelan (no se borran, con su RSVP guardado) y se crean las que faltan.
- **Dado** la sesión elegida es la primera de la serie, **cuando** se parte, **entonces** no queda una serie vacía: se edita la serie entera desde ahí.
- **Dado** una sesión que ya empezó, **cuando** se intenta partir desde ella, **entonces** se rechaza.
- **Dado** la partición, **cuando** termina, **entonces** se avisa a la audiencia de la serie con un solo aviso, como hoy al editar una serie (D10).
- **Dado** la partición, **cuando** falla a mitad, **entonces** no queda nada a medias (una sola transacción).

### RF-12 · El selector de alcance al editar una serie · Must

Elegir qué se edita.

- **Dado** Editar en una sesión de una serie en escritorio, **cuando** se pulsa, **entonces** aparece encima de las acciones "Este evento se repite. ¿Qué quieres editar?" con "Solo esta sesión" ("Cambia solo el {fecha}. Las demás quedan igual."), "Esta y las siguientes" y Cancelar.
- **Dado** "Solo esta sesión", **cuando** se elige, **entonces** se abre el formulario de la sesión, sin repetición, como hoy.
- **Dado** "Esta y las siguientes", **cuando** se elige, **entonces** se abre el formulario de la serie desde esa fecha, con los días y "Hasta" editables (RF-11).
- **Dado** el móvil, **cuando** se abre ⋯ en una sesión de una serie, **entonces** la hoja enseña "ESTE EVENTO SE REPITE", "Editar solo esta sesión" con su fecha, "Editar esta y las siguientes", Cancelar evento en rojo y Cerrar; en un evento suelto, Editar evento, Cancelar evento y Cerrar.

### RF-13 · La agenda y el evento en móvil · Must

El diseño 2a y 2b.

- **Dado** el móvil, **cuando** se abre el calendario, **entonces** se ve "Calendario" con el botón + de 44 px (si puede crear), Próximos | Pasados a todo el ancho, los chips de tipo con scroll lateral y tarjetas con la barra, la miniatura de 52 px, "6:00–7:30 pm", el icono de repetición, mi respuesta, el título en hasta dos líneas y el lugar.
- **Dado** una tarjeta, **cuando** se toca, **entonces** se abre la pantalla del evento con la barra de arriba (volver, etiqueta, ⋯), la imagen de 200 px y los bloques de RF-7 apilados, con "¿Vas?" en tres botones de 58 px con icono, "Cómo llegar" de 48 px y Tomar asistencia de 48 px.
- **Dado** volver, **cuando** se pulsa, **entonces** se regresa a la agenda con su scroll, filtro y período.

### RF-14 · El formulario en móvil · Must

El diseño 2c.

- **Dado** el móvil, **cuando** se crea o edita, **entonces** el formulario ocupa la pantalla con la barra Cancelar, título y Crear (o Guardar), y los campos de RF-9 a RF-10 con las medidas del handoff: tipos en rejilla 2×2 de 46 px, inicio y fin lado a lado de 48 px, días de 44 px repartidos en la fila, resultados del lugar de al menos 56 px.
- **Dado** cualquier campo de texto en móvil, **cuando** recibe el foco, **entonces** su texto es de 16 px y iOS no hace zoom.
- **Dado** Cancelar con cambios sin guardar, **cuando** se pulsa, **entonces** se pide confirmación antes de perderlos.

### RF-15 · El mapa embebido · Could

La vista previa del lugar, si se ve bien (D3).

- **Dado** un lugar con coordenadas, **cuando** se ve el panel o la pantalla del evento, **entonces** la tarjeta enseña un mapa de OpenStreetMap de 110 px con el marcador, cargado con `loading="lazy"`, con la atribución de OpenStreetMap visible.
- **Dado** el mapa, **cuando** se pulsa en cualquier punto, **entonces** abre Google Maps con el enlace de RF-4 (una capa encima del `iframe` lo recoge).
- **Dado** un lugar sin coordenadas, **cuando** se muestra, **entonces** no hay mapa, solo el enlace.
- **Dado** el panel, **cuando** carga, **entonces** el mapa no retrasa ni mueve el resto: su hueco está reservado desde el principio.
- **Dado** la revisión del `ui-reviewer` y la del dueño, **cuando** el mapa no se ve bien en los dos temas o se nota lento, **entonces** el ticket se entrega sin mapa y lo dice en el PR.

## 6. Casos borde y estados de error

- **Zona horaria:** todas las fechas y horas son de `Australia/Melbourne` (`CLUB_TIME_ZONE`). Una serie que cruza el cambio de horario mantiene la hora local. La duración de un evento que cruza el cambio de hora se calcula con las horas reales.
- **Evento que cruza la medianoche sin "Termina otro día":** se rechaza con `end_before_start`; el formulario sugiere encender el interruptor.
- **Lugar borrado de OpenStreetMap o con datos raros:** lo guardado en el evento no cambia; el enlace sigue funcionando con las coordenadas.
- **Photon caído o lento:** RF-5; nunca bloquea crear un evento.
- **Imagen que no se puede reducir** (archivo corrupto): se rechaza con un error claro y el formulario sigue.
- **Dos organizadores parten la misma serie a la vez:** la edición de eventos no tiene hoy control de concurrencia y no se añade. La partición va en una transacción con la serie bloqueada (`for update`): la segunda espera a la primera y, si su sesión ya no pertenece a esa serie, se rechaza con `session_not_in_series` y el formulario pide recargar. Si no, se aplica sobre lo que dejó la primera.
- **Partir una serie con sesiones editadas solas después de la fecha:** se aplican los cambios, igual que hoy la edición de serie pisa las ediciones sueltas futuras, y el selector lo advierte.
- **Filtro con un tipo desconocido en la URL** (`?types=foo`): se ignora el desconocido.
- **Agenda con cientos de eventos:** la paginación de hoy no cambia.
- **Portapapeles no disponible** (contexto no seguro, permiso negado): aviso "No se pudo copiar".
- **Permisos:** subir imágenes, buscar lugares y partir series solo para quien hoy puede crear o editar eventos; la API lo comprueba por su cuenta.

## 7. UX / UI

- Mockups: `docs/design/design_handoff_calendar/` (1a, 1c, 2a, 2b, 2c). Las capturas se copian a `docs/mockups/` como `calendar-redesign-*-dark.png` y `mobile-calendar-redesign-*-dark.png`.
- Flujos:
  1. Miembro: abre el calendario, filtra por Social, elige la cena, responde Voy, abre "Cómo llegar".
  2. Organizador: crea un entrenamiento semanal de lunes y jueves, elige la piscina de las sugeridas del club, revisa las próximas fechas y lo crea.
  3. Organizador: a mitad de temporada, elige la sesión del 1 de noviembre, "Esta y las siguientes", cambia la hora y guarda; las sesiones de octubre no cambian.
- Viewports a soportar: 375 / 768 / 1440.
- Iconos de Phosphor (ya instalado).

## 8. Requerimientos no funcionales

- Rendimiento: la agenda no hace una petición por evento; las URL firmadas de las miniaturas salen en la misma respuesta. El buscador de lugares responde en menos de 1 s con caché y corta a los 3 s.
- Accesibilidad: cumple `design-system.md` (axe sin violaciones). El tipo nunca va solo en color; la fila del evento es un botón y el enlace del lugar otro control; el panel, la hoja y el formulario mueven y devuelven el foco.
- Seguridad: las imágenes en bucket privado con URL firmada solo para la audiencia; Photon detrás de nuestro servidor con un `User-Agent` identificable y sin datos del usuario; las coordenadas validadas en rango.
- Coste: ningún servicio de pago. Photon y OpenStreetMap con sus reglas de uso justo.
- Sin dependencias nuevas salvo que un ticket lo justifique en su PR (el `.ics` se escribe a mano).

## 9. Preguntas abiertas

- Ninguna bloquea. D1, D2 y D3 las decidió el dueño.

## 10. Descomposición en tickets (para write-ticket)

| #   | Título propuesto                                                                     | Tamaño | Depende de    | Auto-merge sugerido                                |
| --- | ------------------------------------------------------------------------------------ | ------ | ------------- | -------------------------------------------------- |
| 1   | Añade los colores, la etiqueta y el fondo de cada tipo de evento                     | S      | ninguna       | Sí: tokens y estilos cubiertos por las líneas base |
| 2   | Añade la hora de fin y los eventos de varios días                                    | M      | ninguna       | No: migración y validación de eventos              |
| 3   | Filtra la agenda por tipo en la API                                                  | S      | ninguna       | No: lectura con audiencia y paginación             |
| 4   | Añade la imagen de eventos y series, reducida y servida con URL firmada              | M      | ninguna       | No: almacenamiento y permisos                      |
| 5   | Guarda el lugar estructurado de eventos y series y construye el enlace al mapa       | M      | ninguna       | No: migración y API                                |
| 6   | Busca lugares con Photon desde el servidor, con los del club primero                 | M      | 5             | No: servicio externo                               |
| 7   | Rehace la lista de la agenda en escritorio con los chips de tipo                     | M      | 1, 2, 3, 4, 5 | No: pantalla principal del calendario              |
| 8   | Sustituye el acordeón por el panel del evento en escritorio                          | M      | 7             | No: RSVP y acciones de organizador                 |
| 9   | Añade Agregar a mi calendario con un archivo .ics de la sesión                       | S      | 8             | No: lógica nueva                                   |
| 10  | Rehace el formulario con imagen, tipo y cuándo, con hora de fin y duraciones rápidas | M      | 1, 2, 4       | No: creación de eventos                            |
| 11  | Añade a la repetición semanal el resumen y las próximas fechas                       | S      | 10            | No: creación de series                             |
| 12  | Añade al formulario el buscador de lugares y la tarjeta confirmada                   | M      | 6, 10         | No: creación de eventos                            |
| 13  | Parte una serie desde una sesión con los cambios de sus campos                       | M      | 2, 4, 5       | No: lógica de series y datos de RSVP               |
| 14  | Permite cambiar los días y la fecha final al partir una serie                        | M      | 13            | No: cancela y crea sesiones                        |
| 15  | Añade el selector de alcance al editar una sesión de una serie                       | S      | 8, 12, 14     | No: edición de series                              |
| 16  | Lleva la agenda, el evento y la hoja ⋯ al móvil                                      | M      | 8, 15         | No: pantallas principales                          |
| 17  | Lleva el formulario de eventos al móvil a pantalla completa                          | M      | 11, 12        | No: creación de eventos                            |
| 18  | Añade el mapa embebido de OpenStreetMap si cumple la condición de D3                 | S      | 8             | No: contenido de terceros, lo decide la revisión   |

Orden sugerido: 1 a 5 van en paralelo al principio (2, 4 y 5 tocan migraciones de eventos y series, así que conviene que no coincidan en el mismo día o que el segundo rebase). Después 6, 7 y 10; luego 8, 11, 12 y 13; luego 9, 14 y 17; luego 15 y 16; el 18 al final.
