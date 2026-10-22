# PRD: E33 · El rediseño del correo y de la invitación del Directorio

**Estado:** aprobado · **Fecha:** 23 de octubre de 2026 · **Autor:** sesión de planificación (Claude Code)

Fuente: los dos diseños que el dueño hizo con Claude Design, guardados en `docs/design/design_handoff_email/` y `docs/design/design_handoff_invite/`. Cada carpeta trae el lienzo con todos los estados (`*Upgrade.dc.html`), el componente interactivo (`Email Composer.dc.html`, `Invite Form.dc.html`), su `README.md` de handoff, `support.js` y las capturas en `screenshots/`. Es una épica añadida después del plan. Rehace dos flujos del Directorio de E19:

- el redactor "Email members" (`DirectoryEmailComposer`, `DirectoryEmailConfirmDialog`, `directory-email-client.ts`), que E32 también abre desde Grupos;
- el alta de un socio por un Admin (`NewMemberScreen`, `NewMemberForm`, `new-member-client.ts`, `member-invitation.ts`), hoy una página aparte en `/directorio/nuevo`.

Los dos `README.md` son parte de este PRD: tienen las medidas, los colores, los textos y cada estado. Cuando no coinciden con lo que dice aquí, manda este PRD. Cuando una captura y el texto de su handoff no coinciden, manda el texto.

Las decisiones van de D1 a D17. Salen de los handoffs, del código actual y de cuatro respuestas del dueño del 23 de octubre (D1, D3, D12 y D15). El dueño las ratifica al aprobar este PRD.

- **D1.** **Una sola épica para los dos rediseños** (decisión del dueño). Comparten el patrón (un panel bajo la cabecera del Directorio, a pantalla completa en el móvil), los tokens y la pantalla.
- **D2.** **Quién usa cada flujo no cambia.** El correo: Admin y Committee (`canEmailFromDirectory`). El alta: solo Admin. El servidor lo vuelve a comprobar como hoy.

**El correo**

- **D3.** **El mensaje admite formato básico** (decisión del dueño): negrita, cursiva, enlaces y listas con viñetas o numeradas. Nada más: ni imágenes, ni tablas, ni títulos, ni código, ni HTML escrito a mano. Cambia FR-093 del SRD, que decía texto plano; ver D16.
- **D4.** **Sin dependencias nuevas.** El handoff sugiere `marked` y `sanitize-html`. Aquí se lee el Markdown con lo que Noticias ya usa (`unified` + `remark-parse` + `remark-breaks`, en `news-markdown.ts`), y el HTML se escribe a mano desde el árbol mdast con una lista cerrada de nodos. Así nada que no esté en la lista llega al correo, y no hace falta sanear después.
- **D5.** **Un solo módulo decide qué formato existe**, `src/lib/directory/directory-email-markdown.ts`, puro y sin Supabase. Convierte el mensaje en un árbol restringido (párrafo, salto de línea, negrita, cursiva, enlace, lista, elemento de lista, texto). El servidor lo pinta como HTML de correo y como texto plano, y la vista previa del redactor lo pinta con React. Lo que se ve en la vista previa es lo que llega.
  - Cualquier nodo fuera de la lista se convierte en su texto: un `# título` sale como el texto "título", una imagen como su texto alternativo, y el HTML se escapa.
  - Solo `http://`, `https://` y `mailto:` son enlaces. Cualquier otro destino se queda como texto plano.
  - El texto plano quita las marcas y escribe los enlaces como "texto (url)".
  - Un mensaje antiguo sin marcas sale igual que hoy: los párrafos por línea en blanco y los saltos de línea simples se mantienen.
