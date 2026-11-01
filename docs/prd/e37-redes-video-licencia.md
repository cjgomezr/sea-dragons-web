# PRD: Redes del club, vídeo de la sesión y nombre del registro

**Estado:** borrador · **Fecha:** 2 de noviembre de 2026 · **Autor:** Camilo
(cjgomezr), redactado con Claude

Tres mejoras pequeñas que pidió el dueño en la misma conversación. Van en un
solo PRD y una sola épica (E37) porque cada una es de uno o dos tickets.

## 1. Problema

- **Redes sociales.** El club publica en Instagram, TikTok, YouTube y
  Facebook, pero la app no dice dónde. Quien llega a la pantalla de entrada,
  socio o no, no tiene forma de encontrarlas desde aquí.
- **Vídeo de la sesión.** El club graba cada entrenamiento y lo sube a
  YouTube como vídeo público. Hoy el enlace circula por fuera (chat, correo) y
  encontrar el de una sesión concreta cuesta. La app ya tiene la sesión en el
  calendario: es el sitio natural para colgarlo.
- **Nombre del registro.** La app pide, verifica y avisa de la caducidad del
  "AUF", el registro federativo del rugby subacuático en Australia. La palabra
  "AUF" está escrita a fuego en unos 45 textos por idioma. Un club de otro
  deporte vería "AUF" en su directorio, su ficha y sus avisos, y el producto
  quiere servir a cualquier deporte (como ya hizo E34 con las posiciones).

## 2. Usuarios y contexto

- **Admin:** configura el club en `/club`. Pone las redes y el nombre del
  registro. Escritorio o móvil.
- **Coach, Committee y Admin:** después de cada entrenamiento suben el vídeo
  a YouTube y pegan el enlace en la sesión. Casi siempre desde el móvil.
- **Socio (cualquier rol):** busca el vídeo de una sesión a la que fue, o mira
  las redes del club. Sobre todo en el móvil.
- **Visitante sin cuenta:** solo ve la pantalla de entrada. Ahí ve las redes.
- **Hoy lo resuelven así:** las redes, buscándolas fuera de la app; el vídeo,
  buscando el enlace en el chat del equipo; el registro, no aplica (solo hay
  un club y es de rugby subacuático).

## 3. Objetivo y métricas de éxito

- Objetivo: que lo que el club ya publica fuera (redes y vídeos) se encuentre
  desde la app, y que la app deje de suponer que el registro se llama AUF.
- Métricas:
  - Desde la pantalla del evento, el vídeo está a un toque (el botón abre
    YouTube).
  - El 100 % de las sesiones con vídeo lo enseñan en su pantalla y en su fila
    del calendario.
  - Ningún texto de la interfaz dice "AUF" cuando el club configuró otro
    nombre (lo comprueba un test que recorre los catálogos).

## 4. Alcance

**Incluido (v1):**

- Una sección **Redes** en la configuración del club, solo para el Admin, con
  un enlace opcional por red de una lista fija.
- Las redes que estén puestas, como iconos, en la pantalla de entrada y al
  final de la hoja "More" del móvil y de la barra lateral de escritorio.
- Un enlace de YouTube opcional en cada sesión del calendario, que ponen,
  cambian o quitan Coach, Committee y Admin.
- El enlace en la pantalla del evento y un indicador en su fila del
  calendario.
- Un aviso en la campana a la audiencia del evento cuando se pone el vídeo.
- Un campo **Nombre del registro** en la sección General de `/club`. Todos los
  textos que hoy dicen "AUF" usan ese nombre.

**Explícitamente fuera (por ahora):**

- Incrustar el vídeo en la app (reproductor de YouTube dentro de la página).
- Subir ficheros de vídeo a la app.
- Más de un vídeo por sesión.
- Redes fuera de la lista fija, o un orden que elija el Admin.
- Renombrar las columnas `auf_*`, las rutas y el código a un nombre neutral.
  Es invisible para el usuario y caro; se hará aparte si hace falta.
- Que un club diga que no usa registro y se escondan todas sus pantallas.
- Varios registros o documentos por socio (seguro, certificado médico).
- Un nombre del registro distinto por idioma.

## 5. Requerimientos funcionales

### RF-1 · El Admin guarda las redes del club · Must

En `/club?tab=social` hay una sección **Redes** ("Social links") con un campo
por red: Instagram, TikTok, YouTube, Facebook, WhatsApp y Web del club, en ese
orden.

