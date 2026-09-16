# PRD: E17 · Bilingüe (inglés y español)

**Estado:** borrador · **Fecha:** 16 de septiembre de 2026 · **Autor:** sesión de planificación (Claude Code)

Fuente: petición del dueño del 16 de septiembre de 2026. Es una épica llegada después del plan: ni `docs/SRD_Victoria_Seadragons_Club_Platform.md` (v1.4) ni `docs/plan-maestro.md` ni `docs/preguntas-abiertas.md` dicen nada sobre idiomas. No cubre ningún FR existente; los crea esta épica.

## 1. Problema

El club está en Melbourne y la mayoría de sus socios habla inglés. La plataforma está escrita entera en español, con los textos incrustados en cada pantalla y en los dos correos que salen hoy. Un socio australiano se encuentra con un formulario de registro que no entiende, y el club vuelve a WhatsApp, que es lo que la plataforma existe para reemplazar.

Esto se resuelve ahora o se paga caro después. Hoy hay unas diez pantallas y dos correos. Después de calendario, noticias, pagos y evaluaciones habrá el triple, y cada pantalla que nazca en un solo idioma es una pantalla que alguien tendrá que revisar de nuevo. Con la infraestructura puesta, cada pantalla nueva nace en los dos idiomas y el costo por pantalla es casi cero.

## 2. Usuarios y contexto

- **Socio australiano:** habla inglés, su navegador está en inglés, y hoy no entiende la aplicación. Es la mayoría del club.
- **Socio hispanohablante:** parte del club viene de Latinoamérica y prefiere español. Es quien usa la plataforma hoy.
- **Administrador del club:** escribe avisos y gestiona socios. Necesita ver la interfaz en su idioma sin que eso cambie lo que ven los demás.
- **Hoy lo resuelven así:** el socio que no entiende pregunta por WhatsApp, o traduce la página con el navegador y ve una traducción automática que rompe el diseño.

## 3. Objetivo y métricas de éxito

- Objetivo: que cualquier persona use la plataforma entera en inglés o en español, y cambie de idioma cuando quiera, igual que cambia de tema.
- Métricas:
  - Cero textos visibles sin traducir: un test recorre los dos catálogos y falla si a uno le falta una clave que el otro tiene.
  - Quien llega con el navegador en inglés ve la aplicación en inglés sin tocar nada.
  - Los dos correos del club salen en el idioma que la persona tenía al registrarse.
  - Ninguna etiqueta de la barra móvil se parte en dos líneas a 360 píxeles, en ninguno de los dos idiomas.

## 4. Alcance

**Incluido (v1):**

- La infraestructura de traducción: un catálogo por idioma y la función que lo lee, usable desde el servidor y desde el navegador.
- La elección del idioma: cookie que el servidor lee en cada petición, la cabecera del navegador como respaldo, e inglés cuando no hay ninguna pista.
- El interruptor de idioma, junto al del tema, que recuerda la elección.
- Las pantallas de autenticación traducidas: entrar, registro, completar registro, consentimiento del tutor, recuperar contraseña y contraseña nueva.
- La cáscara traducida: navegación de escritorio y móvil, panel principal y las siete secciones.
- Los dos correos (confirmación y recuperación) en el idioma del socio, con su idioma guardado en la fila del socio al registrarse.
- Fechas, horas y números en el formato de cada idioma, respetando la zona horaria del club.
- El atributo de idioma del documento, que hoy es siempre `es`, siguiendo al idioma activo.
- Un test que impida que se cuele un texto sin traducir.

**Explícitamente fuera (por ahora):**

- Un tercer idioma. La infraestructura no debe estorbarlo, pero no se añade ninguno.
- Traducir lo que escriben los socios: nombres, justificaciones, noticias o notas de eventos se guardan tal cual.
- Direcciones distintas por idioma (`/en/...`, `/es/...`). La cookie decide, y la dirección no cambia.
- Traducir los correos que manda Supabase Auth por su cuenta, si alguno queda fuera de las plantillas del repositorio.
- Cambiar el idioma en el que se escriben los documentos del repositorio, los tickets o los comentarios del código, que siguen en español.
- Que el idioma viaje con la cuenta entre dispositivos para la interfaz. La cookie es por equipo; en la fila del socio solo se guarda para los correos.

## 5. Requerimientos funcionales

### RF-1 · Catálogo de mensajes · Must

Todo texto visible sale de un catálogo por idioma, no del componente que lo pinta.

