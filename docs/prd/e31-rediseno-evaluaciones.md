# PRD: E31 · El rediseño de Evaluaciones

**Estado:** borrador · **Fecha:** 21 de octubre de 2026 · **Autor:** sesión de planificación (Claude Code)

Fuente: el diseño que el dueño hizo con Claude Design, guardado en `docs/design/design_handoff_evaluations/`. Contiene el prototipo `Evaluations Upgrade.dc.html`, su `README.md` de handoff, `support.js` y siete capturas en `screenshots/`. Se construyen **#1a** en escritorio (pestañas Jugadores y Categorías), **#2a** con los jugadores en el móvil y **#2b** con las categorías en el móvil. Es una épica añadida después del plan. Cambia cómo se presenta Evaluaciones de E9 (`src/components/evaluations/*`), añade quién hizo la última edición y amplía la lista con lo que la tabla necesita.

El `README.md` del handoff es parte de este PRD. Tiene las medidas, los colores, los textos y cada estado. Cuando no coinciden, manda lo que dice aquí. Los nombres de las capturas no siempre coinciden con lo que enseñan (la 01 enseña la pestaña Categorías): manda el texto del README.

Las decisiones van de D1 a D12. Salen del handoff y del código actual, y el dueño las ratifica al aprobar este PRD. El dueño ya decidió dos (D6 y D7) en la entrevista del 21 de octubre.

- **D1.** **Categorías pasa a ser una pestaña de Evaluaciones.** La página `/evaluaciones/categorias` deja de existir como pantalla propia y redirige a `/evaluaciones?tab=categories`, para que ningún enlace guardado se rompa.
- **D2.** **Quién gestiona las categorías no cambia:** Admin y Coach, como fijó la D1 de E9 a partir de FR-053. Committee y Player siguen sin entrar a Evaluaciones (`viewEvaluations`).
- **D3.** **El OVR sigue siendo el de FR-052:** la media de las categorías que tiene esa evaluación, a un decimal. Una categoría activa que la evaluación no tiene (se añadió después) sale como "nueva · sin nota", con la raya de vacío, y no cuenta en el OVR. El pie de la tabla dice "OVR = media de las categorías de cada evaluación", no "de las categorías activas" como el handoff.
- **D4.** **Editar una evaluación que no está al día la pone al día al guardar.** En edición se ven las categorías activas del club, en su orden: las que ya tenía con su nota y las nuevas en 5. Las desactivadas no salen. Guardar aplica la puesta al día de hoy (FR-053) y las notas en una sola operación, contra la fecha que se leyó. Cancelar no toca nada. Desaparece el aviso separado de "poner al día".
- **D5.** **El resumen de la plantilla lo calcula el servidor, dentro de la misma respuesta de la lista.** La lista de hoy trae las notas sin su categoría, así que el cliente no puede sacar la media por categoría. Ampliar esa misma consulta con la categoría de cada nota es una lectura, no dos, y no hace falta un `GET /evaluations/summary` aparte: la lista ya se vuelve a pedir después de cada guardado. Si un día el club pasa de varios cientos de jugadores, se separa.
- **D6.** **Se guarda quién hizo la última edición** (decidido por el dueño). La migración `0078` añade `updated_by` a `member_evaluations`, que la crean, la guardan y la ponen al día las mismas funciones de hoy. Las evaluaciones anteriores quedan con `updated_by` vacío y dicen solo "Actualizada {fecha}".
- **D7.** **El resumen no sale en el móvil esta vez** (el handoff lo deja opcional). Won't en esta épica.
- **D8.** **La pestaña, los filtros, el orden y el jugador abierto viven en la URL:** `?tab=`, `?q=`, `?filtro=`, `?posicion=`, `?orden=` y el `?miembro=` de hoy. El enlace "Abrir" de la ficha del socio (`memberEvaluationHref`) sigue funcionando y abre el panel de ese jugador.
- **D9.** **El orden de las categorías se cambia arrastrando con dnd-kit** (`@dnd-kit/sortable`, ya dependencia desde E26), con ↑ y ↓ en el asa desde el teclado y el aviso de cada movimiento para el lector de pantalla. Desaparecen los botones Subir y Bajar.
- **D10.** **Muchos jugadores:** la lista se desplaza dentro de su caja (unos 560 px de alto en escritorio). Con el tamaño de un club (hasta unos 150 miembros) no se virtualiza ni se pagina. Won't en esta épica.
- **D11.** **Los colores sueltos del handoff se vuelven tokens o reutilizan los de E21 a E30** (`--color-hover`, `--color-segment-selected` y los de las tablas de E26). Ningún hex nuevo en las reglas.
- **D12.** **El corte del escritorio es 1024 px.** La rejilla `1fr | 400px` no cabe bien en una tableta: entre 768 y 1023 px se usa el diseño del móvil (la lista y la ficha a pantalla completa). Las categorías usan la tabla de escritorio desde 768 px. El tema claro aplica el mismo diseño con los tokens claros.

