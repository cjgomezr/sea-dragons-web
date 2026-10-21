# PRD: E32 · El rediseño de Grupos

**Estado:** borrador · **Fecha:** 21 de octubre de 2026 · **Autor:** sesión de planificación (Claude Code)

Fuente: el diseño que el dueño hizo con Claude Design, guardado en `docs/design/design_handoff_groups/`. Contiene el prototipo `Groups Upgrade.dc.html`, su `README.md` de handoff, `support.js` y siete capturas en `screenshots/`. Se construyen **#1a** (escritorio) y **#2a** (móvil). Es una épica añadida después del plan. Rehace la pantalla de grupos de E4 (`src/components/groups/*`) y amplía su API.

El `README.md` del handoff es parte de este PRD: tiene las medidas, los colores, los textos y cada estado. Cuando no coinciden, manda lo que dice aquí. Cuando una captura y el texto del handoff no coinciden, manda el texto.

Las decisiones van de D1 a D14. Salen del handoff, del código actual y de una respuesta del dueño (D5), y el dueño las ratifica al aprobar este PRD.

- **D1.** **Las reglas de E4 no cambian.** `normalizeGroupName` (de 1 a 60 caracteres, sin caracteres de control), los errores de nombre repetido y de grupo que ya no existe (`isGroupGone`), una sola acción en vuelo a la vez (`usePendingAction`), el orden por `compareNames` y la regla del conteo: los socios dados de baja (`inactive`) y los pendientes de activar (`incomplete`) siguen asignados, pero no cuentan.
- **D2.** **Quién entra no cambia:** Admin, Coach y Committee (`manageGroups`). El Player sigue sin acceso.
- **D3.** **Añadir varios a la vez es un endpoint nuevo, `POST /api/v1/groups/{id}/members` con `{ userIds: string[] }`.** Es idempotente: quien ya estaba no se duplica ni cuenta como error. Responde la lista del grupo y los candidatos actualizados. Un socio dado de baja o de otro club no se asigna y vuelve en una lista de `rejected` con su motivo, sin tumbar al resto. El handoff permite llamar a la asignación de uno en uno mientras no exista. Aquí se construye el endpoint desde el primer ticket, para que la pantalla no tenga que coser fallos parciales.
- **D4.** **`GET /api/v1/groups` añade a cada grupo `usage: { events, posts }` y `previewMembers`:** los tres primeros miembros activos en orden de nombre, cada uno con `{ id, fullName, photoUrl }`. La lista y su conteo salen en una sola petición, sin pedir cada grupo aparte.
- **D5.** **"Escribir a todos" usa el correo del Directorio, no un `mailto:`** (decisión del dueño). Abre el mismo redactor de E19 (`DirectoryEmailComposer`) con los miembros activos del grupo ya elegidos. Respeta el cupo diario, el `requestId` contra los envíos dobles y los permisos de ese envío.
- **D6.** **Solo ven "Escribir a todos" quienes pueden enviar desde el Directorio: Admin y Committee** (`canEmailFromDirectory`, acceso de contacto `full`). **El Coach no ve el botón**, igual que en el Directorio, donde tampoco tiene la acción de correo. Esconderlo es mejor que mostrarlo desactivado, porque al Coach no le falta nada que pueda arreglar. El servidor lo vuelve a comprobar al enviar (403).
- **D7.** **Los destinatarios son los miembros activos del grupo.** Los pendientes de activar no reciben el correo, por la misma razón por la que no cuentan. El redactor dice cuántos son antes de enviar, y lo que el servidor no pudo entregar sale como hoy en la lista de fallidos.
- **D8.** **"Abrir en el directorio" no necesita nada nuevo:** el Directorio ya filtra por `?group={id}` y pinta la ficha "Grupo: {nombre} ×" (`GROUP_QUERY_PARAM` en `directory-query.ts`, filtro reservado a `manageGroups`). El botón es un enlace a esa dirección. El handoff pedía crearlo; ya existe.
- **D9.** **"Audiencia de" es un endpoint nuevo, `GET /api/v1/groups/{id}/audience`.** Devuelve:
  - `events`: los eventos sueltos programados de hoy en adelante (`series_id` nulo, `status = 'scheduled'`) y las series que no han terminado (`ends_on` de hoy en adelante y sin cancelar) cuya audiencia incluye el grupo (`event_groups` y `event_series_groups`);
  - `posts`: las noticias publicadas (`status = 'published'`) cuya audiencia incluye el grupo (`news_post_groups`);
  - cada lista con hasta 5 filas, ordenadas por fecha, y el total, para pintar "+ {n} más".