- **Dado** los catálogos de inglés y español, **cuando** se comparan, **entonces** tienen exactamente las mismas claves, y un test falla si a uno le falta alguna.
- **Dado** una clave, **cuando** se pide en el idioma activo, **entonces** devuelve el texto de ese idioma.
- **Dado** un componente que se pinta en el servidor y otro que se pinta en el navegador, **cuando** piden la misma clave, **entonces** ambos obtienen el mismo texto.
- **Dado** un texto con un dato dentro (un correo, una cantidad de minutos), **cuando** se traduce, **entonces** el dato se inserta sin romper la frase en ninguno de los dos idiomas.

### RF-2 · Elegir el idioma de cada visita · Must

- **Dado** una visita con la cookie de idioma puesta en español, **cuando** se pide cualquier pantalla, **entonces** llega en español.
- **Dado** una visita sin esa cookie y con el navegador pidiendo español, **cuando** se pide una pantalla, **entonces** llega en español.
- **Dado** una visita sin cookie y sin ninguna pista, o con un idioma que la aplicación no habla, **cuando** se pide una pantalla, **entonces** llega en inglés.
- **Dado** el documento servido, **cuando** se lee su atributo de idioma, **entonces** coincide con el idioma en que está escrito.
- **Dado** la primera carga, **cuando** se pinta, **entonces** no se ve un idioma y luego otro: el idioma se decide en el servidor, antes de pintar.

### RF-3 · Cambiar de idioma · Must

- **Dado** una persona viendo la aplicación en inglés, **cuando** usa el interruptor de idioma, **entonces** la pantalla pasa a español sin perder dónde estaba.
- **Dado** ese cambio, **cuando** vuelve más tarde, **entonces** sigue en el idioma que eligió.
- **Dado** el interruptor, **cuando** se mira, **entonces** está junto al del tema y dice a qué idioma lleva.
- **Dado** un socio con la sesión abierta, **cuando** está en cualquier pantalla de dentro de la aplicación, **entonces** tiene el interruptor a mano sin cerrar sesión ni volver al registro. Vive en los dos sitios donde ya vive el del tema: el encabezado de las pantallas de autenticación (`src/app/(auth)/layout.tsx`) y la cáscara de la aplicación (`src/components/AppShell.tsx`).
- **Dado** ese cambio hecho desde dentro, **cuando** la persona sigue navegando, **entonces** todas las pantallas siguientes salen en el idioma nuevo, incluidos los textos que arma el servidor.
- **Dado** alguien que navega con el teclado, **cuando** llega al interruptor, **entonces** lo puede usar y sabe en qué idioma está.

### RF-4 · Las pantallas de autenticación · Must

- **Dado** cualquiera de las pantallas de entrar, registro, completar registro, consentimiento del tutor, recuperar contraseña y contraseña nueva, **cuando** se pide en inglés, **entonces** todo su texto está en inglés, incluidos los mensajes de error de validación.
- **Dado** esas mismas pantallas, **cuando** se piden en español, **entonces** dicen lo mismo que hoy.
- **Dado** la lista de países del registro, **cuando** se muestra, **entonces** los nombres salen en el idioma activo y siguen ordenados alfabéticamente en ese idioma.

### RF-5 · La cáscara y las secciones · Must

- **Dado** la navegación de escritorio y la barra móvil, **cuando** se piden en inglés, **entonces** sus etiquetas están en inglés.
- **Dado** la barra móvil a 360 píxeles, **cuando** se pinta en cualquiera de los dos idiomas, **entonces** ninguna etiqueta se parte en dos líneas y cada pestaña conserva su objetivo táctil de 44 píxeles.
- **Dado** las siete secciones y el panel principal, **cuando** se piden en un idioma, **entonces** sus títulos y textos de marcador de posición están en ese idioma.

### RF-6 · Los correos en el idioma del socio · Must

- **Dado** alguien que se registra con la aplicación en inglés, **cuando** recibe el correo de confirmación, **entonces** llega en inglés, asunto incluido.
- **Dado** ese mismo socio, **cuando** pide recuperar su contraseña, **entonces** ese correo también llega en inglés.
- **Dado** un socio registrado antes de esta épica, **cuando** recibe un correo, **entonces** llega en español, que es el idioma con el que se registró.
- **Dado** el idioma guardado, **cuando** se mira en la base, **entonces** es uno de los dos que la aplicación habla, y la base rechaza cualquier otro.

### RF-7 · Fechas, horas y números · Should

- **Dado** una fecha mostrada a alguien en inglés, **cuando** se pinta, **entonces** usa el formato de esa lengua.
- **Dado** esa misma fecha en español, **cuando** se pinta, **entonces** usa el formato español.
- **Dado** cualquiera de los dos, **cuando** la fecha representa un momento del club, **entonces** se muestra en la zona horaria de Melbourne, como hasta ahora.