## 1. Problema

La pantalla de Evaluaciones es una lista de nombres a la izquierda que no escala más allá de unos pocos jugadores. No hay búsqueda, ni filtro de quién falta, ni orden por OVR. Evaluar a todos obliga a ir de uno en uno y volver a la lista cada vez. Las categorías viven en otra página, con tarjetas grandes y botones Subir y Bajar. Y no se ve cuándo se evaluó a alguien por última vez ni quién lo hizo.

## 2. Usuarios y contexto

- **Coach, desde el portátil:** evalúa a la plantilla después de unos entrenamientos, varias personas seguidas, y quiere saber a quién le falta.
- **Coach o Admin, desde el móvil:** corrige la nota de un jugador al terminar una sesión.
- **Admin:** mantiene el catálogo de categorías y su orden.
- **Hoy lo resuelven así:** bajando por la lista, abriendo a cada jugador, y llevando la cuenta de quién falta de memoria o en otra parte.

## 3. Objetivo y métricas de éxito

- **Objetivo:** que evaluar a toda la plantilla sea un recorrido seguido y que se vea de un vistazo quién falta y qué flojea.
- **Métricas:**
  - Desde "Evaluar a los {n} pendientes", evaluar a cada uno es mover las notas y pulsar Guardar y siguiente, sin volver a la lista: lo prueba un test de la pantalla.
  - Encontrar a un jugador en una plantilla de 100 es escribir parte de su nombre (sin tildes ni mayúsculas).
  - Reordenar una categoría es un solo arrastre, que se guarda en el acto.
  - Nada del comportamiento de hoy se pierde: los tests de E9 (conflictos, valores de 1 a 10, nace en 5, privacidad) siguen pasando, adaptados a la estructura nueva sin quitarles casos.

## 4. Alcance

**Incluido (v1):**

- Quién hizo la última edición (D6) y la lista ampliada con posición, foto, fecha, quién y el resumen de la plantilla (D5).
- En escritorio: las pestañas, la tabla de jugadores con búsqueda, filtros y orden, el panel lateral con el resumen o la ficha del jugador, la edición con OVR en vivo y Guardar y siguiente.
- La pestaña Categorías: tabla compacta, arrastrar para ordenar, renombrar en línea, añadir con comprobación de duplicados, y la lista de desactivadas con Reactivar.
- En el móvil: la lista de jugadores, la ficha a pantalla completa con ↑ y ↓ y la barra fija, y las categorías con hoja inferior y arrastre táctil.

**Fuera de alcance (no v1):**

- El resumen de la plantilla en el móvil (D7).
- Virtualizar o paginar la lista (D10).
- La columna de barras por categoría en la tabla: el handoff la quita a propósito.
- Historial de evaluaciones o comentarios por nota.
- Cambiar quién ve o gestiona las evaluaciones (D2) o la regla del OVR (D3).

## 5. Requerimientos funcionales

### RF-1 · Quién evaluó y la lista ampliada (Must)

- **Dado** la migración `0078`, **cuando** se aplica, **entonces** `member_evaluations` tiene `updated_by` (miembro del mismo club, puede ser nulo), y las funciones que crean, guardan y ponen al día una evaluación lo rellenan con quien llama (D6).
- **Dado** una evaluación guardada antes de la migración, **cuando** se lee, **entonces** `updatedBy` es `null` y no se inventa a nadie.
- **Dado** la lista de Evaluaciones, **cuando** responde, **entonces** cada jugador trae `positionName`, `photoUrl`, el `overall` de D3, `updatedAt` y `updatedBy` (el nombre), o el estado sin evaluar.
- **Dado** la misma respuesta, **cuando** se calcula el resumen (D5), **entonces** trae cuántos están evaluados de cuántos, la media de cada categoría activa entre quienes la tienen, la media de los OVR y los tres evaluados con la fecha más antigua.
- **Dado** un Committee o un Player, **cuando** piden la lista, **entonces** reciben 403, como hoy.

