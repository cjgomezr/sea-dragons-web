# PRD: E22 · El rediseño de las noticias

**Estado:** aprobado · **Fecha:** 13 de octubre de 2026 · **Autor:** sesión de planificación (Claude Code)

Fuente: el diseño que el dueño hizo con Claude Design, guardado en `docs/design/design_handoff_news/` (el prototipo `News Upgrade.dc.html`, su `README.md` de handoff, `support.js` e `image-slot.js`), con sus capturas copiadas a `docs/mockups/` como `news-redesign-*-dark.png` (escritorio) y `mobile-news-redesign-*-dark.png` (móvil). Se construyen el feed **2a**, el formulario **2b** y la publicación abierta **1c** en escritorio, y sus versiones de móvil **2c**, **2d** y **2e** por debajo de 768 px. Las demás secciones (1a, 1b, 1d, 1e, 1f) son exploraciones y no se construyen. Es una épica añadida después del plan. Cambia cómo se presenta E11 y le añade tres cosas que E11 dejó fuera a propósito: la portada, el texto con formato y fijar una publicación.

El `README.md` del handoff es parte de este PRD: tiene las medidas, los colores, los textos y cada estado. Lo que dice aquí manda sobre él cuando no coinciden.

Las decisiones van marcadas como D1 a D11. D1, D2, D3, D10 y D11 las tomó o confirmó el dueño el 13 de octubre de 2026.