- **Dado** el Admin en Redes, **cuando** pega
  `https://www.instagram.com/victoriaseadragons` en Instagram y guarda,
  **entonces** se guarda y la sección lo enseña al volver.
- **Dado** un enlace de Instagram cuyo dominio no es `instagram.com`,
  **cuando** guarda, **entonces** no se guarda y el campo dice "Paste a link
  to instagram.com." (cada red con su dominio, ver D3).
- **Dado** un enlace que no empieza por `https://`, **cuando** guarda,
  **entonces** no se guarda y el campo pide un enlace que empiece por
  `https://`.
- **Dado** un campo que el Admin vacía, **cuando** guarda, **entonces** esa
  red se borra y deja de verse en todas partes.
- **Dado** un Committee, Coach o Player, **cuando** abre `/club` o llama a la
  API de escritura, **entonces** no ve la sección y la API responde 403.
- **Dado** los cambios sin guardar, **cuando** el Admin sale de la sección,
  **entonces** se comporta como las demás secciones con borrador (barra de
  cambios sin guardar, #719).

### RF-2 · Las redes se ven en la entrada · Must

- **Dado** un club con Instagram y YouTube puestos, **cuando** cualquiera
  abre `/entrar` (o registro, o recuperar contraseña), **entonces** ve esos
  dos iconos y ningún otro.
- **Dado** un club sin ninguna red, **cuando** se abre la entrada,
  **entonces** no se pinta nada: ni iconos ni hueco ni título.
- **Dado** escritorio y tableta (768 px o más), **cuando** se pinta la
  entrada, **entonces** los iconos van en el panel de marca, junto al pie
  "© 2026 {club}".
- **Dado** el móvil (menos de 768 px, donde el panel de marca se encoge a
  cabecera), **cuando** se pinta la entrada, **entonces** los iconos van al
  final de la página, debajo del formulario, como pie.
- **Dado** un icono, **cuando** se pulsa, **entonces** abre el enlace en una
  pestaña nueva (`target="_blank"`, `rel="noopener noreferrer"`).
- **Dado** un lector de pantalla, **cuando** llega a un icono, **entonces**
  oye "{red} de {club}" (por ejemplo "Instagram de Victoria Seadragons"), y
  el grupo lleva una etiqueta ("Redes del club").

### RF-3 · Las redes se ven dentro de la app · Should

- **Dado** un socio con la sesión abierta en el móvil y un club con redes,
  **cuando** abre la hoja "More", **entonces** ve los iconos al final, debajo
  de las entradas de navegación.
- **Dado** escritorio, **cuando** se pinta la barra lateral, **entonces** los
  iconos van al pie de la barra lateral.
- **Dado** un club sin redes, **cuando** se pinta la app, **entonces** no
  aparece nada.

### RF-4 · El vídeo de la sesión · Must

Cada sesión del calendario (una fila de `events`, también cada sesión de una
serie) puede llevar un enlace de YouTube.

- **Dado** un Coach, Committee o Admin en la pantalla de un evento sin vídeo,
  **cuando** pulsa **Add video** ("Añadir vídeo"), pega
  `https://youtu.be/abc123` y guarda, **entonces** el vídeo queda en la
  sesión.
- **Dado** un enlace que no es de YouTube (ver D7), **cuando** guarda,
  **entonces** no se guarda y dice "Paste a YouTube link.".
- **Dado** una sesión con vídeo, **cuando** cualquiera que ve el evento abre
  su pantalla, **entonces** ve un botón **Watch session video** ("Ver el
  vídeo de la sesión") que abre YouTube en una pestaña nueva.
- **Dado** una sesión con vídeo, **cuando** Coach, Committee o Admin la abre,
  **entonces** puede cambiar el enlace o quitarlo, con confirmación al
  quitar.
- **Dado** un Player, **cuando** abre la pantalla, **entonces** no ve Add
  video ni las acciones de cambiar o quitar, y la API le responde 403.
- **Dado** una sesión de una serie, **cuando** se le pone vídeo, **entonces**
  solo esa sesión lo lleva; las demás de la serie no cambian.
- **Dado** un evento cancelado, **cuando** se intenta poner vídeo, **entonces**
  la pantalla no ofrece Add video y la API responde 409. Si ya tenía vídeo
  antes de cancelarse, se sigue viendo.

### RF-5 · El vídeo se encuentra desde el calendario · Should

- **Dado** una sesión con vídeo, **cuando** se pinta su fila en el
  calendario (próximos y pasados), **entonces** lleva un icono de vídeo con
  nombre accesible ("Has a video").
- **Dado** la lista de pasados del calendario, **cuando** el socio la
  recorre, **entonces** distingue de un vistazo qué sesiones tienen vídeo.

### RF-6 · Aviso en la campana al poner el vídeo · Must

- **Dado** una sesión sin vídeo, **cuando** alguien le pone uno, **entonces**
  cada socio de la audiencia del evento recibe un aviso "Video of {title} is
  up" ("Ya está el vídeo de {title}") que lleva a la pantalla del evento.
- **Dado** quien puso el vídeo, **cuando** se reparte el aviso, **entonces**
  no se lo manda a sí mismo (como los demás avisos de eventos).
- **Dado** una sesión que ya tenía vídeo, **cuando** se cambia el enlace,
  **entonces** no hay aviso nuevo.
- **Dado** una sesión a la que se le quitó el vídeo, **cuando** se le pone
  otro, **entonces** sí avisa, porque vuelve de vacío a con vídeo.
- **Dado** que repartir el aviso falla, **cuando** ocurre, **entonces** el
  vídeo queda guardado igual y el fallo va al log (como
  `notifyEventAudience`).

### RF-7 · El nombre del registro es del club · Must

- **Dado** el Admin en `/club?tab=general`, **cuando** escribe "AUF" en
  **Registration name** ("Nombre del registro") y guarda, **entonces** la app
  lo usa en todos los textos del registro.
- **Dado** el club de hoy, **cuando** se aplica la migración, **entonces** su
  nombre del registro es "AUF" y la app se ve exactamente igual que antes.
- **Dado** un club sin nombre puesto, **cuando** se pinta un texto del
  registro, **entonces** usa la palabra del catálogo: "Registration" en
  inglés y "Registro" en español.
- **Dado** un nombre de más de 16 caracteres, **cuando** guarda,
  **entonces** no se guarda y el campo explica el límite. El campo enseña el
  contador ("12/16") mientras se escribe.
- **Dado** un nombre de 16 caracteres anchos ("WWWWWWWWWWWWWWWW"), **cuando**
  se pintan a 375 px las marcas del directorio, sus filtros, el resumen, el
  chip del perfil y la ficha, **entonces** nada desborda ni se sale de su
  caja: el texto se parte o se recorta con "…" como cualquier otro texto
  largo de esa pantalla.
- **Dado** el campo vacío, **cuando** guarda, **entonces** el club vuelve a la
  palabra del catálogo (D12).
- **Dado** el nombre "Licencia FEDAS", **cuando** se pintan el perfil, la
  ficha, el alta de un socio, el directorio, sus filtros, sus avisos, el
  resumen del directorio y el CSV, **entonces** todos dicen "Licencia FEDAS"
  donde hoy dicen "AUF", con frases correctas en los dos idiomas (ver D13).
- **Dado** un Committee, Coach o Player, **cuando** intenta cambiarlo,
  **entonces** la API responde 403.

## 6. Casos borde y estados de error

- **Redes, estado vacío:** sin ninguna red no se pinta nada en ninguna
  pantalla. Es lo que ve hoy el club hasta que el Admin las ponga.
- **Redes, límites:** cada enlace como mucho 300 caracteres. Se recorta antes
  de validar. Mayúsculas en el dominio valen (`Instagram.com`).
- **Redes, subdominios:** `www.`, `m.` y `vm.` (TikTok) valen; un dominio que
  solo contiene el nombre (`instagram.com.evil.example`) no.
- **Redes, sin sesión:** la entrada las lee como `anon`, igual que la marca y
  los textos de entrada (`0022`, `0028`). Escribir es solo de la llave de
  servicio, por el servidor.
- **Vídeo, enlaces de YouTube válidos:** `youtube.com/watch?v=…`,
  `youtu.be/…`, `youtube.com/live/…` y `youtube.com/shorts/…`, con o sin
  `www.` o `m.`. Una lista de reproducción o un canal no son el vídeo de una
  sesión: no valen.
- **Vídeo, límite:** 300 caracteres.
- **Vídeo, concurrencia:** dos personas ponen vídeo casi a la vez. Gana la
  última escritura y avisa solo la que pasó de vacío a con vídeo, así que
  como mucho hay un aviso. La comprobación de "estaba vacío" se hace en la
  misma sentencia que escribe (`update … where video_url is null` o
  equivalente), no leyendo antes.
- **Vídeo, evento borrado o de otro club:** 404.
- **Vídeo, evento que se edita después:** cambiar fecha, lugar o notas no
  toca el vídeo. Partir una serie (`0073`) conserva el vídeo de cada sesión
  que ya lo tenía.
- **Vídeo, red caída al guardar:** el formulario sigue abierto con el enlace
  y dice "We couldn't save the video. Try again.".
- **Registro, textos con género:** "Licencia" es femenino y "AUF" se usa en
  masculino. Ver D13.
- **Registro, la palabra por defecto repetida:** con el nombre por defecto,
  "Registro {registration}" diría "Registro Registro". Ver D13.
- **WhatsApp, enlace de grupo:** un enlace `chat.whatsapp.com/…` en la
  entrada deja entrar al grupo a cualquiera que la abra, también a bots. No
  se acepta (D3).
- **Registro, texto del socio:** el nombre lo escribe el Admin; se pinta como
  texto de React (escapado), nunca como HTML.
- **Registro, CSV:** las cabeceras de columna usan el nombre del club. El
  orden y el número de columnas no cambian.

## 7. UX / UI

- Mockups: no hay de estas tres cosas.
  - Redes en la entrada: parte de `docs/mockups/auth-light.png` y
    `auth-dark.png` (panel de marca y su pie).
  - Hoja "More": parte de `docs/mockups/mobile-directory-admin-more-menu-email-export-dark.png`.
  - Pantalla del evento: parte de `docs/mockups/mobile-calendar-redesign-event-dark.png`
    y `calendar-redesign-agenda-dark.png`.
  - Configuración del club: las secciones de E26 (`docs/prd/e26-rediseno-configuracion-club.md`).
  - Lo que no está dibujado se revisa contra `design-system.md`.
- Iconos: los de marca de Phosphor (`InstagramLogo`, `TiktokLogo`,
  `YoutubeLogo`, `FacebookLogo`) y `Globe` para la web. Ya están en
  `node_modules`; no hay dependencia nueva.
- Flujo del vídeo (móvil): el coach abre la sesión desde el calendario →
  **Add video** → pega el enlace → **Save** → aparece **Watch session video**
  y la audiencia recibe el aviso.
- Viewports: 375 / 768 / 1440, claro y oscuro.

## 8. Requerimientos no funcionales

- Accesibilidad: axe sin violaciones en cada pantalla tocada. Los iconos son
  enlaces con nombre propio, no imágenes sueltas.
- Seguridad:
  - Las redes son públicas a propósito (`anon` las lee). No son datos de
    ninguna persona.
  - El vídeo se guarda solo como enlace. La app no comprueba si el vídeo de
    YouTube es público o privado.
  - Escribir el vídeo es de Coach, Committee y Admin del club del evento. Hoy
    el Coach no gestiona eventos: esta ruta no le da ningún otro permiso
    sobre ellos.
- Rendimiento: la entrada ya lee la marca del club en una consulta; las redes
  van en la misma lectura o en una más en paralelo, sin bloquear el
  formulario.

## 9. Decisiones

- **D1. Lista fija de redes:** Instagram, TikTok, YouTube, Facebook, WhatsApp
  y Web del club. Se amplía con un ticket cuando un club pida otra.
- **D2. Tabla propia:** `club_social_links (club_id, network, url)`, una fila
  por red puesta, `check` sobre `network`. Lectura pública como
  `club_sign_in_texts` (`0028`); escritura por la llave de servicio.
- **D3. Dominio por red:** Instagram `instagram.com`; TikTok `tiktok.com`;
  YouTube `youtube.com` o `youtu.be`; Facebook `facebook.com` o `fb.com`;
  WhatsApp `wa.me/<número>` (chat con el número del club) o
  `whatsapp.com/channel/…` (canal de difusión), nunca un enlace de grupo
  `chat.whatsapp.com`; Web cualquier dominio. Siempre `https://`. El campo de
  WhatsApp avisa debajo de que el número queda a la vista de cualquiera que
  abra la entrada.
- **D4. Dónde se ven:** entrada (RF-2) y, dentro de la app, al final de "More"
  y de la barra lateral (RF-3).
- **D5. El vídeo es una columna de `events`:** `video_url text null`. Cada
  sesión de una serie ya es su propia fila, así que cada una lleva el suyo.
- **D6. Cualquier tipo de evento:** el pedido habla de entrenamientos, pero un
  partido grabado sirve igual. Limitarlo a `training` sería más código sin
  ganar nada.
- **D7. Solo YouTube, solo enlace:** los vídeos del club ya están en YouTube y
  son públicos. No se incrusta: un botón que abre YouTube basta y no obliga a
  tocar la política de contenido de la página.
- **D8. Ruta propia para el vídeo:** `PUT` y `DELETE /api/v1/events/{id}/video`,
  para Admin, Committee y Coach. No pasa por `/events/manage`, que es solo de
  Admin y Committee.
- **D9. A quién avisa:** a la audiencia del evento, como los avisos de crear y
  cambiar (`notifyEventAudience`). Tipo nuevo `event_video_added` en
  `NOTIFICATION_TYPES` y en el `check` de `notifications.type`.
- **D10. Solo el primer vídeo avisa** (de vacío a con vídeo). Cambiar el enlace
  no avisa: es casi siempre corregir un error.
- **D11. Nombre del registro en `clubs`:** `registration_name text null`,
  entre 1 y 16 caracteres recortado (`check` en la base y la misma
  validación en el servidor). 16 caben en los chips y filtros del móvil y
  dejan sitio para "Licencia FEDAS" (14). La migración pone "AUF" al club que
  ya existe.
- **D12. El nombre del club sustituye a la palabra por defecto:** nulo es "la
  de la app" ("Registration" / "Registro"), como los textos de entrada. Si el
  club pone un nombre, ese nombre ocupa exactamente el sitio de la palabra
  por defecto en cada texto, sin más cambios. Guardar el campo vacío lo deja
  nulo.
- **D13. Frases que no dependen del género:** el nombre siempre va como
  complemento de un sustantivo del catálogo, nunca solo con un artículo o un
  adjetivo que concuerde, y nunca detrás de la palabra "Registro" /
  "Registration", que con el nombre por defecto se repetiría. El título
  "Registro AUF" pasa a ser solo "{registration}"; "Número AUF" pasa a
  "Número de {registration}". Cada texto de hoy con "AUF" se reescribe en los
  dos idiomas y un test lo pinta con tres nombres ("AUF", el de por defecto y
  "Licencia FEDAS") para comprobar que ninguno repite palabra ni deja "AUF"
  escrito. El nombre llega a los textos como un parámetro `{registration}`
  que el traductor rellena con el del club, para no pasarlo a mano en cada
  llamada.
- **D14. El código sigue diciendo `auf`:** columnas `auf_number`,
  `auf_expiry`, `auf_verified_at`, rutas y claves del catálogo no cambian
  (fuera de alcance).

## 10. Preguntas abiertas

- [x] Redes de la lista: se añade WhatsApp (dueño, 2 nov). Solo número o
      canal, nunca grupo (D3).
- [x] Palabra por defecto: "Registro" / "Registration" (dueño, 2 nov).

## 11. Descomposición en tickets (para write-ticket)

Épica nueva **E37 · Redes del club, vídeo de la sesión y nombre del
registro**, con los cinco tickets como sub-issues. Las migraciones toman el
siguiente número libre al implementarse (hoy `0091`).

| #   | Título propuesto                                                                                       | Tamaño | Depende de | Auto-merge sugerido                                         |
| --- | ------------------------------------------------------------------------------------------------------ | ------ | ---------- | ----------------------------------------------------------- |
| 1   | Guarda las redes del club en una sección Redes de la configuración, solo para el Admin (RF-1)          | M      | ninguna    | No: tabla nueva con lectura pública y permisos de escritura |
| 2   | Enseña las redes del club en la entrada y al final de "More" y de la barra lateral (RF-2, RF-3)        | S      | 1          | No: superficie pública nueva, conviene mirarla              |
| 3   | Añade el enlace de YouTube de cada sesión en la pantalla del evento y un icono en su fila (RF-4, RF-5) | M      | ninguna    | No: permiso nuevo para el Coach sobre los eventos           |
| 4   | Avisa en la campana a la audiencia cuando se pone el vídeo de una sesión (RF-6)                        | S      | 3          | No: tipo de aviso nuevo y lógica de concurrencia            |
| 5   | Deja que el Admin ponga el nombre del registro y úsalo en todos los textos que hoy dicen AUF (RF-7)    | M      | ninguna    | No: reescribe unos 45 textos por idioma y muchas capturas   |

Los tickets 1, 3 y 5 no dependen entre sí y pueden ir en paralelo. Ojo: los
tres tocan `/club` o el calendario y sus capturas, y dos fábricas a la vez en
esta máquina no se recomiendan. Mejor de uno en uno.