- **D6.** **El límite de 5.000 caracteres se cuenta sobre el Markdown tal cual**, en `checkDirectoryEmailDraft`, igual en la pantalla y en el servidor. El asunto sigue siendo texto (150 caracteres).
- **D7.** **El HTML del correo usa estilos en línea** dentro de la plantilla que ya existe (`renderHtml` de `email-templates.ts`): cuerpo a 15 px, enlaces en el color de acento del club, listas con su sangría. Gmail y Outlook ignoran las hojas de estilo.
- **D8.** **Añadir destinatarios por nombre no necesita endpoint nuevo.** Desde Grupos no hay lista del Directorio cargada, así que el buscador la pide a `GET /api/v1/directory` la primera vez que recibe el foco y la guarda mientras el redactor siga abierto. Solo ofrece a quien el envío acepta, que hoy son los socios activos, y nunca a quien ya está en la lista. La coincidencia ignora mayúsculas y acentos (NFD sin marcas), y enseña hasta 6.
- **D9.** **El cupo se ve antes de enviar.** El redactor pide el cupo al abrirse (`loadDirectoryEmailQuota`, que ya existe) y lo enseña en el pie. Enviar se desactiva sin destinatarios o con más destinatarios que correos quedan hoy. El servidor lo sigue imponiendo como hoy (`DIRECTORY_EMAIL_QUOTA = 50` en 24 h).
- **D10.** **Plegado de destinatarios:** en escritorio, con más de 11 se ven 10 y una ficha "+N más"; en el móvil se ven 6. "Quitar todos" aparece con 2 o más.

**La invitación**

- **D11.** **El alta se abre como panel bajo la cabecera del Directorio**, con el botón `user-plus` que hoy lleva a otra página. En el móvil ocupa la pantalla. `/directorio/nuevo` redirige a `/directorio?invite=1`, que abre el Directorio con el panel abierto, para que los enlaces viejos sigan sirviendo.
- **D12.** **Solo el nombre y el correo son obligatorios** (decisión del dueño). País, posición, experiencia, género y AUF pasan a "Datos de jugador · opcional", plegado por defecto. Si se envía uno, tiene que ser válido y se mantienen sus códigos `*_unknown`. El AUF va **los dos o ninguno**: un número sin fecha da `auf_expiry_missing` (nuevo) y una fecha sin número da `auf_number_missing`. Se mantienen `auf_number_too_long`, `auf_expiry_not_a_date` y `auf_expiry_before_joined`. La posición deja de ser obligatoria aunque el club ofrezca posiciones (cambia `checkPosition`).
  - No hace falta migración: esas columnas de `members` ya admiten `null`.
  - El socio ya nace `incomplete` y la pantalla de completar registro le pide el país y la fecha de nacimiento antes de activar la cuenta (FR-083). Eso no cambia.
- **D13.** **La franja "Falta" del perfil pide también la posición, la experiencia y el género** (`MISSING_PROFILE_ITEMS`, después del país). La posición solo cuando el club tiene posiciones activas. Son recordatorios, no bloquean nada.
- **D14.** **Si el correo ya es de un socio, el error enlaza a su ficha.** `POST /api/v1/members` añade `existingMember: { userId, fullName }` a la respuesta de `email_taken`. Solo lo ve un Admin, que ya ve a todo el club en el Directorio.
- **D15.** **El selector de país propone "Más comunes en el club"** (decisión del dueño), en un ticket aparte de prioridad baja. Un endpoint nuevo, `GET /api/v1/club/common-countries`, devuelve los 4 países más frecuentes entre los socios del club, o el país del club si no hay datos. Debajo va "Todos los países", la lista de `COUNTRY_CODES` con nombres de `Intl.DisplayNames` en el idioma de la pantalla, ordenada. Sin ese ticket el formulario funciona con la lista completa.

**Común**

- **D16.** **El SRD pasa a la v1.7**, en el mismo PR que este PRD:
  - FR-020: el Admin crea al socio con nombre y correo obligatorios, y el resto de los datos opcionales.
  - AC-011: deja de exigir todos los campos y el AUF completo; el AUF va los dos o ninguno.
  - FR-093: el correo admite formato básico (negrita, cursiva, enlaces y listas) y sale en HTML y en texto.
