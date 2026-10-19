# PRD: E29 · El rediseño de la hoja de asistencia

**Estado:** borrador · **Fecha:** 19 de octubre de 2026 · **Autor:** sesión de planificación (Claude Code)

Fuente: el diseño que el dueño hizo con Claude Design, guardado en `docs/design/design_handoff_attendance/`. Contiene el prototipo `Attendance Upgrade.dc.html`, su `README.md` de handoff, `support.js` y cuatro capturas en `screenshots/`. Se construyen **#1a** en escritorio y **#2a** en móvil, por debajo de 768 px. La **#1b** (cuadrícula de baldosas) es una alternativa descartada y no se construye. Es una épica añadida después del plan. Cambia cómo se presenta la hoja de asistencia de E8 (`src/components/attendance/*`), sin datos ni endpoints nuevos.

El `README.md` del handoff es parte de este PRD. Tiene las medidas, los colores, los textos y cada estado. Cuando no coinciden, manda lo que dice aquí.

Las decisiones van de D1 a D8. Salen del handoff y del código actual, y el dueño las ratifica al aprobar este PRD.

- **D1.** **El comportamiento no cambia.** Marcar no guarda. La hoja entera se guarda de una vez. Se mantienen la pregunta al salir o descartar, el `aria-live` de los totales y de los avisos, los grupos en el orden del RSVP, y el nombre como texto para el Coach (como enlace solo para el Admin).
- **D2.** **"Sin guardar" se calcula por socio:** el punto sale cuando el estado marcado de ese socio difiere del guardado. El número de Guardar es cuántos socios tienen el punto.
- **D3.** **El punto de sin guardar se anuncia:** además del `title`, lleva texto oculto "Sin guardar todavía", porque el `title` no lo lee todo lector de pantalla.
- **D4.** **En el móvil, ningún objetivo táctil baja de 44 px**, como en E22 a E28. Los botones del segmento se ven de 34 × 40 px, como en el diseño, y una zona de toque invisible los lleva a 44 px sin solaparse con los vecinos.
- **D5.** **En el móvil, Guardar vive en la barra fija de abajo**, y solo sale mientras hay cambios. La cabecera del móvil no lleva botón de guardar.
- **D6.** **Los colores sueltos se vuelven tokens o reutilizan los de E21 a E28** (`--color-hover`, `--color-segment-selected`). Ningún hex nuevo en las reglas.
- **D7.** **El estado elegido es un tinte**, no el relleno sólido de hoy. El texto queda en `--color-text`, también en claro, y el contraste se comprueba con axe en los dos temas.
- **D8.** **Están diseñados el escritorio y el móvil, en tema oscuro.** El corte es 768 px. El tema claro aplica el mismo diseño con los tokens claros, y la tableta usa el de escritorio. Lo que no está dibujado (error al guardar, sin sesiones, hoja vacía) lo revisa el `ui-reviewer` contra `design-system.md`.

## 1. Problema

La hoja de asistencia ocupa demasiado. Cada socio es una tarjeta alta, que en el móvil apila el nombre sobre los botones y llega a unos 80 px. Con 20 socios hay que bajar mucho durante la sesión. Los totales son tres tarjetas grandes. Los nombres subrayados parecen errores. Y no se ve a quién se ha cambiado sin guardar.

## 2. Usuarios y contexto

- **Coach, en la piscina y desde el móvil:** pasa lista durante o después de la sesión, con prisa y a veces con las manos mojadas.
- **Admin:** pasa lista o la corrige desde el portátil, y abre la ficha de un socio desde la hoja.
- **Hoy lo resuelven así:** bajando por tarjetas altas y fiándose de la memoria para saber qué cambiaron.

## 3. Objetivo y métricas de éxito

