# PRD: E26 · El rediseño de la configuración del club y del menú de cuenta

**Estado:** borrador · **Fecha:** 17 de octubre de 2026 · **Autor:** sesión de planificación (Claude Code)

Fuente: el diseño que el dueño hizo con Claude Design, guardado en `docs/design/design_handoff_club_settings/` (el prototipo `Club Settings Upgrade.dc.html`, su `README.md` de handoff, `support.js` y diez capturas en `screenshots/`). Se construyen **#1a** en escritorio y **#2a**, **#3a** y **#3b** en móvil, por debajo de 768 px. Las **#2b** y **#2c** (pestañas tipo chip en el móvil) son una alternativa descartada y no se construyen. Es una épica añadida después del plan. Cambia cómo se presentan la configuración del club (E18a, E13, E19 y las posiciones de E10) y el menú de cuenta (E17), sin endpoints nuevos.

El `README.md` del handoff es parte de este PRD: tiene las medidas, los colores, los textos y cada estado. Lo que dice aquí manda sobre él cuando no coinciden.

Las decisiones van marcadas como D1 a D16. D1 y D2 las tomó el dueño el 17 de octubre de 2026. Las demás salen del código actual y el dueño las ratifica al aprobar este PRD.

- **D1.** **Arrastrar se hace con dnd-kit** (`@dnd-kit/core` y `@dnd-kit/sortable`). Es la única dependencia nueva de la épica. Resuelve ratón, dedo y teclado, y trae los anuncios para lector de pantalla. Lo pide el handoff, y hecho a mano sería más código y más riesgo en el móvil.
- **D2.** **Un pack sigue yendo de 1 a 50 sesiones**, como hoy (`MIN_PACK_SESSIONS`, `MAX_PACK_SESSIONS` y el check de `0056`). El handoff dice 2 a 50; el texto pasa a "Entre 1 y 50." / "Between 1 and 50." y no hay migración.
- **D3.** **Los textos de la página de inicio de sesión siguen en 140 y 320 caracteres** (`SIGN_IN_TAGLINE_MAX_LENGTH`, `SIGN_IN_WELCOME_MAX_LENGTH`). El handoff dibuja contadores de 80 y 400; los contadores enseñan los límites de verdad.
- **D4.** **Los roles de una posición son los de hoy:** sin rol, `goalkeeper`, `defender` y `forward` (`POSITION_COVERAGES`), con sus textos actuales. El handoff los llama Goalkeeper, Defence y Attack.
- **D5.** **El tema "Sistema" vive donde vive hoy el tema:** `localStorage`, clave `seadragons-theme`, que ahora admite `light`, `dark` y `system`. Sin valor guardado cuenta como `system`, que es lo que `ThemeScript` ya hace al no encontrar nada. Quien hoy tiene `light` o `dark` guardado lo conserva. Con `system`, la página sigue a `prefers-color-scheme` también si cambia con la página abierta.
- **D6.** **En escritorio, la campana y el botón de cuenta pasan a la barra de arriba**, a la derecha, junto al buscador global, que no se mueve. La cabecera de la barra lateral se queda con la marca y el nombre del club. En el móvil la cabecera no cambia.
- **D7.** **El menú de cuenta es el mismo componente en las dos pantallas:** desplegable en escritorio (#1a) y pantalla completa en el móvil (#2a), como hoy (`AccountMenu`, `.account-menu`). No hay ruta nueva.
- **D8.** **"Configuración del club" sale en el menú para Admin y Committee**, como hoy (`isAllowedForAccess(CLUB_SETTINGS_PATH, …)`). El handoff dice "solo Admin", pero el Committee entra hoy a configurar los packs y lo sigue haciendo. Para el Committee, `/club` abre directamente Packs: sin pestañas en escritorio y sin lista en el móvil.
- **D9.** **La sección abierta va en la URL:** `/club?tab=general|sign-in|positions|packs`. En escritorio, sin `tab` abre General. En el móvil, sin `tab` enseña la lista (#3a) y con `tab` la pantalla de esa sección (#3b). Un `tab` que no existe, o que el rol no puede ver, se trata como si no estuviera.
- **D10.** **Se guarda como dice el handoff.** General, Inicio de sesión y Packs juntan un borrador y lo guardan con la barra de cambios sin guardar. Posiciones guarda cada cambio al momento, como hoy. El logo también se guarda al momento, como hoy.
- **D11.** **Salir con cambios sin guardar pregunta.** Al cerrar o recargar la pestaña, con `beforeunload`. Al seguir un enlace de la app, con una confirmación propia. Cambiar de pestaña dentro de `/club` no pregunta: el borrador se queda y la pestaña lleva el punto.
- **D12.** **El 409 se maneja como hoy.** General (`club_settings_changed`) y Posiciones (`club_positions_changed`) enseñan "Cargar lo último". Inicio de sesión y Packs no tienen conflicto hoy y siguen sin tenerlo.
- **D13.** **Los colores sueltos ya son tokens desde E21 a E23:** `--color-hover`, `--color-segment-selected` y `--color-editor-bar`. Se reutilizan; no se añade ningún hex en las reglas.
- **D14.** **Ningún objetivo táctil baja de 44 px**, como E22 D11 y E23 D11.
- **D15.** **El español usa tú, no vos,** como el resto de `es.ts`.
- **D16.** **Están diseñados el escritorio y el móvil, en tema oscuro.** El corte es 768 px. El tema claro aplica el mismo diseño con los tokens claros, y la tableta usa el de escritorio. Lo que no está dibujado (errores, conflicto, guardando, vacíos) lo revisa el `ui-reviewer` contra `design-system.md`.

## 1. Problema

La configuración del club es una sola página larga: identidad, marca, textos de entrada, posiciones y packs, uno debajo de otro. Para cambiar una posición hay que bajar hasta ella, y cada sección tiene su propio botón de guardar, así que no se sabe qué quedó sin guardar. Reordenar posiciones o packs es pulsar subir y bajar varias veces. En el móvil todo eso se apila en una columna estrecha. El menú de cuenta mezcla un interruptor de tema que no sigue al sistema con un botón de idioma que solo dice el otro idioma.

## 2. Usuarios y contexto

- **Admin del club, sobre todo desde el portátil:** cambia el nombre, el color, el logo, los textos de entrada y las posiciones, de vez en cuando.
- **Committee, desde el portátil o el móvil:** solo configura los packs de sesiones.
- **Cualquier socio:** usa el menú de cuenta para su perfil, el tema, el idioma y cerrar sesión.
- **Hoy lo resuelven así:** bajando por la página, pulsando subir y bajar fila a fila, y pulsando el botón de guardar de cada sección.

## 3. Objetivo y métricas de éxito

- **Objetivo:** que cada parte de la configuración tenga su sitio, que se vea qué falta guardar y que reordenar sea arrastrar.
- **Métricas:**
  - Un Admin lleva una posición del puesto 6 al 1 con un solo arrastre, y con el teclado en cinco pulsaciones sin perder el foco.
  - Ningún cambio de General, Inicio de sesión o Packs se pierde sin aviso: los tests de la barra de cambios sin guardar y de la salida lo comprueban.
  - Un Committee no ve ni recibe datos de las otras tres secciones: un test de la pantalla y los de la API lo comprueban.
  - Nada de lo que hoy hacen las secciones desaparece: los tests de comportamiento existentes siguen pasando, adaptados a la estructura nueva sin quitarles casos (salvo los de los botones subir y bajar, que se cambian por el teclado sobre el asa).

## 4. Alcance

**Incluido (v1):**

- Las cuatro secciones como pestañas en escritorio y como lista y pantallas en el móvil, con la sección en la URL.
- La barra de cambios sin guardar, el punto en la pestaña, el aviso de guardado y la pregunta al salir.
- General con los colores sugeridos, el campo hex y la vista previa.
- Inicio de sesión con el cambio inglés y español y la vista previa.
- Posiciones en una tabla compacta: rol que se guarda al cambiar, renombrar en la fila, fila de añadir y archivadas plegables; en el móvil, filas y hoja inferior.
- Packs en una tabla con precio en vivo y fila de añadir.
- Arrastrar posiciones y packs con ratón, dedo y teclado.
- El menú de cuenta rediseñado, con Claro · Oscuro · Sistema e Inglés · Español.
- La campana y el botón de cuenta en la barra de arriba en escritorio.
- Tema claro y tableta (D16), inglés y español.

**Explícitamente fuera (por ahora):**

- Endpoints nuevos o cambios de esquema.
- Cambiar los límites de los packs o de los textos de entrada (D2, D3).
- Guardar el tema en el perfil o en una cookie (D5).
- Deshacer después de guardar.
- Las pestañas tipo chip del móvil (#2b, #2c).
- Cambiar quién puede entrar a `/club` o a cada endpoint.

## 5. Requerimientos funcionales

Para medidas, colores y textos de cada pieza, ver el `README.md` del handoff. Cada RF se cumple en inglés y en español, en claro y oscuro, a 375, 768 y 1440.

### RF-1 · Las secciones de la configuración · Must

- **Dado** un Admin en escritorio, **cuando** abre `/club`, **entonces** ve el título "Configuración del club" con su entrada y la barra General · Página de inicio de sesión · Posiciones · Packs de sesiones, con `role="tablist"`, y abre en General.
- **Dado** esa barra, **cuando** se usan las flechas izquierda y derecha sobre una pestaña, **entonces** el foco pasa a la vecina, y Enter o Espacio la abre.
- **Dado** un Admin, **cuando** cambia de pestaña, **entonces** la URL pasa a `?tab=…` y recargar o volver atrás deja la misma (D9).
- **Dado** un Committee, **cuando** abre `/club`, **entonces** ve Packs sin barra de pestañas, y con `?tab=positions` también ve Packs, sin pedir datos de las otras secciones.
- **Dado** un Admin en el móvil, **cuando** abre `/club`, **entonces** ve la lista #3a: la fila del club con "Solo los Admin ven esto." y cuatro filas de al menos 68 px con su resumen ("6 posiciones · 1 archivada", "4 packs · 5, 10, 20, 8 sesiones"…).
- **Dado** esa lista, **cuando** toca una fila, **entonces** se abre la pantalla de la sección (#3b) con "‹ Configuración" para volver a la lista.
- **Dado** un Committee en el móvil, **cuando** abre `/club`, **entonces** ve directamente la pantalla de Packs, sin lista.

### RF-2 · Cambios sin guardar · Must

- **Dado** General, Inicio de sesión o Packs sin cambios, **cuando** se pinta, **entonces** no hay barra de guardar.
- **Dado** un cambio en una de esas secciones, **cuando** el borrador difiere de lo guardado, **entonces** aparece abajo la barra fija "Cambios sin guardar en {los datos del club | la página de inicio de sesión | los packs}" con Descartar y Guardar cambios, y la pestaña (o la fila del móvil) lleva el punto o "● Sin guardar".
- **Dado** el borrador inválido, **cuando** se mira la barra, **entonces** Guardar cambios está desactivado y el error se ve en su campo.
- **Dado** Guardar cambios, **cuando** el servidor acepta, **entonces** la barra desaparece, el punto se va y sale "✓ Guardado" unos 2,5 s, anunciado con `role="status"`.
- **Dado** Descartar, **cuando** se pulsa, **entonces** el formulario vuelve a lo guardado y la barra desaparece.
- **Dado** un borrador en una pestaña, **cuando** se pasa a otra y se vuelve, **entonces** el borrador sigue ahí.
- **Dado** un borrador en cualquier sección, **cuando** se sigue un enlace de la app o se cierra la pestaña del navegador, **entonces** se pregunta antes de salir (D11), y cancelar deja todo como estaba.
- **Dado** un error de red al guardar, **cuando** pasa, **entonces** el borrador se queda, la barra sigue y sale el error de hoy.

### RF-3 · General · Must

- **Dado** General, **cuando** se pinta en escritorio, **entonces** ve a la izquierda IDENTIDAD (nombre con contador "n / 60", iniciales opcionales con las automáticas de marcador) y MARCA (color y logo), y a la derecha la tarjeta fija VISTA PREVIA con la cabecera de la barra lateral, un botón y un enlace en el color elegido.
- **Dado** el color, **cuando** se elige uno de los cinco sugeridos (`#33A1E0`, `#E0A33A`, `#D9667A`, `#8C7AE6`, `#2E9E86`), **entonces** queda marcado con el anillo, el campo hex lo muestra y la vista previa cambia.
- **Dado** un hex escrito, **cuando** no es válido o no se puede leer texto encima (`evaluateAccentColor`), **entonces** sale el error de hoy y Guardar cambios se desactiva.
- **Dado** el logo, **cuando** se sube, se cambia o se quita, **entonces** se guarda al momento como hoy (`ClubLogoField`), sin pasar por la barra.
- **Dado** un 409 `club_settings_changed`, **cuando** se guarda, **entonces** sale el aviso con "Cargar lo último", como hoy.
- **Dado** el móvil, **cuando** se abre General, **entonces** el logo va arriba con Subir de 44 px, los campos miden 48 px con texto de 16 px y los colores sugeridos 44 px.

### RF-4 · Página de inicio de sesión · Must

- **Dado** la sección, **cuando** se pinta, **entonces** hay un control Inglés | Español y, para el idioma elegido, el titular con contador "n / 140" y el párrafo de bienvenida (5 filas) con "n / 320" (D3), con el texto de la app como marcador.
- **Dado** el otro idioma, **cuando** se mira, **entonces** una línea dice si tiene texto propio o usa el de la app.
- **Dado** la vista previa, **cuando** se escribe, **entonces** enseña la marca del club, el titular y el párrafo del idioma elegido, y el texto de la app si un campo está vacío.
- **Dado** un texto por encima del límite, **cuando** se mira, **entonces** sale el error de hoy y Guardar cambios se desactiva.

### RF-5 · Posiciones en la tabla · Must

- **Dado** la sección, **cuando** se pinta en escritorio, **entonces** es una tabla con asa, número, nombre en el idioma de la pantalla y el otro debajo ("ES · Portero"), el rol y los botones Renombrar y Archivar.
- **Dado** una posición sin nombre en un idioma, **cuando** se pinta, **entonces** dice "Sin nombre en español" (o en inglés) en color de aviso.
- **Dado** el rol, **cuando** se cambia en el desplegable, **entonces** se guarda al momento (`setManagedPositionCoverage`), sin botón aparte, y se anuncia como hoy.
- **Dado** Renombrar, **cuando** se pulsa, **entonces** la celda pasa a dos campos (inglés, español) con ✓ y ×; ✓ guarda con las reglas de `PositionNamesForm` y × lo deja como estaba.
- **Dado** la fila de añadir, **cuando** no hay ningún nombre, **entonces** Añadir está desactivado; con uno basta.
- **Dado** archivadas, **cuando** las hay, **entonces** sale "▸ Archivadas · n" plegado, y cada una tiene Reactivar.
- **Dado** el asa enfocada, **cuando** se pulsa ↑ o ↓, **entonces** la fila sube o baja un puesto, se guarda (`reorderManagedPositions`), se anuncia "Delantero movido al 3 de 6" y el foco se queda en el asa.
- **Dado** cualquier cambio guardado, **cuando** el servidor confirma, **entonces** sale arriba a la derecha un aviso corto ("… · guardado") además del anuncio.
- **Dado** un 409 `club_positions_changed`, **cuando** pasa, **entonces** sale "Cargar lo último", como hoy.

### RF-6 · Posiciones en el móvil · Must

- **Dado** el móvil, **cuando** se abre Posiciones, **entonces** cada posición es una fila de 60 px con asa de 44 px, nombre y "rol · falta un nombre" debajo, y la indicación "Mantén ⋮⋮ y arrastra para reordenar".
- **Dado** una fila, **cuando** se toca fuera del asa, **entonces** se abre una hoja inferior (`BottomSheet`) con los dos nombres, el rol como cuatro botones de 44 px, Archivar y Guardar de 48 px.
- **Dado** Guardar en la hoja, **cuando** cambió el nombre, el rol o los dos, **entonces** se guardan los que cambiaron, la hoja se cierra y el foco vuelve a la fila.
- **Dado** la hoja, **cuando** se cierra sin guardar, **entonces** nada cambia.
- **Dado** debajo de la lista, **cuando** se mira, **entonces** está el campo "Nueva posición" con Añadir y las archivadas plegadas con Reactivar.

### RF-7 · Packs · Must

- **Dado** la sección, **cuando** se pinta, **entonces** es una tabla de 620 px como máximo con asa, la etiqueta "{n} sesiones", el precio (`priceSessionPack`) y el botón de borrar, y la entrada dice el precio de la sesión Casual de Stripe.
- **Dado** sin packs, **cuando** se pinta, **entonces** dice "Sin packs. Los socios Casual solo pueden pagar por sesión."
- **Dado** la fila de añadir, **cuando** se escribe un número, **entonces** enseña el precio del pack nuevo en vivo; fuera de 1 a 50 dice "Entre 1 y 50." (D2) y repetido "Ya está en la lista.", y no se añade.
- **Dado** añadir, borrar o mover, **cuando** se hace, **entonces** solo cambia el borrador y aparece la barra (RF-2).
- **Dado** el precio de la sesión no disponible, **cuando** se pinta, **entonces** sale el aviso de hoy (`payments.plan.priceUnavailable`) en lugar de los precios.

### RF-8 · Arrastrar para reordenar · Must

- **Dado** escritorio, **cuando** se arrastra una fila por el asa, **entonces** la fila queda al 45 % de opacidad, una línea de 2 px en el color de acento marca dónde caerá, y al soltar se aplica el orden nuevo.
- **Dado** el móvil, **cuando** se mantiene el asa unos 150 ms y se arrastra, **entonces** la fila se levanta (escala 1,02, fondo y sombra) y la página no hace scroll mientras tanto (`touch-action: none` en el asa).
- **Dado** soltar en Posiciones, **cuando** pasa, **entonces** se guarda el orden completo, el foco vuelve al asa y se anuncia el movimiento; si falla, la lista vuelve al orden anterior con el error.
- **Dado** soltar en Packs, **cuando** pasa, **entonces** solo cambia el borrador.
- **Dado** soltar en el mismo sitio, **cuando** pasa, **entonces** no se manda nada.
- **Dado** un lector de pantalla, **cuando** se arrastra con el ratón o el dedo, **entonces** se anuncian el inicio, el puesto de destino y el final, en el idioma de la pantalla.
- **Dado** el teclado, **cuando** se usa sobre el asa, **entonces** sigue siendo ↑ y ↓ como en RF-5; el arrastre no añade otro modo de teclado.

### RF-9 · El menú de cuenta · Must

- **Dado** escritorio, **cuando** se abre el menú, **entonces** es un panel de 300 px bajo el botón de cuenta con la identidad (avatar, nombre, "rol · correo"), Mi perfil, Configuración del club (si D8), APARIENCIA, IDIOMA y Cerrar sesión en rojo.
- **Dado** `/club` abierto, **cuando** se abre el menú, **entonces** Configuración del club está resaltada con "Estás aquí".
- **Dado** APARIENCIA, **cuando** se elige Claro, Oscuro o Sistema, **entonces** el tema cambia al momento, se guarda (D5) y la opción queda marcada; con Sistema, la página sigue al sistema.
- **Dado** IDIOMA, **cuando** se elige el otro idioma, **entonces** se guarda la cookie y se refresca como hoy (`LanguageToggle`); elegir el actual no hace nada.
- **Dado** el menú, **cuando** se pulsa Escape, se toca fuera o el foco sale, **entonces** se cierra y el foco vuelve al botón, como hoy (`useDismissal`).
- **Dado** el móvil, **cuando** se abre, **entonces** es la pantalla #2a: volver, "Cuenta", identidad de 52 px, Mi perfil y Configuración del club en una tarjeta de filas de 54 px, los controles de 42 px y Cerrar sesión de 50 px.

### RF-10 · La barra de arriba en escritorio · Should

- **Dado** escritorio, **cuando** se pinta cualquier página de la app, **entonces** la campana y el botón de cuenta (círculo de 38 px con las iniciales) están a la derecha de la barra de arriba, y el buscador sigue a la izquierda (D6).
- **Dado** el menú abierto, **cuando** se mira el botón, **entonces** tiene el fondo `--color-segment-selected` y el anillo de 2 px de acento.
- **Dado** el móvil, **cuando** se pinta, **entonces** la cabecera es la de hoy.

## 6. Casos borde y estados de error

- **Sin posiciones activas:** la tabla enseña solo la fila de añadir y una línea que dice que no hay posiciones.
- **Una sola posición o un solo pack:** el asa sigue, ↑ y ↓ no hacen nada y no se manda nada.
- **Muchas posiciones (30) o packs (50):** la tabla crece, la barra de guardar sigue fija abajo y arrastrar hace scroll al acercarse al borde.
- **Dos acciones a la vez en Posiciones:** mientras una espera al servidor, las demás esperan (`usePendingAction`), también arrastrar.
- **Conflicto en Posiciones a mitad de arrastre:** el 409 deja la lista como dice el servidor y ofrece "Cargar lo último".
- **Guardar dos veces seguidas:** el botón se desactiva mientras guarda.
- **Sin red al cambiar de tema o idioma:** el tema es local y funciona igual; el idioma sigue como hoy.
- **`localStorage` bloqueado (modo privado):** el tema funciona en la sesión y vuelve a Sistema al recargar, sin errores.
- **Un Committee con un enlace a `?tab=general`:** ve Packs (D9) y no se pide `/api/v1/club/settings`.
- **El logo falla al subir:** sale el error de hoy y el borrador de General no se toca.

## 7. UX / UI

- **Mockups:** `docs/design/design_handoff_club_settings/screenshots/` (01 a 10) y el prototipo. Se construyen #1a, #2a, #3a y #3b.
- **Flujo principal (Admin, escritorio):** menú de cuenta → Configuración del club → pestaña → cambio → barra → Guardar cambios → "✓ Guardado".
- **Flujo principal (Admin, móvil):** Cuenta → Configuración del club → lista → sección → cambio → barra → Guardar cambios → "‹ Configuración".
- **Viewports:** 375 / 768 / 1440.

## 8. Requerimientos no funcionales

- **Rendimiento:** arrastrar va a 60 fps en un móvil medio; no se repinta la tabla entera en cada movimiento.
- **Accesibilidad:** cumple `design-system.md` (axe sin violaciones). Pestañas con `tablist`, asas con `aria-label` "Reordenar {nombre}, puesto {i} de {n}", anuncios `aria-live` para cada cambio guardado o movido.
- **Seguridad:** no cambia quién puede qué; los endpoints siguen comprobando `manageUsersAndRoles` y `configureSessionPacks` en el servidor.
- **Dependencias:** solo `@dnd-kit/core` y `@dnd-kit/sortable` (D1), justificadas en el PR que las añade.

## 9. Preguntas abiertas

Ninguna bloquea. D3 a D16 las ratifica el dueño al aprobar este PRD.

## 10. Descomposición en tickets (para write-ticket)

Todos con `ui-review`, salvo el 1. Las capturas de Playwright `club-*` (26 estados) se rehacen ticket a ticket.

| #   | Título propuesto                                                             | Tamaño | Depende de | Auto-merge sugerido                                   |
| --- | ---------------------------------------------------------------------------- | ------ | ---------- | ----------------------------------------------------- |
| 1   | Añade la opción Sistema al tema y la guarda junto a Claro y Oscuro           | S      | ninguna    | No: cambia el arranque de cada página (`ThemeScript`) |
| 2   | Rehace el menú de cuenta con apariencia, idioma y cerrar sesión              | M      | 1          | No: pantalla nueva, foco y cierre                     |
| 3   | Lleva la campana y el botón de cuenta a la barra de arriba en escritorio     | S      | 2          | No: mueve capturas de todas las páginas               |
| 4   | Divide la configuración del club en pestañas y en la lista del móvil         | M      | ninguna    | No: permisos por rol en la pantalla                   |
| 5   | Añade la barra de cambios sin guardar y la pregunta al salir                 | M      | 4          | No: lógica nueva de borradores                        |
| 6   | Rehace la pestaña General con colores sugeridos y vista previa               | M      | 5          | No: pantalla nueva                                    |
| 7   | Rehace la página de inicio de sesión con inglés y español y vista previa     | S      | 5          | No: pantalla nueva                                    |
| 8   | Rehace los packs en una tabla con precio en vivo                             | S      | 5          | No: pantalla nueva                                    |
| 9   | Rehace las posiciones en una tabla con rol al momento y renombrar en la fila | M      | 4          | No: cambia cómo se guardan los roles                  |
| 10  | Lleva las posiciones al móvil con la hoja de edición                         | M      | 9          | No: pantalla nueva                                    |
| 11  | Ordena posiciones y packs arrastrando, con ratón, dedo y teclado             | M      | 8, 9       | No: dependencia nueva (D1)                            |