- **D17.** **Los colores sueltos de los handoffs se vuelven tokens o reutilizan los de E21 a E32** (`--color-segment-selected` para `--seg`, `--color-hover`, el fondo de las barras de las tablas para `--bar`). Ningún hex nuevo en las reglas. Iconos de Phosphor, como el resto.

## 1. Problema

El redactor de correo enseña a cada destinatario como una tarjeta grande con un botón "Remove": con seis personas ocupa media pantalla, y desde Grupos llega con veinte o más. No deja añadir a nadie que no viniera ya en la lista, y el mensaje es texto plano, sin una negrita ni una lista.

El alta de un socio es una página aparte con ocho campos obligatorios. El Admin a menudo no sabe el país, la posición o el AUF de alguien a quien acaba de conocer, así que no puede invitarlo hasta averiguarlo todo. Cuando el correo ya es de un socio, el error no dice de quién.

## 2. Usuarios y contexto

- **Admin y Committee, desde el portátil:** escriben al club, a un grupo o a quien filtraron en el Directorio. A veces desde el móvil, después de un entrenamiento.
- **Admin, en la piscina o desde el móvil:** da de alta a alguien que viene a probar, con el nombre y el correo que le dicta.
- **Hoy lo resuelven así:** para añadir un destinatario cierran el redactor, cambian el filtro y lo vuelven a abrir. Para invitar a alguien sin todos sus datos, inventan valores o lo dejan para otro día.

## 3. Objetivo y métricas de éxito

- **Objetivo:** escribir e invitar sin salir del Directorio, con lo mínimo y sin pantallas que se desborden.
- **Métricas:**
  - Con 25 destinatarios, el bloque de destinatarios no pasa de tres líneas en escritorio: lo prueba la captura `correo-25-destinatarios`.
  - Invitar a alguien cuesta dos campos: lo prueba un test de API que crea un socio solo con nombre y correo.
  - Lo que enseña la vista previa es lo que se envía: un mismo test pasa el mismo mensaje por la vista previa y por el HTML del correo.
  - Nada de E19 se pierde: los tests del correo y del alta siguen pasando, adaptados a la estructura nueva sin quitarles casos.

## 4. Alcance

**Incluido (v1):**

- El redactor: destinatarios en fichas con ×, plegado, "Quitar todos", añadir por nombre con un combobox, barra de formato, Escribir | Vista previa, contadores, cupo en el pie, errores con foco, confirmación con el cupo antes y después, estado Enviado con "Escribir otro", y su versión de móvil.
- El servidor del correo: Markdown básico a HTML y a texto.
- La invitación: panel bajo la cabecera, Quién, grupos en fichas, Datos de jugador plegables, resumen de errores con enlaces, vista previa de la invitación, estados Enviada y No salió con Reenviar, "Invitar a otro" conservando los grupos, y su versión de móvil.
- El servidor del alta: solo nombre y correo obligatorios, AUF los dos o ninguno, `existingMember` en `email_taken`.
- La franja "Falta" del perfil con posición, experiencia y género.
- "Más comunes en el club" en el selector de país (Could).

**Explícitamente fuera (por ahora):**

- Imágenes, adjuntos, títulos o tablas en el correo.
- Guardar borradores del correo o programar el envío.
- Cambiar el cupo diario, la cuenta de Resend o quién puede escribir.
- Invitar a varias personas a la vez (por CSV o por lista).
- Cambiar el contenido del correo de invitación: la vista previa enseña el que ya existe.

## 5. Requerimientos funcionales

### RF-1 · Markdown básico en el correo · Must

El servidor convierte el mensaje en HTML y texto con la lista cerrada de D5.