### RF-2 · Las pestañas y la tabla de jugadores (Must)

- **Dado** la pantalla en escritorio, **cuando** se pinta, **entonces** lleva el H1 "Evaluaciones" con su entradilla y las pestañas Jugadores y Categorías con su número, con `role="tablist"` y la pestaña abierta en la URL (D8).
- **Dado** la pestaña Jugadores, **cuando** se pinta, **entonces** lleva el buscador (que ignora tildes y mayúsculas, con el normalizador del directorio), las fichas Todos · n y Sin evaluar · n, el selector de posición y el de orden: Nombre A–Z, OVR de mayor a menor, OVR de menor a mayor y Evaluación más antigua.
- **Dado** el orden por OVR, **cuando** se aplica, **entonces** los sin evaluar van al final; en "Evaluación más antigua", al principio.
- **Dado** la tabla, **cuando** se pinta, **entonces** cada fila es un botón de al menos 52 px con el avatar de 36 px, el nombre y la posición, el OVR en mono (la raya de vacío sin nota) y la fecha o "Sin evaluar" en aviso; el pie dice "{n} de {m} jugadores" y la regla del OVR (D3).
- **Dado** la fila elegida, **cuando** se pinta, **entonces** lleva el fondo de seleccionado, la barra de acento y `aria-current`; pulsarla otra vez cierra el panel y vuelve al resumen.
- **Dado** filtros sin resultados, **cuando** se pinta, **entonces** dice "Ningún jugador coincide." con Borrar filtros.
- **Dado** un cambio de búsqueda, filtro u orden, **cuando** se aplica, **entonces** queda en la URL y sobrevive a recargar.

### RF-3 · El panel lateral: resumen y ficha en lectura (Must)

- **Dado** ningún jugador elegido, **cuando** se pinta el panel, **entonces** enseña el resumen: "{hechos} de {total} jugadores evaluados" con su barra, Evaluar a los {n} pendientes, la media por categoría con la más baja en aviso y su frase, y "Más tiempo sin revisar" con tres jugadores que se abren al pulsar.
- **Dado** todos evaluados, **cuando** se pinta el resumen, **entonces** dice "Todos tienen evaluación." en éxito y no hay botón de pendientes.
- **Dado** Evaluar a los {n} pendientes, **cuando** se pulsa, **entonces** el filtro pasa a Sin evaluar, se borran la búsqueda y la posición, el orden pasa a nombre y se abre el primero en edición.
- **Dado** un jugador elegido, **cuando** se pinta el panel, **entonces** lleva "{i} de {n} en esta lista" (o "No está en el filtro actual"), cerrar, anterior y siguiente (deshabilitados en los extremos), la identidad con el OVR, y las notas de 1 a 10 en el orden de Categorías.
- **Dado** una categoría activa que la evaluación no tiene, **cuando** se pinta en lectura, **entonces** dice "nueva · sin nota" en aviso, con la raya de vacío (D3).
- **Dado** la lectura, **cuando** se pinta el pie, **entonces** dice "Actualizada {fecha} por {nombre}" (o solo la fecha si `updatedBy` es nulo, D6) y Editar notas.
- **Dado** un jugador sin evaluar, **cuando** se pinta, **entonces** sale el recuadro "{nombre} aún no tiene evaluación", la explicación del 5 y Empezar evaluación.
- **Dado** el enlace al perfil, **cuando** se pinta, **entonces** solo sale si quien mira puede abrir la ficha del socio.
- **Dado** `?miembro={id}` en la URL, **cuando** se abre la pantalla, **entonces** el panel enseña a ese jugador (D8).

### RF-4 · La edición y Guardar y siguiente (Must)