### RF-8 · Nada se queda sin traducir · Must

- **Dado** el código de la interfaz, **cuando** corre el test que lo vigila, **entonces** falla si un texto visible está escrito dentro de un componente en vez de venir del catálogo.
- **Dado** una clave que solo existe en un idioma, **cuando** corre ese test, **entonces** falla nombrando la clave que falta.

## 6. Casos borde y estados de error

- **Cookie con un valor raro:** se ignora y se decide como si no existiera.
- **Navegador que pide varios idiomas:** se toma el primero que la aplicación hable; si no habla ninguno, inglés.
- **Traducción más larga que el espacio:** las etiquetas de la barra móvil tienen test de ancho a 360 píxeles en los dos idiomas. Si una no cabe, se acorta la etiqueta, no se achica la letra.
- **Cambio de idioma a mitad de un formulario:** lo escrito no se pierde.
- **Correo de un socio sin idioma guardado:** sale en español, que es lo que había.
- **Textos que vienen del servidor:** los mensajes de error de la API se traducen en la pantalla a partir de su código, no traduciendo la frase que llega.
- **Capturas y tests actuales:** hoy buscan textos en español. Cambian al idioma por defecto dentro de los tickets que traducen cada pantalla, y las líneas base visuales se aceptan de nuevo.
- **Contenido que escriben las personas:** no se traduce nunca, ni con la interfaz en el otro idioma.

## 7. UX / UI

- Mockups: sin mockup. Revisión heurística contra `design-system.md`.
- El interruptor de idioma vive junto al del tema, en la misma esquina y con el mismo tamaño de objetivo táctil.
- Pantallas a verificar: entrar, registro, completar registro, recuperar contraseña, panel principal y una sección con la barra móvil.
- Viewports: 375 / 768 / 1440 (y 360 para el ancho de las pestañas), en tema claro y oscuro, en los dos idiomas.

## 8. Requerimientos no funcionales

- Rendimiento: el idioma se decide en el servidor, sin parpadeo ni segunda carga.
- Accesibilidad: el atributo de idioma del documento acompaña al texto, para que un lector de pantalla lo pronuncie bien. Sin violaciones de axe en ninguno de los dos idiomas.
- Dependencias: se prefiere una solución propia y pequeña, apoyada en lo que ya trae el navegador para fechas, números y nombres de países. Una librería de traducción solo se acepta con la justificación de una línea que pide CLAUDE.md.
- Compatibilidad: ninguna dirección de la aplicación cambia, así que los enlaces que ya circulan siguen funcionando.

## 9. Preguntas abiertas

Ninguna. Las tres decisiones que faltaban las tomó el dueño el 16 de septiembre de 2026: la épica entra antes de E3, el idioma por defecto sale del navegador con inglés de respaldo, y la preferencia se guarda en el equipo (por cookie, porque el servidor necesita leerla) mientras que en la fila del socio solo se guarda el idioma de sus correos.

## 10. Descomposición en tickets (para write-ticket)

| #   | Título propuesto                                                                 | Tamaño | Depende de | Auto-merge sugerido                                                  |
| --- | -------------------------------------------------------------------------------- | ------ | ---------- | -------------------------------------------------------------------- |
| 1   | Da a la aplicación un catálogo de mensajes por idioma y la función que lo lee    | M      | ninguna    | No: es la base de todo el texto que ve la gente                      |
| 2   | Decide el idioma de cada visita con la cookie, el navegador e inglés de respaldo | M      | 1          | No: toca cada petición y el atributo de idioma del documento         |
| 3   | Pon un interruptor de idioma junto al del tema, que recuerde la elección         | S      | 2          | No: pantalla nueva, lleva revisión visual                            |
| 4   | Traduce las pantallas de autenticación, con sus mensajes de validación           | M      | 1          | No: cambia lo que lee quien se registra                              |
| 5   | Traduce la cáscara y las siete secciones, sin que las pestañas se partan a 360px | M      | 1          | No: cambia la interfaz de toda la aplicación                         |
| 6   | Guarda el idioma del socio y manda los correos del club en ese idioma            | M      | 2          | No: migración y correos reales                                       |
| 7   | Muestra fechas, horas y números en el formato de cada idioma                     | S      | 1          | No: cambia datos visibles en varias pantallas                        |
| 8   | Impide que se cuele un texto sin traducir, con un test que lo vigile             | S      | 4, 5       | Sí: solo tests, y su valor es fallar cuando alguien olvide una clave |