- **Dado** el mensaje `**Hola** _equipo_\n\n- uno\n- dos`, **cuando** se envía, **entonces** el HTML lleva `<strong>Hola</strong>`, `<em>equipo</em>` y una `<ul>` con dos `<li>`, y el texto plano lleva `Hola equipo` y las dos líneas con guion.
- **Dado** `[web](https://club.org)`, **cuando** se envía, **entonces** el HTML lleva un `<a href="https://club.org">` y el texto plano `web (https://club.org)`.
- **Dado** `[x](javascript:alert(1))`, **cuando** se envía, **entonces** no hay ningún enlace y el texto sale tal cual.
- **Dado** `<b>hola</b>` o `# Título` o `![foto](https://…)`, **cuando** se envía, **entonces** el HTML no lleva ninguna etiqueta escrita por el autor ni ningún `<h1>` ni `<img>`, y sí su texto.
- **Dado** un mensaje antiguo en texto plano con párrafos y saltos de línea, **cuando** se envía, **entonces** el HTML tiene los mismos párrafos y saltos que hoy.
- **Dado** un mensaje de 5.001 caracteres contando las marcas, **cuando** se envía, **entonces** el servidor responde 400 con `too_long`, como hoy.

### RF-2 · Destinatarios compactos · Must

- **Dado** el redactor con 3 destinatarios, **cuando** se pinta, **entonces** cada uno es una ficha de 24 px con sus iniciales, el nombre y un botón × con `aria-label="Quitar a {nombre}"`.
- **Dado** 25 destinatarios en escritorio, **cuando** se pinta, **entonces** se ven 10 fichas y "+15 más"; al pulsarla se ven las 25 y "Ver menos".
- **Dado** 25 destinatarios en el móvil, **cuando** se pinta, **entonces** se ven 6 fichas y "+19 más".
- **Dado** 2 o más destinatarios, **cuando** se pulsa "Quitar todos", **entonces** la lista queda vacía y sale "Todavía no hay a quién escribir. Añade socios por su nombre."
- **Dado** el foco en el campo de búsqueda vacío, **cuando** se pulsa Retroceso, **entonces** se quita la última ficha.

### RF-3 · Añadir destinatarios por nombre · Must

- **Dado** el redactor abierto desde Grupos, **cuando** el campo "Añadir un socio por su nombre" recibe el foco por primera vez, **entonces** pide la lista a `GET /api/v1/directory` una sola vez.
- **Dado** que se escribe "mar", **cuando** hay coincidencias, **entonces** el listbox enseña hasta 6 socios activos que no están ya en la lista, con "Mar" en negrita, sin importar mayúsculas ni acentos ("Marta", "María", "Omar").
- **Dado** el listbox abierto, **cuando** se usan ↑, ↓ y Enter, **entonces** se añade el resaltado, el campo se vacía y el foco sigue en él. Esc vacía la búsqueda.
- **Dado** una búsqueda sin coincidencias, **entonces** sale "Ningún socio coincide con "{q}".". **Dado** que todos los que coinciden ya están, **entonces** sale "Todos los que coinciden con "{q}" ya están en la lista.".
- **Dado** que pedir la lista falla, **cuando** se busca, **entonces** sale un aviso con Reintentar y lo demás del redactor sigue funcionando.

### RF-4 · Barra de formato y vista previa · Must

- **Dado** texto seleccionado, **cuando** se pulsa Negrita (o Ctrl/⌘+B), **entonces** queda entre `**…**` y la selección se conserva. Igual con Cursiva (`_…_`, Ctrl/⌘+I).
- **Dado** nada seleccionado, **cuando** se pulsa Negrita, **entonces** se inserta "texto en negrita" seleccionado.
- **Dado** una selección, **cuando** se pulsa Enlace (Ctrl/⌘+K), **entonces** queda `[selección](https://)` con `https://` seleccionado.
- **Dado** tres líneas seleccionadas, **cuando** se pulsa Lista numerada, **entonces** empiezan por `1. `, `2. `, `3. `; si ya llevaban `- `, se reemplaza en vez de sumar dos marcas.
- **Dado** un mensaje con formato, **cuando** se pasa a Vista previa, **entonces** se ve la cabecera (De {club} · las respuestas te llegan a ti; Para {n} socios · cada uno recibe su copia; el asunto) y el cuerpo con el mismo árbol de D5. Sin mensaje: "Todavía no hay nada que ver."
- **Dado** el contador del mensaje, **cuando** pasa del 90 % y del 100 %, **entonces** cambia de color como dice el handoff.