- **D10.** **Quitar a un socio no pide confirmación**, como dice el handoff: es inmediato, sale un aviso y volver a añadirlo es fácil.
- **D11.** **El aviso de borrar dice lo que de verdad pasa.** Con uso: "Los miembros siguen en el club, pero {n eventos} y {m noticias} perderán esta audiencia". Sin uso: "Sus {n} miembros siguen en el club. No es la audiencia de nada". La frase del handoff "si era su único grupo, solo los Admin lo verán" se mantiene solo si el ticket de la API confirma qué roles siguen viendo un evento o una noticia que se queda sin grupos (hoy las policies `events_select_audience` y `news_posts_select_audience` dejan fuera a los socios). Si no es exactamente "solo los Admin", el texto nombra a quien sí lo ve.
- **D12.** **Sin migración.** El uso, la vista previa y la audiencia salen de las tablas de hoy. La posición y la foto ya están en `members`, y la foto se firma igual que en el Directorio.
- **D13.** **La disposición maestro–detalle (`340px | 1fr`) empieza en 1024 px**, por la misma razón que la D12 de E31: entre 768 y 1023 px el contenido, a la derecha de la barra lateral, no deja sitio a la lista y al panel. De 768 a 1023 px se usa el flujo del móvil: lista, y luego la pantalla del grupo. **Dentro del panel, las dos columnas (miembros `1fr` y "Audiencia de" de 260 px) empiezan en 1280 px.** Por debajo, "Audiencia de" va encima de los miembros, como en el móvil.
- **D14.** **Los colores sueltos se vuelven tokens o reutilizan los de E21 a E31** (`--color-hover`, `--color-segment-selected` y los de las tablas). Ningún hex nuevo en las reglas.

## 1. Problema

Los grupos son las audiencias de los eventos y las noticias, pero la pantalla no ayuda a mantenerlos. Es una lista alta de tarjetas con botones de texto. Para meter a diez personas en un grupo hay que elegirlas de una en una en un `<select>`, diez veces. Y nada dice dónde se usa cada grupo, así que borrar uno es a ciegas.

## 2. Usuarios y contexto

- **Admin y Committee, desde el portátil:** montan los grupos de la temporada (un torneo, una categoría, el social del domingo) y escriben a sus miembros.
- **Coach, a menudo desde el móvil:** ajusta quién está en el grupo de su equipo antes de un entrenamiento o un torneo.
- **Hoy lo resuelven así:** añadiendo de uno en uno, y para escribir al grupo pasan por el Directorio, filtran por grupo y seleccionan a todos.

## 3. Objetivo y métricas de éxito

- **Objetivo:** que montar un grupo y escribirle sea rápido, y que se vea qué se rompe antes de borrarlo.
- **Métricas:**
  - Añadir a 10 personas cuesta un solo envío (hoy, 10).
  - Antes de borrar un grupo se ve cuántos eventos y noticias lo usan: lo prueba un test.
  - Nada de E4 se pierde: los tests de grupos siguen pasando, adaptados a la estructura nueva sin quitarles casos.

## 4. Alcance

**Incluido (v1):**

- La lista compacta con crear arriba, el uso de cada grupo, tres avatares y el conteo.
- El panel del grupo: cabecera con el resumen, renombrar en línea, borrar con aviso, buscar dentro del grupo, quitar con ×.
- Añadir varios a la vez con búsqueda y casillas.
- "Audiencia de", con enlaces a cada evento y noticia.
- "Escribir a todos" con el redactor del Directorio, y "Abrir en el directorio".
- El móvil: lista, pantalla del grupo, selector a pantalla completa y la hoja ⋯ con renombrar y borrar.

**Fuera de alcance (no v1):**

- Cambiar qué es un grupo o quién lo gestiona.
- Grupos anidados, grupos automáticos (por posición o por edad) o grupos privados.
- Cambiar la audiencia de un evento o una noticia desde aquí: "Audiencia de" solo enlaza.
- Un correo que no sea el del Directorio (`mailto:`, listas de correo).
- Virtualizar la lista de miembros: un club tiene decenas de socios.

## 5. Requerimientos funcionales

### RF-1 · La API ampliada (Must)