- **Objetivo:** que pasar lista a todo un entrenamiento quepa en pocas pantallas y que se vea qué falta guardar.
- **Métricas:**
  - Una fila mide 44 px en escritorio y 56 px en el móvil (hoy unos 80 px).
  - Cada cambio sin guardar se ve en su fila y en el número de Guardar: lo comprueba un test de la pantalla.
  - Nada del comportamiento de hoy se pierde: los tests de la hoja siguen pasando, adaptados a la estructura nueva sin quitarles casos.

## 4. Alcance

**Incluido (v1):**

- La cabecera con Guardar y el número de cambios sin guardar.
- Las fichas de sesión más pequeñas y "Sesiones anteriores" sin subrayado.
- El aviso de guardado como franja teñida.
- Los totales en un solo panel con la barra apilada.
- Filas de una línea: avatar, nombre sin subrayado (con ↗ para el Admin), ficha de posición, punto de sin guardar y el segmento con tinte.
- El móvil: nombre en dos líneas, segmento de solo iconos, fichas de sesión en una fila que se desplaza, y la barra fija de guardar.

**Fuera de alcance (no v1):**

- La cuadrícula de baldosas (#1b).
- Estados nuevos (por ejemplo "justificado") o cambiar qué sesiones admiten asistencia.
- Guardar por fila o guardar solo.
- El resumen de asistencia de un socio (`MemberAttendanceSummary`).

## 5. Requerimientos funcionales

### RF-1 · Las filas (Must)

- **Dado** una fila en escritorio, **cuando** se pinta, **entonces** es `30px | 1fr | auto` de al menos 44 px, con el avatar de 30 px, el nombre (14,5 px, 600, sin subrayado, puntos suspensivos), la ficha de posición en mono y el segmento.
- **Dado** un Admin, **cuando** se pinta el nombre, **entonces** es un enlace a la ficha del socio con el icono `arrow-up-right` de 12 px, que toma el color de acento al pasar el ratón, con el nombre accesible y la comprobación `canLeaveSheet()` de hoy.
- **Dado** un Coach, **cuando** se pinta el nombre, **entonces** es texto, sin icono.
- **Dado** un socio inactivo, **cuando** se pinta, **entonces** lleva la etiqueta Inactivo de hoy.
- **Dado** un socio cuyo estado marcado difiere del guardado, **cuando** se pinta, **entonces** lleva el punto de aviso de 6 px (D2, D3); al volver al estado guardado, desaparece.
- **Dado** el segmento en escritorio, **cuando** se pinta, **entonces** son tres botones de 26 px con icono y texto (Presente `check`, Tarde `clock`, Ausente `x`); el elegido lleva el tinte del 22 % de su color, el texto en negrita y el icono en su color (D7), con `role="group"`, el nombre del socio y `aria-pressed`.

### RF-2 · Cabecera, sesiones, aviso y totales (Must)

- **Dado** la hoja, **cuando** se pinta en escritorio, **entonces** la cabecera lleva "PASAR LISTA" en mono y "{título} · {día} {d} {mes}" en H1, y a la derecha Guardar asistencia (40 px, principal, `floppy-disk`).
- **Dado** cambios sin guardar, **cuando** se pinta, **entonces** Guardar añade un separador, un punto y "{n} sin guardar", que sustituye al "· Cambios sin guardar" de hoy.
- **Dado** las sesiones, **cuando** se pintan, **entonces** son fichas de 30 px con "{día} {d} · {tipo}"; la activa lleva el fondo de seleccionado, el borde de acento y negrita; la fila acaba en "Sesiones anteriores →" sin subrayado.
- **Dado** guardar, **cuando** el servidor acepta, **entonces** sale una franja teñida de éxito con `check-circle` y "Guardado · {n} presentes, {m} tarde, {k} ausentes", con `role="status"`.
- **Dado** los totales, **cuando** se pintan, **entonces** son un solo panel con tres elementos (punto, número en mono de 18 px y nombre), "Vinieron {presentes + tarde} de {total}" a la derecha, y debajo una barra apilada de 6 px por estado, con `aria-live="polite"`.
- **Dado** los grupos, **cuando** se pintan, **entonces** llevan su nombre (VAN, QUIZÁS, SIN RESPUESTA, NO VAN) y su número, y sus filas van en un panel con borde.

### RF-3 · El móvil (Must)

- **Dado** menos de 768 px, **cuando** se pinta, **entonces** la cabecera lleva "PASAR LISTA" y el título de 21 px en hasta dos líneas, sin botón de guardar (D5).
- **Dado** las sesiones en el móvil, **cuando** se pintan, **entonces** son fichas de 36 px en una sola fila que se desplaza de lado, terminada en "Anteriores →".
- **Dado** los totales en el móvil, **cuando** se pintan, **entonces** llevan los números de 16 px y una barra de 5 px.
- **Dado** una fila en el móvil, **cuando** se pinta, **entonces** mide al menos 56 px, con avatar de 32 px y un bloque de texto de al menos 44 px de alto: el nombre de 15 px en hasta dos líneas, el ↗ y el punto detrás, y debajo "{posición} · Inactivo" o "Sin posición".
- **Dado** el segmento en el móvil, **cuando** se pinta, **entonces** es un control unido de unos 106 px con tres botones de solo icono de 34 × 40 px y zona de toque de 44 px (D4), cada uno con `aria-label` de su estado.
- **Dado** cambios sin guardar en el móvil, **cuando** se pinta, **entonces** sale abajo la barra fija con el borde de arriba en aviso al 40 %, el punto, "{n} sin guardar" y Guardar asistencia de 48 px; sin cambios, no sale.
- **Dado** la barra fija, **cuando** sale, **entonces** no tapa la última fila.
- **Dado** 320 px, **cuando** se pinta, **entonces** no hay scroll horizontal fuera de la fila de sesiones.

## 6. Casos borde y estados de error

- **Guardar falla:** el aviso de error de hoy, y los puntos se quedan.
- **Salir con cambios:** la pregunta de hoy.
- **Nombre muy largo:** puntos suspensivos en escritorio, dos líneas y luego puntos en el móvil.
- **Socio sin posición:** sin ficha en escritorio, "Sin posición" en el móvil.
- **Sin sesiones o hoja vacía:** los mensajes de hoy, con el estilo nuevo.
- **Grupo vacío:** no se pinta, como hoy.
- **Idioma:** los textos nuevos en `en.ts` y `es.ts`: "{n} sin guardar", "Vinieron {n} de {total}", "Sin guardar todavía" y "Anteriores".

## 7. UX / UI

- Diseño: `docs/design/design_handoff_attendance/` (#1a escritorio, #2a móvil; capturas 01 a 04).
- Viewports a revisar: 375, 768 y 1440, en claro y oscuro.
- El `ui-reviewer` compara contra las capturas 01 a 04 (Modo A) y revisa contra `design-system.md` lo no dibujado.

## 8. Requerimientos no funcionales

- **Accesibilidad:** WCAG AA, axe sin violaciones en cada estado y en los dos temas (D7), foco visible.
- **Dependencias:** ninguna nueva.

## 9. Preguntas abiertas

Ninguna.

## 10. Descomposición en tickets (para write-ticket)

Todos con `ui-review`. Las capturas de Playwright `asistencia-*` se rehacen ticket a ticket.

| #   | Título propuesto                                                          | Tamaño | Depende de | Auto-merge sugerido |
| --- | ------------------------------------------------------------------------- | ------ | ---------- | ------------------- |
| 1   | Compacta las filas de la hoja de asistencia y marca lo que falta guardar  | M      | ninguna    | No: pantalla nueva  |
| 2   | Rehace la cabecera, las sesiones, el aviso y los totales de la asistencia | M      | 1          | No: pantalla nueva  |
| 3   | Lleva la hoja de asistencia al móvil con la barra de guardar fija         | M      | 1, 2       | No: pantalla nueva  |