### RF-5 · Errores, cupo y confirmación · Must

- **Dado** que se pulsa Enviar sin asunto y con 5.240 caracteres, **entonces** cada campo enseña su error con `aria-invalid` y `aria-describedby`, el pie dice "2 cosas por arreglar" y el foco va al asunto. Si la Vista previa estaba abierta, vuelve a Escribir.
- **Dado** 41 correos libres hoy y 45 destinatarios, **entonces** sale el aviso "Solo quedan 41 correos hoy. Quita a 4 personas o envía el resto mañana." y Enviar está desactivado.
- **Dado** un borrador válido, **cuando** se pulsa Enviar, **entonces** el diálogo dice "¿Enviar a 25 socios?" (o "¿Enviar a {nombre}?" con uno), el asunto, y "Correos libres hoy 41 → 16 de 50" con la barra partida. Con menos de 10 después, la nota cambia; a 0, dice que usa los últimos de hoy.
- **Dado** el diálogo, **cuando** se confirma, **entonces** el botón dice "Enviando…" con un indicador, los dos botones se desactivan y el `requestId` evita el envío doble, como hoy.
- **Dado** el envío hecho, **entonces** el cuerpo pasa a "{n} correos enviados" (`role="status"`) con el cupo que queda, "Escribir otro" (vacía asunto y mensaje, conserva los destinatarios) y Cerrar. Los que no llegaron salen como hoy.

### RF-6 · El redactor en el móvil · Must

- **Dado** una pantalla de menos de 768 px, **cuando** se abre el redactor, **entonces** ocupa la pantalla con la barra de arriba (×, título, Enviar), la búsqueda en un campo aparte de 46 px con resultados en línea, el campo del mensaje a 16 px y la barra de formato con botones de 44 px.
- **Dado** el móvil, **cuando** se confirma, **entonces** la confirmación es una hoja inferior con botones de 48 px.

### RF-7 · Alta con solo nombre y correo · Must

- **Dado** un Admin, **cuando** envía solo el nombre y el correo, **entonces** el socio se crea como Player e `incomplete`, sin país, posición, experiencia, género ni AUF, y sale la invitación.
- **Dado** un país, una posición, una experiencia o un género enviados pero inválidos, **entonces** responde 400 con su código `*_unknown`, como hoy.
- **Dado** un número de AUF sin fecha, **entonces** responde 400 con `auf_expiry_missing`; **dado** una fecha sin número, con `auf_number_missing`.
- **Dado** un correo que ya es de un socio, **entonces** responde 409 con `email_taken` y `existingMember: { userId, fullName }`.
- **Dado** un club con posiciones activas, **cuando** no se envía posición, **entonces** el alta sale igual.

### RF-8 · La franja "Falta" pide los datos de jugador · Should

- **Dado** un socio activo sin posición, experiencia ni género, en un club con posiciones, **cuando** abre su perfil, **entonces** la franja los pide después del país.
- **Dado** un club sin posiciones activas, **entonces** la franja no pide la posición.

### RF-9 · El panel "Invitar a un socio" · Must

