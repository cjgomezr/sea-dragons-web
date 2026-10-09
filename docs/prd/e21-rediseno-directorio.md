# PRD: E21 · El rediseño del directorio

**Estado:** borrador · **Fecha:** 9 de octubre de 2026 · **Autor:** sesión de planificación (Claude Code)

Fuente: el diseño que el dueño hizo con Claude Design, guardado en `docs/design/directorio-admin/` (el prototipo `Directory Upgrade.dc.html`, su `README.md` de handoff y `support.js`), con sus capturas en `docs/mockups/` (las `directory-admin-*` y `mobile-directory-admin-*`). Se construye la opción **2** del prototipo: "2a" en escritorio y "2b" en el móvil. Las secciones "1a" a "1e" son exploraciones y no se construyen. Es una épica añadida después del plan; no cambia ningún requisito del SRD, sino cómo se presentan los de E5 y E19 (FR-015 a FR-019, FR-085, FR-088 a FR-093).

El `README.md` del handoff es parte de este PRD: tiene las medidas, los colores, los textos y cada estado. Lo que dice aquí manda sobre él cuando no coinciden.

Las decisiones del dueño van marcadas como D1 a D6:

- **D1.** Entra el **cambio de rol en bloque**: seleccionar varios socios y cambiarles el rol de una vez, con confirmación.
- **D2.** **No entra el recordatorio de AUF por correo.** La tarjeta de "AUF por renovar" se queda con "Ver", que filtra la lista; el botón "Enviar recordatorio" no se construye. Para escribirles está el correo del directorio (#501).
- **D3.** Los iconos son de **Phosphor** (`@phosphor-icons/react`), como en el diseño. Es una dependencia nueva de la app.
- **D4.** **Todos los roles** usan el diseño nuevo. Cada uno ve y hace solo lo que ya puede hoy: el Admin, todo; Committee, Coach y Player, la misma lista y la ficha rápida sin lo de administrar (sin cambiar roles, sin decidir solicitudes, sin el AUF ni la membresía, y con el contacto según FR-090).
- **D5.** Solo está diseñado el **tema oscuro**. El claro aplica el mismo diseño con los tokens del tema claro, sin mockup propio: el `ui-reviewer` lo revisa contra `design-system.md`.
- **D6.** Los colores sueltos del diseño que todavía no son tokens (hover `#1a3349`, texto de acento `#cfe8f7`, texto suave `#cfdeea`, acento al pasar `#5ab4e8`) pasan a ser tokens, con su versión para el tema claro.

## 1. Problema

El directorio creció mucho con E19 y la pantalla no lo aguanta. Los filtros ocupan tres filas antes de ver al primer socio. Cada fila lleva un selector de rol y un botón Guardar, que en un club de 50 socios son 50 formularios en pantalla. Las solicitudes de rol, los AUF por renovar y los datos que faltan están en sitios distintos, y para ver el contacto de alguien o cambiarle el rol hay que leer una fila muy ancha o entrar a su ficha. En el móvil, la lista es larga y llamar a un socio son varios toques.

## 2. Usuarios y contexto

- **Admin, sobre todo desde el portátil:** decide solicitudes de rol, cambia roles, sigue los AUF y la membresía, invita socios.
- **Committee, desde el portátil o el móvil:** busca socios, les escribe, exporta listas.
- **Coach, desde el móvil en la piscina:** encuentra a un socio y llama a su contacto de emergencia.
- **Player:** busca a sus compañeros.
- **Hoy lo resuelven así:** con la pantalla actual, bajando por las tres filas de filtros y cambiando el rol fila a fila.

## 3. Objetivo y métricas de éxito

- **Objetivo:** que el directorio enseñe más socios a la vez, que lo de administrar esté a un clic y que nada de lo que hoy hace se pierda.
- **Métricas:**
  - En escritorio a 1440 × 900, se ven al menos 9 socios sin hacer scroll, frente a los 4 o 5 de hoy.
  - Un Admin aprueba una solicitud de rol desde el directorio en dos clics, sin cambiar de pantalla.
  - Un Coach llama al contacto de emergencia de un socio desde el móvil en dos gestos (deslizar y tocar).
  - Ninguna función de E5 ni de E19 desaparece: los tests de comportamiento que ya existen siguen pasando, adaptados a la estructura nueva pero sin quitarles casos.

## 4. Alcance

**Incluido (v1):**

- La cabecera, la barra de herramientas con el popover de filtros y las fichas de filtros activos.
- La lista compacta, con orden por columnas, puntos de estado y el estado vacío.
- El panel lateral: resumen del club y ficha rápida del socio.
- La selección múltiple con correo, exportación y cambio de rol en bloque.
- La versión de móvil: lista, orden, menú "⋯", pantalla de solicitudes, ficha que sube desde abajo y acciones al deslizar.
- Las variantes por rol (D4), los tokens nuevos (D6), Phosphor (D3) y el tema claro (D5).

**Explícitamente fuera (por ahora):**

- El recordatorio de AUF por correo (D2).
- La ficha completa del socio (`MemberRecordScreen`): solo se enlaza.
- Cambiar qué datos ve cada rol: las reglas de E5 y E19 no cambian.
- Las otras pantallas de la app, aunque luego puedan usar Phosphor y los tokens nuevos.

## 5. Requerimientos funcionales

Para medidas, colores y textos de cada pieza, ver el `README.md` del handoff. Cada RF se cumple en inglés y en español, en claro y oscuro, a 375, 768 y 1440.

### RF-1 · Base visual: tokens e iconos · Must

- **Dado** los colores sueltos de D6, **cuando** se usan, **entonces** son variables CSS en `globals.css` con su valor claro y oscuro, y están descritos en `design-system.md`.
- **Dado** un icono del diseño, **cuando** se pinta, **entonces** sale de `@phosphor-icons/react`, decorativo (`aria-hidden`) si va con texto, y con `aria-label` y `title` en el botón si va solo.

### RF-2 · Cabecera y barra de herramientas · Must

- **Dado** el directorio en escritorio, **cuando** se abre, **entonces** arriba están "Directorio", "{shown} de {total} socios", la línea de estado de las solicitudes y, a la derecha, los botones de solo icono de correo, exportar CSV e invitar, cada uno solo si ese rol puede usarlo hoy.
- **Dado** la barra, **cuando** se mira, **entonces** es una sola fila: búsqueda, el control segmentado de rol, el botón Filtros con su contador y el botón del panel.
- **Dado** el botón Filtros en escritorio, **cuando** se pulsa, **entonces** abre un popover con los filtros que ofrece el servidor (`availableFilters`), "Borrar todo" y "Mostrar {n} socios". En el móvil sigue siendo la hoja inferior de hoy.
- **Dado** filtros activos, **cuando** los hay, **entonces** salen como fichas debajo de la barra, cada una con su ✕, y un enlace "Borrar".
- **Dado** los filtros, **cuando** cambian, **entonces** siguen en la URL (FR-091), como hoy.

### RF-3 · La lista compacta · Must

- **Dado** la lista, **cuando** se mira, **entonces** cada fila lleva avatar, nombre, país y nivel, rol, posición y asistencia, con las columnas del handoff. Ya no lleva selector de rol ni botón Guardar.
- **Dado** el encabezado de una columna, **cuando** se pulsa, **entonces** ordena por ella en el servidor y, si se vuelve a pulsar, invierte el orden. La asistencia empieza de mayor a menor.
- **Dado** un socio con el AUF vencido o la membresía `past_due`, **cuando** un Admin mira la fila, **entonces** ve un punto de peligro; con el AUF sin número o por vencer (los 30 días de `AUF_EXPIRING_WINDOW_DAYS`), un punto de aviso. **Cada punto lleva texto para lectores de pantalla y un `title`**: la regla de `auf-marks.ts` ("nunca solo con color") sigue valiendo. Debajo de la lista está la leyenda.
- **Dado** un socio con una solicitud de rol pendiente, **cuando** un Admin mira la fila, **entonces** ve debajo de su rol la píldora "→ {rol pedido}".
- **Dado** un socio invitado que no ha entrado, **cuando** se mira la fila, **entonces** lleva la píldora "Invitado" y la línea "Invitado el {fecha} · todavía no ha entrado".
- **Dado** unos filtros que no devuelven nadie, **cuando** se aplica, **entonces** sale el estado vacío del handoff con "Borrar filtros".

### RF-4 · El panel lateral: resumen del club · Must (Admin)

- **Dado** un Admin sin socio seleccionado, **cuando** el panel está abierto, **entonces** enseña el resumen: las solicitudes de rol con Aprobar y Rechazar, la tarjeta de AUF por renovar con "Ver" (que filtra la lista, D2) y "Necesita atención" con cuatro contadores (sin AUF, AUF vencido o por vencer, sin contacto de emergencia, membresía vencida) que activan su filtro al pulsarlos.
- **Dado** los contadores, **cuando** se calculan, **entonces** son de todo el club activo, no solo de la vista filtrada.
- **Dado** una solicitud aprobada o rechazada, **cuando** el servidor confirma, **entonces** sale el aviso de éxito del handoff y la fila se actualiza. Usa `loadPendingRequests` y `submitRoleRequestDecision`, con la protección contra doble envío de hoy.
- **Dado** el botón del panel, **cuando** se pulsa, **entonces** el panel se cierra y la lista ocupa todo el ancho; cerrado, enseña el número de solicitudes pendientes en el botón.
- **Dado** un Committee, un Coach o un Player, **cuando** no tienen a nadie seleccionado, **entonces** no ven el resumen del club (D4); el panel solo se abre al seleccionar a alguien.

### RF-5 · El panel lateral: ficha rápida del socio · Must

- **Dado** cualquier rol, **cuando** pulsa una fila, **entonces** el panel enseña la ficha rápida de ese socio; al pulsar la misma fila, la ✕ o Esc, se cierra.
- **Dado** la ficha rápida, **cuando** se mira, **entonces** lleva avatar, nombre (enlace a la ficha completa), etiquetas, contacto con botón de copiar, asistencia, posición y "Abrir ficha completa". El AUF y la membresía, solo para el Admin; el contacto, según FR-090.
- **Dado** un dato de contacto que falta, **cuando** un Admin mira la ficha, **entonces** la línea sale en color de aviso con "Añadir", que lleva a la ficha completa.
- **Dado** un Admin, **cuando** elige otro rol en el control segmentado, **entonces** no se guarda: sale la franja de confirmación "{de} → {a}" con Cancelar y **Guardar rol**. Al confirmar el servidor, sale "✓ Rol guardado". La regla del último Admin (`LastAdminError`) se respeta y su error se enseña en la franja.
- **Dado** un socio invitado, **cuando** un Admin lo selecciona, **entonces** ve el recuadro de invitación con "Reenviar invitación" (`InvitationResend`).
- **Dado** un socio con solicitud pendiente, **cuando** un Admin lo selecciona, **entonces** ve el recuadro de la solicitud con Aprobar y Rechazar.

### RF-6 · Selección múltiple y rol en bloque · Must (D1)

- **Dado** las casillas de las filas, **cuando** quien puede usarlas marca una o más, **entonces** aparece la barra "{n} seleccionados" con Correo y Exportar (para quien hoy puede hacerlo) y, para el Admin, "Cambiar rol ▾". Pulsar la casilla no abre el panel.
- **Dado** socios marcados, **cuando** se pulsa Correo o Exportar, **entonces** actúan sobre los marcados; sin ninguno marcado, sobre la lista filtrada, como hoy (FR-092, FR-093). El cupo de 50 correos al día no cambia.
- **Dado** un Admin que elige un rol en "Cambiar rol", **cuando** lo elige, **entonces** sale la confirmación "¿Cambiar {n} socios a {rol}?" y no se guarda nada hasta pulsar **Cambiar roles**.
- **Dado** el cambio en bloque confirmado, **cuando** se aplica, **entonces** cada socio pasa por las mismas reglas y la misma bitácora que el cambio de uno (último Admin incluido), y el resultado dice cuántos cambiaron y cuáles no y por qué. Un fallo en uno no deshace los demás.
- **Dado** un Committee, un Coach o un Player, **cuando** miran la lista, **entonces** solo tienen casillas si pueden usar Correo o Exportar; nunca "Cambiar rol".

### RF-7 · Móvil: lista, orden, menú y solicitudes · Must

- **Dado** el directorio a menos de 768 px, **cuando** se abre, **entonces** enseña la cabecera con "⋯" e Invitar, la búsqueda con Filtros, los chips de rol desplazables y la línea "{n} socios · desliza ← para acciones" con "Orden: {campo}".
- **Dado** "Orden", **cuando** se toca, **entonces** abre la hoja inferior "Ordenar por" (nombre, rol, posición, asistencia); tocar la activa invierte el orden.
- **Dado** "⋯", **cuando** se toca, **entonces** abre la hoja con "Escribir a estos socios" y "Exportar CSV", cada una solo si ese rol puede.
- **Dado** solicitudes pendientes, **cuando** un Admin abre el directorio, **entonces** ve el aviso "{n} solicitudes de rol · Revisar", que abre la pantalla de solicitudes con Aprobar y Rechazar en cada tarjeta, y "Todo al día" cuando no queda ninguna.

### RF-8 · Móvil: ficha que sube y acciones al deslizar · Must

- **Dado** una fila en el móvil, **cuando** se toca, **entonces** sube la ficha del socio desde abajo, con lo mismo que la ficha rápida de RF-5 y los botones redondos de correo, llamada y emergencia.
- **Dado** una fila, **cuando** se desliza a la izquierda más de 30 px, **entonces** enseña los botones de correo, llamada y emergencia; deslizar a la derecha o tocar fuera los cierra. Usa eventos de puntero y `touch-action: pan-y`, para no romper el scroll.
- **Dado** un dato que falta o que ese rol no puede ver, **cuando** se pintan los botones, **entonces** el que falta sale desactivado y el que no puede ver no sale.
- **Dado** el botón de llamada o de emergencia, **cuando** se toca, **entonces** abre `tel:` con ese número; el de correo, `mailto:`.
- **Dado** un lector de pantalla, **cuando** recorre la lista, **entonces** las acciones de deslizar también se alcanzan sin el gesto (por ejemplo, desde la ficha).

## 6. Casos borde y estados de error

- **Sin solicitudes:** la línea de estado dice "No hay solicitudes pendientes" y el resumen no enseña esa sección.
- **Club pequeño o grande:** la lista no se pagina hoy; con los 500 socios de NFR-008 debe seguir siendo fluida (sin pintar 500 filas pesadas: la fila compacta ayuda).
- **Cambio de rol que el servidor rechaza** (último Admin, sin permiso, red caída): la franja de confirmación enseña el error y el rol de la fila no cambia.
- **Cambio en bloque parcial:** el aviso dice cuántos cambiaron y lista los que no, con el motivo.
- **Socio desactivado** (FR-085): solo sale con el filtro "Incluir desactivados", y su ficha rápida lo dice.
- **Copiar al portapapeles sin permiso del navegador:** el botón avisa de que no pudo copiar; no falla en silencio.
- **Teclado:** el panel, los popovers y las hojas se cierran con Esc y devuelven el foco a lo que los abrió. Foco visible de 2 px en el color de acento.
- **Doble clic** en Aprobar, Guardar rol o Cambiar roles: una sola petición.

## 7. UX / UI

- **Mockups (modo A del `ui-reviewer`):**
  - Escritorio: `docs/mockups/directory-admin-overview-with-requests-dark.png`, `directory-admin-member-selected-role-confirm-dark.png`, `directory-admin-bulk-selection-confirm-dark.png`, `directory-admin-panel-closed-filters-open-dark.png`, `directory-admin-empty-state-dark.png`, `directory-admin-invited-member-dark.png`.
  - Móvil: `docs/mockups/mobile-directory-admin-list-requests-member-sheet-dark.png`, `mobile-directory-admin-sort-sheet-dark.png`, `mobile-directory-admin-more-menu-email-export-dark.png`.
  - El prototipo interactivo: `docs/design/directorio-admin/Directory Upgrade.dc.html` (sección 2).
- Las capturas usan datos de ejemplo. Los mockups viejos `directory-light.png` y `directory-dark.png` quedan como referencia del diseño anterior: para el directorio mandan los nuevos.
- Tema claro y los demás roles: sin mockup, revisión heurística contra `design-system.md` (D4, D5).
- Viewports: 375 / 768 / 1440.

## 8. Requerimientos no funcionales

- **Accesibilidad:** axe sin violaciones en todos los estados. Botones de solo icono con `aria-label` y `title`. Ningún dato solo con color.
- **Rendimiento:** la lista con 500 socios abre en menos de 1 segundo en el p95 (NFR-001), lo que mide la prueba de carga de E16b.
- **Seguridad:** los permisos no cambian. El cambio en bloque comprueba en el servidor que quien lo pide es Admin, socio por socio.
- **Dependencias:** `@phosphor-icons/react` (D3), con una línea de justificación en el PR que la añada. Solo se empaquetan los iconos que se importan.

## 9. Preguntas abiertas

- Ninguna que bloquee.

## 10. Descomposición en tickets (para write-ticket)

| #   | Título propuesto                                                                              | Tamaño | Depende de | Auto-merge sugerido                           |
| --- | --------------------------------------------------------------------------------------------- | ------ | ---------- | --------------------------------------------- |
| 1   | Añade los tokens nuevos del directorio y los iconos de Phosphor (RF-1)                        | S      | ninguna    | No: dependencia nueva y tokens de toda la app |
| 2   | Rehace la cabecera y la barra del directorio con el popover de filtros (RF-2)                 | M      | 1          | No: UI nueva                                  |
| 3   | Rehace la lista del directorio: filas compactas, orden por columnas y puntos de estado (RF-3) | M      | 2          | No: UI nueva                                  |
| 4   | Añade el panel lateral con la ficha rápida del socio y el cambio de rol confirmado (RF-5)     | M      | 3          | No: cambia cómo se guardan los roles          |
| 5   | Añade al panel el resumen del club: solicitudes, AUF por renovar y datos que faltan (RF-4)    | M      | 4          | No: lógica nueva y contadores                 |
| 6   | Selecciona varios socios para escribirles, exportarlos o cambiarles el rol en bloque (RF-6)   | M      | 4          | No: permisos y cambio de roles en bloque      |
| 7   | Rehace el directorio en el móvil: lista, orden, menú y pantalla de solicitudes (RF-7)         | M      | 3          | No: UI nueva                                  |
| 8   | Añade en el móvil la ficha que sube y las acciones al deslizar (RF-8)                         | M      | 4, 7       | No: gestos y enlaces de llamada               |

Cada ticket cubre todos los roles (D4), los dos temas y los dos idiomas. Todos llevan `ui-review`.

**Carriles en paralelo:** el 1, el 2 y el 3 van en fila. Después, el 4 y el 7 pueden ir a la vez (escritorio y móvil); tras el 4, el 5 y el 6 también. Ninguno lleva migraciones, salvo que el 6 necesite una función de base para el cambio en bloque; si la necesita, lo hace quien tenga el MCP de Supabase.