- **Dado** `GET /api/v1/groups`, **cuando** responde, **entonces** cada grupo trae `usage.events`, `usage.posts` (contados como en D9, sin el tope de 5) y `previewMembers` (hasta 3 miembros activos, en orden de nombre, con `id`, `fullName` y `photoUrl` firmada o nula).
- **Dado** la lista de un grupo y sus candidatos, **cuando** se piden, **entonces** cada fila trae además `positionName` y `photoUrl`, y cada candidato `groupCount`: en cuántos grupos está.
- **Dado** `POST /api/v1/groups/{id}/members` con `{ userIds }`, **cuando** algunos ya estaban, **entonces** no se duplican y la respuesta es 200 con la lista y los candidatos actualizados.
- **Dado** ese POST con un socio dado de baja o de otro club, **cuando** se procesa, **entonces** los demás se asignan y ese vuelve en `rejected` con su motivo.
- **Dado** un grupo que otro acaba de borrar, **cuando** se llama a cualquiera de estos endpoints, **entonces** responde 404, como hoy.
- **Dado** `GET /api/v1/groups/{id}/audience`, **cuando** responde, **entonces** trae los eventos y las noticias de D9, hasta 5 de cada uno, con su total.
- **Dado** un Player, **cuando** llama a cualquiera de estos endpoints, **entonces** responde 403.

### RF-2 · La lista y crear (Must)

- **Dado** un escritorio de al menos 1024 px, **cuando** se abre Grupos, **entonces** sale el H1 "Grupos" con su entrada, y debajo la cuadrícula `340px | 1fr` con la lista a la izquierda.
- **Dado** la fila de crear, **cuando** se escribe un nombre y se pulsa Crear o Enter, **entonces** el grupo se crea, queda elegido, su selector de miembros se abre y sale "{nombre} creado · ahora añade a sus miembros".
- **Dado** un nombre que ya existe (sin distinguir mayúsculas ni tildes), **cuando** se escribe, **entonces** el campo lleva borde de peligro, sale "Ya hay un grupo con ese nombre" y Crear se desactiva. Si aun así el servidor responde `name_taken`, manda el servidor.
- **Dado** la lista, **cuando** se pinta, **entonces** la cabecera dice "{n} GRUPOS" y "MIEMBROS", y cada fila es un `<button>` de al menos 54 px con el nombre, el uso ("2 eventos · 1 noticia" o "Sin usar todavía"), hasta tres avatares de 24 px y el conteo.
- **Dado** una fila elegida, **cuando** se pinta, **entonces** lleva el fondo de elegido, la barra de 3 px y `aria-current`; pulsarla otra vez la deselecciona.
- **Dado** un club sin grupos, **cuando** se pinta, **entonces** sale "Todavía no hay grupos. Crea el primero arriba."

### RF-3 · El panel del grupo (Must)

- **Dado** un grupo elegido, **cuando** se pinta el panel, **entonces** la cabecera lleva el nombre (H2), el resumen "{n} miembros · {k} sin activar · {uso}" (la parte del medio solo si k > 0) y los botones de icono de 38 px: Escribir a todos (D6), Abrir en el directorio (D8), Renombrar y Borrar.
- **Dado** Renombrar, **cuando** se pulsa, **entonces** el título pasa a un campo con ✓ y ×; Enter guarda, Esc cancela y el foco vuelve al botón.
- **Dado** Borrar, **cuando** se pulsa, **entonces** sale el aviso en línea de D11 con Cancelar y "Borrar grupo"; al confirmar, el grupo desaparece de la lista, el panel vuelve a "Elige un grupo" y sale "{nombre} borrado".
- **Dado** la columna de miembros, **cuando** se pinta, **entonces** cada fila (al menos 48 px) lleva avatar de 32 px, nombre, posición, la ficha "Sin activar" cuando aplica y el × de 32 px con `aria-label` "Quitar a {nombre} de {grupo}".
- **Dado** el ×, **cuando** se pulsa, **entonces** el socio sale del grupo sin pedir confirmación (D10) y sale "{nombre} ya no está en {grupo}".
- **Dado** "Buscar en este grupo", **cuando** se escribe, **entonces** filtra por nombre sin distinguir mayúsculas ni tildes; sin resultados dice "Nadie de este grupo se llama así".
- **Dado** un grupo sin miembros, **cuando** se pinta, **entonces** dice "Todavía no tiene miembros. Usa «Añadir miembros» para elegir a varios a la vez."
- **Dado** ningún grupo elegido, **cuando** se pinta el panel, **entonces** es una caja de borde discontinuo con "Elige un grupo para ver y gestionar sus miembros."