- **D1.** **Solo el Admin fija.** Solo cabe una publicación fijada por club, y fijar otra quita la anterior aunque sea de otra persona. Si el Committee pudiera fijar, dos personas se pisarían el destacado. El Committee sigue publicando, editando y retirando lo suyo como hoy (RF-6 de E11). El handoff decía `canManage`; esta decisión lo sustituye.
- **D2.** **Las imágenes dentro del cuerpo entran**, como último ticket. Así no frenan el editor ni el resto de la épica.
- **D3.** La publicación abierta es la **1c**: portada arriba y columna de lectura centrada. La 1d queda descartada.
- **D4.** Están diseñados el **escritorio y el móvil, en tema oscuro**. El corte es 768 px: por debajo, el móvil; desde ahí, el escritorio. El tema claro aplica el mismo diseño con los tokens claros, y la tableta usa el de escritorio. Sin mockup propio, el `ui-reviewer` revisa los dos contra `design-system.md`, como hizo E21 (su D5).
- **D5.** Los colores sueltos del diseño pasan a ser tokens, con su versión clara: barra del editor (`#0f2131`), segmento elegido (`#1d4869`) y borde punteado (`#3a5670`). El fondo al pasar el ratón (`#1a3349`) ya existe desde E21 como `--color-hover`, y el código en línea también lo usa. La categoría Document estrena su verde (`--color-success`) para distinguirse de News.
- **D6.** **La portada se reduce en el servidor**, como la foto de perfil (#271, #353): se guardan dos versiones WebP, una miniatura para las filas del feed y una grande para la tarjeta destacada y la publicación. El original no se sirve. El motivo es el mismo de E11 D3: el tráfico de salida de Supabase.
- **D7.** **La caducidad del fijado se calcula al leer**, comparando `pinned_until` con la hora actual. No hace falta ningún trabajo programado que la quite.
- **D8.** **Retirar una publicación fijada la desfija**, y volver a publicarla no la vuelve a fijar. Una retirada destacada no tiene sentido, y la que vuelve no debe quitarle el sitio a otra sin que el Admin lo decida.
- **D9.** **El cuerpo sigue guardándose como texto** y se interpreta como Markdown al mostrarlo. Las publicaciones que ya existen se ven igual que hoy, porque un salto de línea simple se respeta. No hay migración del contenido.
- **D10.** En el móvil, **la cabecera y la barra de pestañas de la app se quedan**: las capturas no las dibujan, pero son el marco de todas las pantallas. Las barras propias de la publicación (volver, categoría, ⋯) y del formulario (Cancelar, título, Publicar) van debajo de la cabecera de la app y se quedan arriba al hacer scroll.
- **D11.** **Ningún objetivo táctil baja de 44 px.** El handoff lo pide, pero dibuja algunos botones más pequeños (Publicar de 36 px, la barra de formato y los segmentos de 40 px). Se dibujan con su tamaño y su zona táctil llega a 44 px.

## 1. Problema

El feed de noticias es una lista de texto plano: todas las filas pesan igual y no hay forma de destacar lo importante. Un aviso urgente (cierre de inscripciones, una piscina cerrada) baja en cuanto alguien publica otra cosa. El cuerpo no admite formato, así que un documento con apartados o una lista de pasos se lee como un bloque. Y sin imágenes, una crónica del torneo no se distingue de un aviso de la junta.

## 2. Usuarios y contexto

- **Admin, desde el portátil:** publica los avisos del club y necesita que el importante se quede arriba unos días.
- **Committee, desde el portátil o el móvil:** publica crónicas, documentos y avisos de su área.
- **Todos los miembros, sobre todo desde el móvil:** leen el feed y abren las publicaciones.
- **Hoy lo resuelven así:** el Admin vuelve a publicar el aviso para que suba, y el formato se imita con guiones y mayúsculas a mano.

## 3. Objetivo y métricas de éxito

- **Objetivo:** que lo importante se vea primero, que una publicación se pueda escribir con formato e imagen, y que nada de lo que hoy hace E11 se pierda.
- **Métricas:**
  - El Admin fija un aviso desde el feed en dos clics (fijar y elegir la duración), sin abrir el formulario.
  - La publicación fijada es lo primero que ve cualquier miembro de su audiencia al abrir Noticias, hasta que caduca o se desfija.
  - Ninguna publicación que ya existe cambia de aspecto en su cuerpo: un test lo comprueba con cuerpos reales de texto plano.
  - Ninguna función de E11 desaparece: los tests de comportamiento que ya existen siguen pasando, adaptados a la estructura nueva pero sin quitarles casos.

## 4. Alcance

**Incluido (v1):**

- El fondo de cada categoría para lo que no tiene portada, y los tokens nuevos (D5).
- La portada opcional: subirla, quitarla, y verla en el feed y en la publicación.
- Fijar y desfijar, con duración, desde el feed y desde el formulario (solo el Admin, D1).
- El feed nuevo: tarjeta destacada, lista con miniaturas y "Cargar más".
- La publicación abierta 1c, con el cuerpo en Markdown y los adjuntos como tarjetas.
- El formulario de publicar y editar: portada, categoría segmentada, contador del título, editor con Escribir y Vista previa, barra de formato, atajos, caja de fijar, audiencia y adjuntos con el aspecto nuevo.
- Las imágenes dentro del cuerpo (D2).
- El móvil (2c, 2d, 2e), con la hoja ⋯ de la publicación desde la que se edita, se fija y se retira.
- Tema claro y tableta (D4), inglés y español.

**Explícitamente fuera (por ahora):**

- Comentarios, reacciones, borradores y publicación programada (siguen fuera, como en E11).
- Fijar más de una publicación a la vez.
- Avisar a la audiencia al fijar: solo se avisa al publicar (E11 D2).
- La portada en el panel de inicio y en la búsqueda global (E14): siguen como están.
- Recortar o encuadrar la portada al subirla: se muestra con `object-fit: cover`.
- Las exploraciones 1a, 1b, 1d, 1e y 1f del prototipo.

## 5. Requerimientos funcionales

Para medidas, colores y textos de cada pieza, ver el `README.md` del handoff. Cada RF se cumple en inglés y en español, en claro y oscuro, a 375, 768 y 1440.

### RF-1 · El fondo de cada categoría y los tokens nuevos · Must

Lo que no tiene portada se distingue por su categoría.

- **Dado** una publicación sin portada, **cuando** se muestra en cualquier sitio que espera una, **entonces** se ve el degradado y el icono de su categoría según la tabla del handoff (Announcement con `megaphone-simple` en el tono de aviso, News con `newspaper` en el acento, Document con `file-text` en el verde).
- **Dado** la etiqueta de categoría, **cuando** se muestra, **entonces** Document usa el verde y no el acento, y el texto sigue en `--color-text` con contraste AA en los dos temas.
- **Dado** los colores sueltos del diseño (D5), **cuando** se usan, **entonces** salen de tokens definidos en el tema claro, en el oscuro y en la preferencia del sistema.
- **Dado** el icono del fondo, **cuando** se pinta, **entonces** es decorativo y no lo anuncia un lector de pantalla.

### RF-2 · La portada: subirla, guardarla y servirla · Must

- **Dado** quien publica, **cuando** sube una portada JPEG, PNG o WebP de hasta 10 MB, **entonces** se guardan sus dos versiones WebP (D6) y la publicación la enlaza.
- **Dado** un archivo de otro tipo o de más de 10 MB, **cuando** se sube como portada, **entonces** se rechaza con un mensaje que dice por qué.
- **Dado** una publicación con portada, **cuando** se pide el feed o el detalle, **entonces** cada uno trae la dirección de la versión que usa, o `null` si no tiene.
- **Dado** alguien que no es audiencia de la publicación, **cuando** pide la portada por su dirección directa, **entonces** no la obtiene, igual que un adjunto (RF-3 de E11).
- **Dado** una publicación retirada, **cuando** alguien que no la publicó pide su portada, **entonces** no se sirve.
- **Dado** quien edita, **cuando** quita o cambia la portada, **entonces** la anterior deja de servirse.

### RF-3 · Fijar y desfijar: la regla y la API · Must

- **Dado** un Admin, **cuando** fija una publicación por 1, 2 o 4 semanas o hasta desfijarla, **entonces** queda fijada con esa fecha de fin, o sin fecha.
- **Dado** otra publicación ya fijada, **cuando** el Admin fija una nueva, **entonces** la anterior se desfija en la misma transacción y nunca hay dos fijadas en el club.
- **Dado** una fijada cuya fecha de fin ya pasó, **cuando** se pide el feed, **entonces** cuenta como no fijada (D7).
- **Dado** un Committee, Coach o Player, **cuando** intenta fijar o desfijar por la API, **entonces** recibe 403 y no cambia nada (D1).
- **Dado** fijar o desfijar, **cuando** ocurre, **entonces** la bitácora guarda quién, qué publicación y hasta cuándo.
- **Dado** una publicación fijada, **cuando** se retira, **entonces** se desfija; **cuando** se vuelve a publicar, **entonces** sigue sin fijar (D8).
- **Dado** el formulario de publicar o editar, **cuando** un Admin manda `pin`, **entonces** se aplica la misma regla que en el endpoint de fijar.

### RF-4 · El feed con la destacada · Must

- **Dado** una publicación fijada visible para quien mira, **cuando** abre Noticias, **entonces** la ve como tarjeta destacada con "Fijada · hasta {fecha}" (o solo "Fijada" si no tiene fin), y la lista de debajo, titulada "Lo último", no la repite.
- **Dado** que no hay fijada, o que la fijada no es para quien mira, **cuando** abre Noticias, **entonces** la destacada es la más reciente que sí ve, con la marca "Lo último", y la lista de debajo se titula "Anteriores".
- **Dado** la respuesta del feed, **cuando** se pide la primera página, **entonces** trae `pinned` (o `null`) filtrada por audiencia, y `posts` sigue de la más nueva a la más antigua sin la fijada.
- **Dado** cada fila de la lista, **cuando** se muestra, **entonces** lleva miniatura (o el fondo de su categoría), categoría, punto de no leída, "hace cuánto · autor", clip con el número de adjuntos, título y una línea de extracto cortada con puntos suspensivos.
- **Dado** una publicación no leída, **cuando** se muestra, **entonces** lleva el punto de acento, y en la destacada además la palabra "Nueva". La lógica de visto es la de hoy.
- **Dado** más de 20 publicaciones, **cuando** se pulsa "Cargar más", **entonces** se añaden las siguientes y el foco va a la primera nueva, como hoy.
- **Dado** un feed vacío, **cuando** se abre, **entonces** se ve la frase de hoy y no una tarjeta destacada vacía.
- **Dado** quien no puede publicar, **cuando** abre Noticias, **entonces** no ve "+ Publicar".

### RF-5 · Fijar desde el feed · Must

- **Dado** un Admin, **cuando** pulsa el chincheta de una fila, **entonces** se abre debajo de esa fila la tira "Fijar arriba durante" con 1 semana · 2 semanas · 4 semanas · Hasta que la desfije, y un enlace Cancelar.
- **Dado** que ya hay otra fijada, **cuando** se abre la tira, **entonces** avisa "Reemplaza a la que está fijada ahora."
- **Dado** que el Admin elige una duración, **cuando** se guarda, **entonces** esa publicación pasa a la destacada y la anterior vuelve a la lista en su sitio por fecha.
- **Dado** la destacada fijada, **cuando** el Admin pulsa Desfijar, **entonces** se desfija y la destacada pasa a ser la más reciente.
- **Dado** quien no es Admin, **cuando** mira el feed, **entonces** no ve el chincheta, ni Fijar, ni Desfijar.
- **Dado** que el servidor rechaza fijar, **cuando** pasa, **entonces** la fila dice el error y el feed no cambia.

### RF-6 · El cuerpo en Markdown y el extracto · Must

- **Dado** un cuerpo con encabezados, negrita, cursiva, listas, citas, enlaces y código en línea, **cuando** se muestra, **entonces** se ve con los estilos del handoff.
- **Dado** un cuerpo con HTML (por ejemplo `<script>` o `<img onerror>`), **cuando** se muestra, **entonces** se ve como texto y no se ejecuta ni se interpreta.
- **Dado** un enlace `javascript:`, `data:` o de cualquier esquema que no sea `http(s):`, `mailto:` o `#`, **cuando** se muestra, **entonces** no es un enlace.
- **Dado** una publicación antigua de texto plano con saltos de línea, **cuando** se abre, **entonces** se ve con los mismos párrafos y saltos que hoy (D9).
- **Dado** un cuerpo con Markdown, **cuando** se calcula el extracto del feed, **entonces** no lleva `#`, `*` ni corchetes: los enlaces quedan en su texto y las imágenes desaparecen. El corte sin partir palabras de E11 se mantiene.

### RF-7 · La publicación abierta (1c) · Must

- **Dado** una publicación, **cuando** se abre, **entonces** se ve de arriba abajo: volver, la portada a lo ancho (o el fondo de su categoría, a la misma altura), y una columna de hasta 680 px con categoría y audiencia, título, autor con su foto y "Publicada … · Editada …", una línea, el cuerpo en Markdown y los adjuntos.
- **Dado** quien puede editar o retirar, **cuando** la abre, **entonces** ve los botones Editar y Retirar con la lógica de hoy (`NewsPostActions`).
- **Dado** los adjuntos, **cuando** se muestran, **entonces** son tarjetas con icono del tipo de archivo, nombre, tamaño y descarga, con la misma regla de acceso de E11.
- **Dado** lo que E11 ya garantiza (404 a quien no es audiencia, la retirada marcada para quien la publicó, la marca de editada), **cuando** se abre con el diseño nuevo, **entonces** sigue igual.

### RF-8 · El formulario de publicar y editar · Must

- **Dado** el formulario, **cuando** se abre, **entonces** trae en este orden: portada opcional, categoría como control segmentado, título con contador "n / 120", editor del cuerpo, caja de fijar (solo Admin), quién puede verla y adjuntos.
- **Dado** que no hay portada, **cuando** se mira el formulario, **entonces** se ve el fondo de la categoría elegida con "Sin portada · Se usa el fondo de {categoría}." y el botón "Añadir portada", y el fondo cambia al cambiar la categoría.
- **Dado** una portada subida, **cuando** se mira, **entonces** se ve a 220 px con la pista del handoff y el enlace "Quitar portada".
- **Dado** el botón Publicar, **cuando** falta el título, el cuerpo o una audiencia válida, o hay una subida en curso, **entonces** está desactivado. El doble clic sigue mandando una sola petición.
- **Dado** que se publica bien, **cuando** se vuelve al feed, **entonces** un aviso anuncia "Publicada · avisamos a {audiencia}", y si se fijó, "Publicada y fijada hasta {fecha} · avisamos a {audiencia}".
- **Dado** editar una publicación, **cuando** se abre, **entonces** es el mismo formulario relleno con lo que tiene, portada y fijado incluidos.
- **Dado** los adjuntos, **cuando** se muestran, **entonces** son filas de archivo con una zona punteada "Añadir archivos", con los límites de E11 (5 archivos, 10 MB).

### RF-9 · El editor: Escribir, Vista previa y formato · Must

- **Dado** la pestaña Escribir, **cuando** se selecciona texto y se pulsa Negrita, Cursiva o Enlace, **entonces** la selección queda envuelta en `**…**`, `*…*` o `[…](https://)` y sigue seleccionada.
- **Dado** varias líneas seleccionadas, **cuando** se pulsa Encabezado, Lista, Lista numerada o Cita, **entonces** cada línea recibe su prefijo (`## `, `- `, `1. `, `> `).
- **Dado** el foco en el área de texto, **cuando** se pulsa ⌘/Ctrl+B o ⌘/Ctrl+I, **entonces** hace lo mismo que el botón, y pulsar un botón no le quita el foco al texto.
- **Dado** la pestaña Vista previa, **cuando** se abre, **entonces** el cuerpo se ve con el mismo renderizador que la publicación (RF-6), y si está vacío dice "Todavía no hay nada que previsualizar."
- **Dado** el pie del editor, **cuando** se muestra, **entonces** dice "Admite Markdown · ⌘B negrita · ⌘I cursiva" (Ctrl fuera de Mac) y el enlace "Ayuda de formato" despliega la chuleta de la sintaxis.
- **Dado** la pista del cuerpo, **cuando** se muestra, **entonces** ya no dice "Texto plano".
- **Dado** la barra de formato, **cuando** se usa con teclado, **entonces** cada botón de solo icono tiene nombre accesible y se alcanza con Tab.

### RF-10 · El feed en el móvil (2c) · Must

- **Dado** menos de 768 px, **cuando** se abre Noticias, **entonces** la cabecera lleva la etiqueta, "Club feed" a 26 px y, a quien puede publicar, un botón de icono "+" de 44 px con nombre accesible.
- **Dado** la destacada, **cuando** se muestra, **entonces** ocupa el ancho menos 16 px por lado, con la portada (o el fondo, con icono de 64 px) a 190 px, y debajo categoría, punto, "hace cuánto · autor", el título a 20 px y dos líneas de extracto.
- **Dado** una destacada fijada, **cuando** se muestra, **entonces** la píldora "Fijada" va sobre la esquina de la imagen y no impide tocar la tarjeta.
- **Dado** cada fila, **cuando** se muestra, **entonces** lleva miniatura de 72 px, la línea de categoría, punto, hora y adjuntos, y el título en hasta dos líneas, sin extracto ni chincheta.
- **Dado** "Cargar más", **cuando** se muestra, **entonces** ocupa el ancho y mide 46 px.

### RF-11 · La publicación en el móvil (2d) y la hoja ⋯ · Must

- **Dado** menos de 768 px, **cuando** se abre una publicación, **entonces** se ve una barra con volver, el nombre de la categoría y ⋯ (D10), la portada a sangre a 220 px y el contenido con 18 px de margen: audiencia, título a 26 px, autor con fechas, cuerpo (imágenes a 200 px) y adjuntos en filas de al menos 56 px.
- **Dado** quien no puede editar, retirar ni fijar, **cuando** la abre, **entonces** no ve ⋯.
- **Dado** ⋯, **cuando** se pulsa, **entonces** sube una hoja con fondo atenuado, asa y filas de al menos 52 px: Editar publicación y Retirar (en rojo) a quien hoy puede (`NewsPostActions`), "Fijar arriba" o "Desfijar" solo al Admin (D1), y Cancelar.
- **Dado** "Fijar arriba", **cuando** se pulsa, **entonces** la hoja ofrece 1 semana · 2 semanas · 4 semanas · Hasta que la desfije, con el aviso si reemplaza a otra fijada, y guarda con la regla de RF-3.
- **Dado** Retirar, **cuando** se pulsa, **entonces** pide la misma confirmación que hoy.
- **Dado** la hoja abierta, **cuando** se pulsa Esc, el fondo o Cancelar, **entonces** se cierra y el foco vuelve a ⋯.

### RF-12 · El formulario en el móvil (2e) · Must

- **Dado** menos de 768 px, **cuando** se abre el formulario, **entonces** lleva una barra con Cancelar, "Nueva publicación" (o "Editar publicación") y Publicar (D10), y debajo los campos en el orden de RF-8.
- **Dado** Publicar en la barra, **cuando** el formulario no es válido o hay una subida en curso, **entonces** está desactivado; **cuando** se publica bien, **entonces** dice "✓ Publicada" y vuelve al feed con el aviso de RF-8.
- **Dado** la portada, **cuando** no hay, **entonces** se ve el fondo a 140 px con "Añadir portada" abajo a la izquierda; **cuando** hay, **entonces** se ve a 180 px con "Quitar portada".
- **Dado** el título, **cuando** se toca en iOS, **entonces** no hace zoom: su letra es de 16 px.
- **Dado** el editor, **cuando** se muestra, **entonces** las pestañas ocupan el ancho, la barra de formato es su propia fila que se desplaza de lado sin mover la página, y el área de texto mide al menos 260 px.
- **Dado** la caja de fijar del Admin, **cuando** se enciende el interruptor, **entonces** sale la duración (que se desplaza de lado si no cabe), la fecha en que se desfija y el aviso si reemplaza a otra.
- **Dado** la audiencia y los adjuntos, **cuando** se muestran, **entonces** las filas de audiencia miden 44 px y "Añadir archivos" es un botón punteado de 52 px.

### RF-13 · Tableta y tema claro · Must

Sin mockup (D4).

- **Dado** 768 px, **cuando** se abre cualquiera de las tres pantallas, **entonces** usa la maqueta de escritorio sin scroll horizontal.
- **Dado** el tema claro, **cuando** se abre cualquiera de las tres pantallas en cualquier ancho, **entonces** usa la misma maqueta con los tokens claros y pasa axe.
- **Dado** cualquier control táctil de las tres pantallas, **cuando** se mide, **entonces** su zona táctil llega a 44 px (D11).

### RF-14 · Imágenes dentro del cuerpo · Should

- **Dado** la pestaña Escribir, **cuando** se pulsa Imagen y se elige un JPEG, PNG o WebP de hasta 10 MB, **entonces** se sube, se reduce en el servidor como la portada (D6), y se inserta `![pie](dirección)` donde estaba el cursor.
- **Dado** la dirección de una imagen del cuerpo, **cuando** la pide alguien que no es audiencia, o la publicación está retirada, **entonces** no se sirve, igual que un adjunto.
- **Dado** una imagen en el cuerpo, **cuando** se muestra, **entonces** ocupa el ancho de la columna con radio 8 y, si tiene texto alternativo, un pie de 13 px.
- **Dado** que la subida falla, **cuando** pasa, **entonces** no se inserta nada y el editor dice por qué.
- **Dado** una imagen externa (`![](https://otro-sitio)`), **cuando** se muestra, **entonces** no se carga: solo se sirven las del club.

## 6. Casos borde y estados de error

- **Feed vacío o de una sola publicación:** con una, es la destacada y no hay lista ni etiqueta de lista. Con ninguna, la frase de hoy.
- **La fijada no es para quien mira:** `pinned` es `null` y su destacada es la más reciente que sí ve (RF-4). La fijada no aparece en su lista.
- **La fijada caduca con la página abierta:** se ve como fijada hasta recargar. No se refresca sola.
- **Dos Admin fijan a la vez:** gana la última transacción y nunca quedan dos fijadas (lo garantiza la base, no la pantalla).
- **Editar la audiencia de la fijada:** quien deja de ser audiencia deja de verla como destacada en su próxima carga.
- **Cargar más con una fijada:** la fijada no vuelve a salir en ninguna página.
- **Cuerpo con Markdown roto** (un `**` sin cerrar, una lista a medias): se muestra como texto, nunca rompe la pantalla.
- **Título de 120 caracteres o un nombre de autor muy largo:** se parten en líneas en la destacada y en la publicación; en la fila del feed, el extracto se corta en una línea.
- **Portada vertical o diminuta:** se encuadra con `object-fit: cover`; no se rechaza por tamaño mínimo.
- **Quitar la portada y no guardar:** la publicación conserva la suya.
- **Retirar con la tira de fijar abierta en otra pestaña:** el servidor rechaza fijar una retirada, con mensaje.
- **Sin red al subir la portada o una imagen:** Publicar sigue desactivado hasta que acabe o se quite, como hoy con los adjuntos.
- **Permisos:** Committee edita su publicación pero no ve la caja de fijar ni "Fijar arriba" en la hoja ⋯; si la publicación está fijada, editar no la desfija.
- **Girar el móvil o ensanchar la ventana con la hoja ⋯ abierta:** al pasar de 768 px la hoja se cierra y quedan los botones de escritorio.

## 7. UX / UI

- **Mockups (modo A del `ui-reviewer`):**
  - Escritorio: `docs/mockups/news-redesign-feed-pinned-dark.png`, `news-redesign-feed-pin-duration-dark.png`, `news-redesign-feed-no-pin-dark.png`, `news-redesign-publish-write-dark.png`, `news-redesign-publish-preview-dark.png` y `news-redesign-post-dark.png`.
  - Móvil: `docs/mockups/mobile-news-redesign-feed-dark.png`, `mobile-news-redesign-post-dark.png`, `mobile-news-redesign-post-actions-dark.png`, `mobile-news-redesign-publish-write-dark.png` y `mobile-news-redesign-publish-preview-dark.png`.
  - El prototipo interactivo: `docs/design/design_handoff_news/News Upgrade.dc.html` (secciones 2a, 2b, 2c, 2d, 2e y 1c).
- Las capturas de móvil no dibujan la cabecera ni la barra de pestañas de la app, que se quedan (D10).
- Los recuadros punteados de "Drop a cover photo" de las capturas representan la portada real: no se construyen. Los datos son de ejemplo.
- Los mockups viejos `news-dark.png`, `news-light.png` y sus versiones de móvil quedan como referencia del diseño anterior.
- Tema claro y tableta: sin mockup, revisión heurística contra `design-system.md` (D4, RF-13).
- Iconos de Phosphor, que la app ya usa desde E21.
- Viewports: 375 / 768 / 1440.

## 8. Requerimientos no funcionales

- **Accesibilidad:** axe sin violaciones en todos los estados. Botones de solo icono con `aria-label`. El control segmentado se maneja con teclado y anuncia la opción elegida. La tira de fijar se cierra con Esc y devuelve el foco al chincheta. Ningún estado (fijada, no leída) se cuenta solo con color.
- **Seguridad:** el Markdown se interpreta sin HTML y con lista blanca de esquemas (RF-6). Fijar se comprueba en el servidor (D1), y la unicidad de la fijada la garantiza la base, no la aplicación. La portada y las imágenes del cuerpo heredan la regla de acceso de los adjuntos.
- **Rendimiento:** el feed sigue trayendo 20 por página. Las filas cargan la miniatura y nunca la versión grande. Una portada grande de 1440 px no pasa de unos cientos de KB.
- **Dependencias:** `react-markdown`, `remark-gfm` y `remark-breaks` (o equivalentes), cada una con su línea de justificación en el PR que la añada. Si el renderizador no garantiza por sí solo la salida limpia, también `rehype-sanitize`.

## 9. Preguntas abiertas

- Ninguna que bloquee. D1, D2, D3, D10 y D11 las respondió el dueño el 13 de octubre de 2026.

## 10. Descomposición en tickets (para write-ticket)

| #         | Título propuesto                                                                                  | Tamaño | Depende de | Auto-merge sugerido                                     |
| --------- | ------------------------------------------------------------------------------------------------- | ------ | ---------- | ------------------------------------------------------- |
| 1 (#590)  | Añade los tokens de las noticias y el fondo de cada categoría para lo que no tiene portada (RF-1) | S      | ninguna    | No: tokens de toda la app y cambia el color de Document |
| 2 (#591)  | Guarda y sirve la portada de una publicación en dos tamaños (RF-2)                                | M      | ninguna    | No: migración y regla de acceso a archivos              |
| 3 (#592)  | Deja que un Admin fije una publicación con fecha de fin (RF-3)                                    | M      | ninguna    | No: permisos, migración y lógica nueva                  |
| 4 (#593)  | Muestra el cuerpo como Markdown seguro y saca el extracto sin formato (RF-6)                      | M      | ninguna    | No: dependencias nuevas y riesgo de XSS                 |
| 5 (#594)  | Rehace el feed de escritorio con la tarjeta destacada y la lista con miniaturas (RF-4, RF-13)     | M      | 1, 2, 3, 4 | No: UI nueva                                            |
| 6 (#595)  | Fija y desfija desde el feed de escritorio con la tira de duración (RF-5)                         | S      | 5          | No: acción de Admin                                     |
| 7 (#596)  | Rehace la publicación abierta de escritorio con portada y columna de lectura (RF-7, RF-13)        | M      | 1, 2, 4    | No: UI nueva                                            |
| 8 (#597)  | Rehace el formulario de publicar y editar con portada y categoría segmentada (RF-8, RF-13)        | M      | 1, 2       | No: UI nueva y flujo de subida                          |
| 9 (#598)  | Añade al formulario el editor con Escribir, Vista previa y barra de formato (RF-9)                | M      | 4, 8       | No: UI nueva                                            |
| 10 (#599) | Añade al formulario la caja de fijar para el Admin (RF-8, RF-3)                                   | S      | 3, 8       | No: acción de Admin                                     |
| 11 (#600) | Rehace el feed en el móvil (RF-10)                                                                | S      | 5          | No: UI nueva                                            |
| 12 (#601) | Rehace la publicación en el móvil con la hoja ⋯ para editar, fijar y retirar (RF-11)              | M      | 3, 7       | No: acciones de Admin y de quien publica                |
| 13 (#602) | Rehace el formulario en el móvil con su barra y el editor desplazable (RF-12)                     | M      | 9, 10      | No: UI nueva                                            |
| 14 (#603) | Sube imágenes dentro del cuerpo desde el editor (RF-14)                                           | M      | 2, 9       | No: subida, acceso a archivos y lo que se renderiza     |

Cada ticket de pantalla (1, 5 a 14) cubre los dos temas y los dos idiomas, y lleva `ui-review`. Los de escritorio (5 a 10) no tienen que dejar el móvil como en el mockup, pero sí usable: sin scroll horizontal a 375 px, con axe en verde y con zonas táctiles de 44 px. El móvil fiel al mockup lo cierran el 11, el 12 y el 13.

**Carriles en paralelo:** los cuatro primeros no dependen entre sí y pueden ir a la vez: el 1 es solo CSS, el 2 y el 3 llevan migración (los hace quien tenga el MCP de Supabase) y el 4 es solo cliente y librería. Después, el 5 (feed), el 7 (publicación) y el 8 (formulario) van en tres carriles. Tras el 5, el 6 y el 11; tras el 7, el 12; tras el 8, el 9 y el 10, y tras esos dos, el 13. El 14 cierra.

**Cuidado con las líneas base:** el 1 cambia el color de Document en el feed de hoy, así que sus capturas cambian antes de que exista el feed nuevo. Cada ticket de pantalla acepta las suyas.