- **Dado** un Admin en el Directorio, **cuando** pulsa el botón `user-plus`, **entonces** se abre el panel bajo la cabecera; al volver a pulsarlo o con ×, se cierra. Si estaba abierto el redactor de correo, se cierra: solo hay un panel a la vez.
- **Dado** `/directorio/nuevo`, **cuando** se visita, **entonces** redirige a `/directorio?invite=1` con el panel abierto. Un Coach, un Committee o un Player que visiten esa dirección siguen sin poder dar de alta.
- **Dado** el panel, **entonces** enseña Quién (nombre y correo lado a lado en escritorio), Grupos como fichas con `aria-pressed`, y "Datos de jugador · opcional" plegado con "{n} de 6".
- **Dado** que se pulsa Enviar con errores, **entonces** arriba sale "{n} cosas por arreglar antes de enviar" (`role="alert"`, recibe el foco), con un enlace por error que enfoca su campo y abre Datos de jugador si el campo está dentro.
- **Dado** el error `email_taken`, **entonces** el error del correo enlaza a "Abrir la ficha de {nombre}".
- **Dado** "Lo que recibirá {nombre}", **cuando** se abre, **entonces** enseña el correo de invitación con el texto de la plantilla real (`renderMemberInvitationEmail`).
- **Dado** que se está enviando, **entonces** el `fieldset` está desactivado y Enviar dice "Enviando…"; un segundo envío no sale (`isSendingRef`).

### RF-10 · Resultados de la invitación y móvil · Must

- **Dado** un alta con invitación enviada, **entonces** el cuerpo pasa a "Invitación enviada a {correo}" (`role="status"`) y el Directorio recarga su lista, con el socio como Invitado.
- **Dado** `invitation: "not_sent"`, **entonces** sale "{nombre} quedó añadido, pero el correo no salió" (`role="alert"`) con Reenviar invitación (`InvitationResend`); tras reenviar, "Invitación enviada otra vez a {correo}".
- **Dado** cualquiera de los dos estados, **cuando** se pulsa "Invitar a otro", **entonces** el formulario se vacía y conserva los grupos elegidos. "Abrir la ficha de {nombre}" lleva a su ficha.
- **Dado** una pantalla de menos de 768 px, **entonces** el panel ocupa la pantalla, el cuerpo hace scroll dentro de un `div` (no en el `fieldset`) y el pie queda fijo abajo.

### RF-11 · Países más comunes del club · Could

- **Dado** un club con socios de AU, CO, ES, NZ y AR, **cuando** se pide `GET /api/v1/club/common-countries`, **entonces** devuelve los 4 más frecuentes, en ese orden de frecuencia.
- **Dado** un club sin países guardados, **entonces** devuelve el país del club.
- **Dado** el selector de país, **entonces** enseña "Más comunes en el club" primero y "Todos los países" después, con nombres en el idioma de la pantalla y ordenados.
- **Dado** un usuario que no es Admin, **entonces** el endpoint responde 403.

## 6. Casos borde y estados de error

- **Redactor sin destinatarios:** Enviar desactivado y el aviso del estado vacío. Si se abrió desde un filtro vacío, entra igual y se pueden añadir.
- **Cupo desconocido** (falla `loadDirectoryEmailQuota`): el pie dice que no se pudo saber, Enviar se permite y el servidor decide, como hoy.
- **Cupo agotado mientras se escribe:** el servidor responde `directory_email_quota_exceeded` y el redactor enseña el aviso de hoy, con lo que queda.
- **Un destinatario se dio de baja entre abrir y enviar:** el servidor lo rechaza y sale en la lista de "No llegó a:", como hoy.
- **Nombres largos:** la ficha corta con elipsis a 180 px y el nombre entero va en el `aria-label` y en el `title`.
- **Directorio con cientos de socios:** el buscador filtra en el navegador sobre la lista ya pedida; si `GET /api/v1/directory` empieza a paginar algún día, el ticket que lo haga tiene que mover el buscador a la búsqueda del servidor.
- **Markdown roto** (`**sin cerrar`): sale como texto, sin romper el HTML.
- **Enlace muy largo:** el HTML lo deja partirse (`word-break: break-word` en línea).
- **Alta con red caída o 429:** el banner de error del servidor encima de la vista previa, con el texto de hoy.
- **Correo con mayúsculas o espacios:** se normaliza como hoy antes de comprobar si ya existe.
- **Dos Admins invitan el mismo correo a la vez:** el segundo recibe `email_taken` con el socio que creó el primero.
- **Club sin grupos:** la sección Grupos dice que no hay ninguno y enlaza a Grupos.
- **Club sin posiciones activas:** el selector de posición no sale (como hoy).
- **"Invitar a otro" tras un error:** el resumen de errores desaparece y los campos se vacían.