### RF-4 · Añadir varios a la vez (Must)

- **Dado** "Añadir miembros", **cuando** se pulsa, **entonces** se abre el selector en línea con "Buscar socios que no están en este grupo" y filas de al menos 42 px con casilla, avatar de 28 px, nombre y "posición · en {n} grupos".
- **Dado** el selector, **cuando** se marcan socios, **entonces** el pie dice "{n} elegidos" y "Añadir {n} miembros" se activa; sin nada marcado dice "{m} socios no están en este grupo" y el botón está desactivado.
- **Dado** "Añadir {n} miembros", **cuando** se pulsa, **entonces** se manda un solo POST (D3), el selector se cierra, la lista se actualiza y sale "{n} añadidos a {grupo}".
- **Dado** una respuesta con `rejected`, **cuando** llega, **entonces** se añade a los demás y el aviso dice quiénes no se pudieron añadir y por qué.
- **Dado** un grupo que ya tiene a todo el club, **cuando** se abre el selector, **entonces** dice "Todo el club está ya en este grupo."; una búsqueda sin resultados dice "Nadie se llama así."

### RF-5 · Audiencia de (Must)

- **Dado** un grupo usado, **cuando** se pinta "AUDIENCIA DE", **entonces** cada evento y noticia es una fila con su icono (calendario sobre tinte de acento, periódico sobre tinte de éxito), el título y su fecha ("Semanal · mié 18:00", "sáb 24 oct" o "Publicada el 12 oct"), y enlaza a su página.
- **Dado** más de 5 eventos o noticias, **cuando** se pinta, **entonces** salen 5 de cada uno y "+ {n} más".
- **Dado** un grupo sin uso, **cuando** se pinta, **entonces** dice "Sin usar todavía. Elígelo como audiencia al crear un evento o una noticia."

### RF-6 · Escribir a todos y Abrir en el directorio (Must)

- **Dado** un Admin o un Committee, **cuando** pulsa Escribir a todos, **entonces** se abre el redactor del Directorio con los miembros activos del grupo como destinatarios (D5, D7), y enviar respeta el cupo y los avisos de hoy.
- **Dado** un Coach, **cuando** se pinta la cabecera, **entonces** no sale Escribir a todos (D6).
- **Dado** un grupo sin miembros activos, **cuando** se pinta, **entonces** Escribir a todos está desactivado, con "Nadie a quien escribir" en su `title`.
- **Dado** Abrir en el directorio, **cuando** se pulsa, **entonces** lleva a `/directorio?group={id}`, con el Directorio filtrado y su ficha de grupo.

### RF-7 · El móvil (Must)

- **Dado** menos de 1024 px, **cuando** se abre Grupos, **entonces** sale la lista: título de 24 px, fila de crear de 46 px y filas de al menos 66 px con nombre, "{n} miembros · {uso}", tres avatares de 26 px y una flecha.
- **Dado** una fila, **cuando** se pulsa, **entonces** se abre la pantalla del grupo con su barra (volver, nombre, ⋯), el resumen, los dos botones de 46 px (Escribir a todos, solo para quien puede; y Directorio), la tarjeta "Audiencia de", la búsqueda de 46 px, los miembros (filas de al menos 60 px con × de 44 px) y "Añadir miembros" fijo abajo (50 px).
- **Dado** "Añadir miembros", **cuando** se pulsa, **entonces** se abre el selector a pantalla completa: Cancelar y "Añadir a {grupo}" arriba, búsqueda de 46 px, filas de al menos 58 px con casillas de 22 px y "Añadir {n} miembros" fijo abajo.
- **Dado** ⋯, **cuando** se pulsa, **entonces** sale una hoja inferior con "Renombrar grupo" (pasa a un campo de 48 px con Guardar) y, tras una línea, "Borrar grupo" en peligro, que cambia la hoja al aviso de D11 con Cancelar y Borrar (48 px). El foco queda dentro hasta cerrarla.
- **Dado** 320 px, **cuando** se pinta cada pantalla, **entonces** no hay scroll horizontal.

### RF-8 · Avisos (Should)

- **Dado** cualquier cambio (crear, renombrar, borrar, añadir, quitar), **cuando** termina, **entonces** sale un aviso con `role="status"` que se va a los 3 segundos.

## 6. Casos borde y estados de error