- **Dado** Editar notas o Empezar evaluación, **cuando** se pulsa, **entonces** el borde del panel pasa a acento y cada categoría lleva un deslizador nativo de 1 a 10 con su etiqueta; el OVR se recalcula mientras se mueve.
- **Dado** una evaluación que no está al día, **cuando** se edita, **entonces** se ven las categorías activas, con las nuevas en 5, y Guardar la pone al día y guarda las notas en una sola operación (D4).
- **Dado** la edición, **cuando** se pinta el pie, **entonces** lleva Cancelar, Guardar y Guardar y siguiente ›; Guardar y siguiente guarda, abre al siguiente de la lista filtrada ya en edición, y está deshabilitado en el último.
- **Dado** guardar, **cuando** el servidor acepta, **entonces** sale "{nombre} guardado" con `role="status"` durante unos 3 segundos, y la tabla y el resumen se actualizan.
- **Dado** que otra persona guardó antes, **cuando** se guarda, **entonces** sale el aviso de conflicto de hoy y no se pisa nada.
- **Dado** Cancelar, **cuando** se pulsa, **entonces** vuelve a la lectura sin guardar nada.

### RF-5 · La pestaña Categorías (Must)

- **Dado** la pestaña, **cuando** se pinta, **entonces** es una tabla de hasta 680 px con la entradilla del orden, y filas de al menos 46 px con el asa ⋮⋮, el número, el nombre, Renombrar y Desactivar.
- **Dado** el asa, **cuando** se arrastra una fila, **entonces** la fila baja al 45 % de opacidad, una línea de acento marca dónde cae, y al soltar se guarda el orden en el acto y se anuncia "{nombre} movida a {i} de {n} · guardado" (D9).
- **Dado** el asa con el foco, **cuando** se pulsa ↑ o ↓, **entonces** la fila sube o baja un puesto, se guarda y el foco se queda en el asa.
- **Dado** Renombrar, **cuando** se pulsa, **entonces** el nombre pasa a un campo con ✓ y ×; Intro guarda y Esc cancela.
- **Dado** la fila de añadir, **cuando** se escribe un nombre, **entonces** Añadir se habilita; con un nombre que ya existe (activa o desactivada, sin distinguir mayúsculas ni tildes) sale "Ya hay una categoría con ese nombre." y Añadir queda deshabilitado.
- **Dado** añadir, **cuando** el servidor acepta, **entonces** sale "{nombre} añadida · sale como \"sin nota\" en las evaluaciones que ya existen".
- **Dado** Desactivar, **cuando** se pulsa, **entonces** la categoría pasa a "Desactivadas · n", plegable, con Reactivar, que la devuelve al final.
- **Dado** `/evaluaciones/categorias`, **cuando** se abre, **entonces** redirige a `/evaluaciones?tab=categories` (D1).

### RF-6 · Los jugadores en el móvil (Must)

- **Dado** menos de 1024 px (D12), **cuando** se pinta la pestaña Jugadores, **entonces** lleva el título, el buscador de 46 px, las fichas de 36 px que se desplazan de lado, un selector de orden compacto, y filas de al menos 64 px con avatar de 40 px, el nombre en hasta dos líneas, "posición · fecha" o "Sin evaluar" en aviso, el OVR y la flecha.
- **Dado** una fila, **cuando** se toca, **entonces** se abre la ficha a pantalla completa con volver de 44 px, "{i} de {n} en esta lista", ↑ y ↓ de 44 px para el anterior y el siguiente, la identidad con el OVR y una tarjeta con las notas.
- **Dado** la edición en el móvil, **cuando** se pinta, **entonces** cada categoría lleva − [deslizador] + con botones de 44 px, y la barra fija de abajo lleva Cancelar y Guardar y siguiente de 48 px, que dice Guardar en el último.
- **Dado** la lectura en el móvil, **cuando** se pinta, **entonces** la barra fija lleva Editar notas de 48 px.
- **Dado** 320 px, **cuando** se pinta, **entonces** no hay scroll horizontal fuera de la fila de fichas.

### RF-7 · Las categorías en el móvil (Should)

- **Dado** menos de 768 px, **cuando** se pinta la pestaña Categorías, **entonces** lleva la indicación de mantener ⋮⋮ y arrastrar, y una tarjeta con filas de al menos 58 px: asa de 44 px, número, nombre y flecha.
- **Dado** el asa en el móvil, **cuando** se mantiene unos 150 ms y se arrastra, **entonces** la fila se mueve, con `touch-action: none` en el asa.
- **Dado** una fila, **cuando** se toca, **entonces** sube una hoja inferior con el campo Nombre de 48 px, Desactivar (borde de peligro) y Guardar, de 48 px.
- **Dado** añadir en el móvil, **cuando** se pinta, **entonces** es un campo de 48 px con Añadir al lado y el mismo error de duplicado; las desactivadas van en filas de al menos 56 px con Reactivar.