## 7. UX / UI

- Mockups:
  - `docs/design/design_handoff_email/screenshots/01` a `10` (escritorio 1a–1e, móvil 2a–2e).
  - `docs/design/design_handoff_invite/screenshots/01` a `07` (escritorio 1a–1d, móvil 2a–2c), con las reglas recomendadas.
- Flujos:
  - Correo: Directorio o Grupos → Escribir → destinatarios (quitar, añadir) → asunto → mensaje (formato, vista previa) → Enviar → confirmar → Enviado.
  - Invitación: Directorio → `user-plus` → nombre y correo (y grupos o datos si los hay) → Enviar → Enviada o No salió → Invitar a otro o Abrir la ficha.
- Viewports: 375, 768 y 1440, en claro y oscuro.

## 8. Requerimientos no funcionales

- **Accesibilidad:** axe sin violaciones; combobox con `role="combobox"`, `aria-expanded`, `aria-controls` y `aria-autocomplete="list"`; tabs con el patrón de WAI-ARIA; los errores con `aria-invalid` y `aria-describedby`; el foco va al primer error.
- **Seguridad:** el HTML del correo sale solo de la lista cerrada de D5; ningún texto del autor llega sin escapar. Los permisos de los dos flujos se comprueban en el servidor.
- **i18n:** todo texto nuevo en `en.ts` y `es.ts`.
- **Rendimiento:** la lista para el buscador se pide una vez por redactor abierto.

## 9. Preguntas abiertas

Ninguna bloquea. Las cuatro del 23 de octubre quedaron resueltas en D1, D3, D12 y D15.

## 10. Descomposición en tickets (para write-ticket)

| #   | Título propuesto                                                                                                                      | Tamaño | Depende de | Auto-merge sugerido                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------- | --------------------------------------------------------------- |
| 1   | Envía el correo del Directorio con negrita, cursiva, enlaces y listas, en HTML y en texto (RF-1, D3–D7)                               | M      | ninguna    | No: cambia lo que reciben los socios y lo que llega sin escapar |
| 2   | Pone los destinatarios del correo en fichas plegables y deja añadir socios por su nombre (RF-2, RF-3, D8, D10)                        | M      | ninguna    | No: comportamiento nuevo, a quién se escribe                    |
| 3   | Añade al redactor la barra de formato, la vista previa, el cupo y la confirmación con el cupo antes y después (RF-4, RF-5, D9)        | M      | 1, 2       | No: lógica de envío y de cupo                                   |
| 4   | Lleva el redactor de correo al móvil a pantalla completa (RF-6)                                                                       | S      | 3          | Sí: estilos cubiertos por capturas                              |
| 5   | Da de alta a un socio con solo nombre y correo, con el AUF los dos o ninguno y el socio que ya tiene ese correo (RF-7, RF-8, D12–D14) | M      | ninguna    | No: cambia reglas de negocio del alta                           |
| 6   | Abre la invitación de un socio como panel bajo la cabecera del Directorio (RF-9, D11)                                                 | M      | 5          | No: flujo nuevo del alta                                        |
| 7   | Enseña si la invitación salió, deja reenviarla e invitar a otro, y lleva el panel al móvil (RF-10)                                    | S      | 6          | No: reenviar toca el alta                                       |
| 8   | Propone los países más comunes del club al invitar (RF-11, D15)                                                                       | S      | 6          | No: endpoint nuevo                                              |

Los tickets 2, 3, 4, 6 y 7 llevan `ui-review`. El 1 y el 5 son de servidor y pueden ir en paralelo con el 2.

Al aprobar, se añade la fila de E33 a `docs/plan-maestro.md` y el SRD pasa a la v1.7 (D16), en el mismo PR que este documento.