- **Sin grupos:** la lista dice cómo empezar y el panel no se pinta (RF-2).
- **Grupo vacío:** su panel lo dice y Escribir a todos se desactiva (RF-3, RF-6).
- **Todo el club ya está en el grupo:** el selector lo dice (RF-4).
- **Nombre repetido:** aviso en el cliente; el `name_taken` del servidor manda (RF-2, D1).
- **Grupo borrado mientras está abierto:** cualquier acción responde 404; la pantalla quita el grupo, vuelve a "Elige un grupo" y lo explica, como hoy hace `isGroupGone`.
- **Fallos parciales al añadir:** el POST devuelve `rejected` y el aviso nombra a quien no entró (D3).
- **Socios sin correo o que no se pudieron entregar:** salen en la lista de fallidos del redactor, como en el Directorio.
- **Cupo de correo agotado:** el redactor lo dice como hoy y no envía.
- **Pendientes de activar:** siguen en el grupo con su ficha "Sin activar", no cuentan y no reciben el correo (D1, D7).
- **Muchos miembros:** la columna se desplaza sola, con unos 440 px de alto en escritorio. No hay virtualización.
- **Audiencia de más de 5:** cinco de cada uno y "+ {n} más" (D9).
- **Una acción en vuelo:** no se lanza otra (`usePendingAction`); los botones lo muestran.
- **Dos personas editan a la vez:** la última escritura manda; un grupo que el otro borró responde 404 (arriba).

## 7. UX / UI

- Mockups: `docs/design/design_handoff_groups/screenshots/` (01 a 07) y el `README.md` del handoff, que manda sobre las capturas.
- Flujo principal: crear un grupo → se abre su selector → marcar a varios → añadir → escribirles desde el panel.
- Viewports: 320 / 375 / 768 / 1024 / 1440 (D13).
- Textos en `en.ts` y `es.ts`, con las claves del handoff ("Copy / i18n"). Se quitan los botones de texto viejos (Renombrar, Borrar, Cerrar) y el selector de uno en uno.

## 8. Requerimientos no funcionales

- **Rendimiento:** la lista de grupos con su uso y su vista previa sale en una petición (D4); "Audiencia de" en otra, al elegir el grupo.
- **Accesibilidad:** axe sin violaciones en claro y oscuro; objetivos táctiles de al menos 44 px en el móvil; foco visible; la hoja ⋯ y el selector a pantalla completa retienen el foco.
- **Seguridad:** todo sale del club de quien llama; la frontera reserva `/api/v1/groups` a `manageGroups` y el correo vuelve a comprobar el rol al enviar.

## 9. Preguntas abiertas

- [ ] El texto de D11 cuando un evento o una noticia se queda sin grupos: lo cierra el ticket 1 al comprobar quién lo sigue viendo.

## 10. Descomposición en tickets (para write-ticket)

| #   | Título propuesto                                                                                    | Tamaño | Depende de | Auto-merge sugerido                                       | ui-review |
| --- | --------------------------------------------------------------------------------------------------- | ------ | ---------- | --------------------------------------------------------- | --------- |
| 1   | Añade a la lista de grupos su uso y la vista previa, y a los miembros su posición y su foto         | M      | ninguna    | No: cambia la API y lo que ve cada rol                    | No        |
| 2   | Añade varios socios a un grupo de una vez y la lista de dónde se usa cada grupo                     | M      | 1          | No: endpoint nuevo de escritura y de lectura con permisos | No        |
| 3   | Rehace Grupos en escritorio con la lista compacta, el panel del grupo, renombrar y borrar con aviso | M      | 1          | No: rehace la pantalla y el borrado                       | Sí        |
| 4   | Añade el selector para meter a varios socios a la vez en el panel del grupo                         | M      | 2, 3       | No: escritura nueva                                       | Sí        |
| 5   | Añade al panel la audiencia del grupo, Escribir a todos y Abrir en el directorio                    | M      | 2, 3       | No: toca el envío de correo y sus permisos                | Sí        |
| 6   | Lleva Grupos al móvil con la pantalla del grupo y la hoja ⋯                                         | M      | 4, 5       | No: pantalla nueva con acciones de borrado                | Sí        |
| 7   | Lleva el selector de miembros al móvil a pantalla completa                                          | S      | 6          | No: escritura en el móvil                                 | Sí        |

El 4 y el 5 pueden ir en paralelo: tocan partes distintas del panel.