## 6. Casos borde y estados de error

- **Club sin jugadores activos:** la tabla dice que no hay jugadores y el resumen no enseña barras ni pendientes.
- **Club sin categorías activas:** Empezar evaluación se rechaza con el mensaje de hoy (E9); el resumen no tiene medias por categoría.
- **Todos evaluados:** "Todos tienen evaluación." y sin botón de pendientes.
- **Conflicto al guardar:** el aviso de hoy; Guardar y siguiente no avanza.
- **Categoría desactivada:** no sale en edición ni en las medias; la evaluación que la tenía la conserva en lectura hasta que se edite (D4).
- **Último jugador de la lista:** Guardar y siguiente deshabilitado en escritorio; en el móvil el botón dice Guardar.
- **El jugador abierto sale del filtro tras guardar:** el panel sigue con él y dice "No está en el filtro actual"; ‹ y › siguen la lista filtrada.
- **`?miembro=` de alguien que no existe o está inactivo:** el panel enseña el resumen.
- **Nombre de categoría vacío o de más de 40 caracteres:** Añadir y ✓ deshabilitados, como hoy.
- **Muchos jugadores:** la lista se desplaza dentro de su caja (D10).
- **Red caída:** los avisos de error de hoy en cada acción; el orden arrastrado vuelve a su sitio si falla al guardar.
- **Idioma:** todos los textos nuevos en `en.ts` y `es.ts` (lista en el README del handoff, con la regla del OVR de D3).

## 7. UX / UI

- Diseño: `docs/design/design_handoff_evaluations/` (#1a escritorio, #2a y #2b móvil; capturas 01 a 07).
- Viewports a revisar: 375, 768 y 1440, en claro y oscuro.
- El `ui-reviewer` compara contra las capturas (Modo A) y revisa contra `design-system.md` lo no dibujado (errores, sin categorías, sin jugadores).

## 8. Requerimientos no funcionales

- **Seguridad:** FR-055 no cambia. La lista, el resumen y `updated_by` solo llegan a Admin y Coach, por la llave de servicio y acotados al club de quien llama.
- **Rendimiento:** la lista con el resumen es una sola consulta (D5), como pide el PRD de E9.
- **Accesibilidad:** WCAG AA, axe sin violaciones en cada estado y en los dos temas, foco visible, deslizadores con etiqueta, el arrastre con alternativa de teclado y su anuncio.
- **Dependencias:** ninguna nueva (dnd-kit ya está).

## 9. Preguntas abiertas

Ninguna. D6 y D7 las decidió el dueño; el resto se ratifica al aprobar este PRD.

## 10. Descomposición en tickets (para write-ticket)

Todos llevan `ui-review` menos el 1. Las capturas de Playwright `evaluaciones-*` se rehacen ticket a ticket.

| #   | Título propuesto                                                                              | Tamaño | Depende de | Auto-merge sugerido                 |
| --- | --------------------------------------------------------------------------------------------- | ------ | ---------- | ----------------------------------- |
| 1   | Guarda quién evaluó y amplía la lista de Evaluaciones con la posición, la fecha y el resumen  | M      | ninguna    | No: migración y datos de evaluación |
| 2   | Rehace Evaluaciones en escritorio con pestañas y la tabla de jugadores con búsqueda y filtros | M      | 1          | No: pantalla nueva                  |
| 3   | Añade el panel lateral con el resumen de la plantilla y la ficha del jugador en lectura       | M      | 2          | No: pantalla nueva                  |
| 4   | Edita las notas en el panel con el OVR en vivo y Guardar y siguiente                          | M      | 3          | No: escribe evaluaciones            |
| 5   | Pasa las categorías a una pestaña con arrastrar para ordenar y renombrar en línea             | M      | 2          | No: pantalla nueva y escrituras     |
| 6   | Lleva los jugadores de Evaluaciones al móvil con la ficha a pantalla completa                 | M      | 4          | No: pantalla nueva                  |
| 7   | Lleva las categorías al móvil con la hoja inferior y el arrastre táctil                       | S      | 5          | No: pantalla nueva                  |
