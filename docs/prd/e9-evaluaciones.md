# PRD: E9 · Evaluaciones

**Estado:** borrador · **Fecha:** 23 de septiembre de 2026 · **Épica:** #9

## 1. Problema

El club evalúa a sus jugadores para armar equipos parejos, pero hoy eso vive en
la cabeza de quien entrena o en una hoja de cálculo suya. Nadie más lo ve, se
pierde cuando esa persona deja de entrenar, y el team builder de E10 no tiene de
dónde sacar el nivel de cada quien.

Hace falta que cada miembro tenga una valoración por habilidades, que la
mantenga el personal de entrenamiento, y que ningún jugador vea notas, ni las
suyas ni las de nadie.

## 2. Usuarios y contexto

- **Usuario primario:** un Coach, desde el portátil o el móvil al borde de la
  piscina, después de un entrenamiento. Quiere abrir a alguien, ajustar dos o
  tres barras y salir.
- **Usuario secundario:** un Admin, que además decide qué se mide (las
  categorías del club).
- **Quien no debe ver nada:** el resto de miembros, incluida su propia nota
  (FR-055). Es la regla que sostiene la franqueza de quien evalúa.
- **Hoy lo resuelve así:** no lo resuelve dentro de la plataforma.

## 3. Objetivo y métricas de éxito

Objetivo: que el personal de entrenamiento mantenga la valoración de cada
jugador dentro de la aplicación, y que E10 tenga de dónde leerla.

Métricas:

- Un Coach evalúa a un jugador **en menos de un minuto** desde que abre
  Evaluaciones.
- **Cero** notas visibles para un jugador, comprobado también contra la API
  directa, no solo en pantalla.
- Antes de armar equipos, un Coach puede ver **de un vistazo a quién le falta
  evaluación** (marca en el directorio).

## 4. Alcance

**Incluido (v1)**

- Una evaluación por miembro, que se edita en vivo (ASS-008: sin historial ni
  versiones por temporada).
- Valoración de 1 a 10 por categoría, que nace en 5 (FR-050, FR-051).
- OVR como media de todas las categorías de esa evaluación, a un decimal
  (FR-052).
- Catálogo de categorías configurable por el club: añadir, renombrar y
  desactivar (FR-053). Diez categorías por defecto.
- Una evaluación guardada conserva su conjunto de categorías, y hay una acción
  explícita para ponerla al día con el conjunto actual (FR-053, AC-035).
- Visibilidad estricta para Admin y Coach, aplicada en el servidor y en la base
  (FR-055, NFR-004).
- Aviso de "las notas son privadas" donde un jugador vería una nota (FR-056).
- Marca de "sin evaluar" en el directorio, para quien sí tiene acceso.

**Explícitamente fuera (por ahora)**

- Historial de evaluaciones y comparativas entre temporadas (ASS-008).
- La tarjeta de "position score" ponderado que dibuja el mockup: la v1.1 del SRD
  la sustituyó por las categorías configurables. **No se construye.**
- Que el jugador vea o comente su evaluación.
- Que el jugador se autoevalúe.
- Notas de texto libre sobre el jugador.
- El uso de la nota para armar equipos, que es E10.

## 5. Decisiones tomadas antes de escribir

- **D1 · Las categorías se administran dentro de Evaluaciones**, no en la
  configuración del club. El SRD deja configurarlas a Admin y Coach (FR-053), y
  un Coach no entra en la configuración del club, que es solo de Admin.
- **D2 · Un Coach ve las evaluaciones de todo el club.** FR-055 solo distingue
  entre personal de entrenamiento y jugadores. Atar un Coach a sus grupos sería
  alcance nuevo que el SRD no pide y que hoy no existe en los datos.
- **D3 · El directorio marca a quien no tiene evaluación**, con acceso directo
  a crearla. Es lo que un Coach necesita antes de armar equipos.

## 6. Requerimientos funcionales

### RF-1 · Guardar la evaluación de un miembro · Must

- **Dado** un Coach o un Admin en un miembro sin evaluación, **cuando** la crea, **entonces** nace con todas las categorías activas del club en 5 (FR-051).
- **Dado** una evaluación abierta, **cuando** se ajusta una categoría y se guarda, **entonces** queda guardada y el OVR se recalcula.
- **Dado** una valoración fuera de 1 a 10, o con decimales, **cuando** llega por API, **entonces** responde 400 y no escribe nada.
- **Dado** un miembro dado de baja, **cuando** se intenta evaluarlo, **entonces** se rechaza con el mismo criterio que el resto de escrituras sobre inactivos.
- **Dado** dos personas guardando la misma evaluación a la vez, **cuando** la segunda guarda sobre un estado que ya cambió, **entonces** se le avisa y no pisa el cambio de la primera en silencio.

### RF-2 · El OVR · Must

- **Dado** una evaluación con diez categorías que suman 83, **cuando** se muestra, **entonces** el OVR es 8.3 (AC-021).
- **Dado** una evaluación con once categorías, **cuando** se calcula, **entonces** la media cuenta las once (AC-035).
- **Dado** un OVR con más decimales, **cuando** se muestra, **entonces** sale a un decimal, y el redondeo está fijado por un test con sus casos límite.
- **Dado** una evaluación sin ninguna categoría (todas desactivadas), **cuando** se muestra, **entonces** dice "sin datos" en vez de calcular una media de nada.

### RF-3 · El catálogo de categorías · Must

- **Dado** un club recién instalado, **cuando** se miran sus categorías, **entonces** están las diez por defecto del SRD, en su orden.
- **Dado** un Coach o un Admin, **cuando** añade una categoría, **entonces** aparece en las evaluaciones que se creen a partir de ese momento.
- **Dado** un Coach o un Admin, **cuando** renombra una categoría, **entonces** el nombre nuevo se ve en todas las evaluaciones que la usan.
- **Dado** una categoría desactivada, **cuando** se crea una evaluación nueva, **entonces** ya no aparece.
- **Dado** un nombre repetido dentro del club, **cuando** se guarda, **entonces** se rechaza junto al campo.
- **Dado** un Player o un Committee, **cuando** intentan configurar categorías por pantalla o por API, **entonces** reciben 403.

### RF-4 · Una evaluación guardada no cambia sola · Must

- **Dado** una evaluación guardada con diez categorías, **cuando** el club añade una undécima, **entonces** esa evaluación sigue con sus diez y su OVR anterior (AC-035).
- **Dado** esa misma evaluación, **cuando** se editan sus valoraciones, **entonces** sigue con su conjunto original: editar no migra.
- **Dado** una evaluación con un conjunto viejo, **cuando** alguien usa la acción de ponerla al día, **entonces** las categorías nuevas entran en 5, las desactivadas salen y el OVR se recalcula (FR-053).
- **Dado** una evaluación ya al día, **cuando** se usa esa acción, **entonces** no cambia nada y se dice que ya estaba al día.

### RF-5 · Solo el personal de entrenamiento ve las notas · Must

- **Dado** un Player o un Committee, **cuando** piden cualquier evaluación por API, **entonces** reciben 403, y la base tampoco les devuelve filas.
- **Dado** un Player en su propio perfil, **cuando** lo mira, **entonces** no ve ninguna valoración ni OVR, ni los suyos (AC-023).
- **Dado** ese mismo perfil, **cuando** se muestra, **entonces** lleva el aviso de que las notas solo las ve el personal de entrenamiento (FR-056).
- **Dado** un Coach o un Admin, **cuando** miran el perfil de cualquier miembro, **entonces** sí ven su OVR y sus categorías.
- **Dado** el acceso a una evaluación, **cuando** ocurre, **entonces** la bitácora guarda quién evaluó y sobre quién, sin guardar las notas.

### RF-6 · La pantalla de Evaluaciones · Must

- **Dado** un Coach, **cuando** abre Evaluaciones, **entonces** ve la lista de miembros del club con su OVR, y quién está sin evaluar.
- **Dado** un miembro elegido, **cuando** se abre, **entonces** se ven sus categorías con su valoración y su OVR grande, como el mockup.
- **Dado** esa ficha, **cuando** se pulsa editar, **entonces** se pueden cambiar las valoraciones y guardar sin salir de la pantalla.
- **Dado** un club con muchos miembros, **cuando** se busca por nombre, **entonces** la lista filtra.
- **Dado** un fallo de red al guardar, **cuando** ocurre, **entonces** la pantalla lo dice y deja reintentar sin perder lo ajustado.
- **Dado** un Player o un Committee, **cuando** intentan abrir la pantalla, **entonces** se les niega, como ya hace la frontera con el resto de secciones reservadas.

### RF-7 · Quién falta por evaluar · Should

- **Dado** un Coach o un Admin en el directorio, **cuando** lo mira, **entonces** cada miembro sin evaluación lleva su marca.
- **Dado** esa marca, **cuando** se pulsa, **entonces** lleva a crear la evaluación de esa persona.
- **Dado** un Player o un Committee en el directorio, **cuando** lo miran, **entonces** no ven ninguna marca ni ninguna nota.

## 7. Casos borde y estados de error

- **Miembro sin evaluación:** no se inventa un OVR. Se marca "sin evaluar". El
  5.0 virtual de B4 es cosa del auto balance de E10, no se persiste aquí.
- **Categoría desactivada que estaba en evaluaciones guardadas:** siguen
  mostrándola, marcada como retirada, hasta que alguien ponga esa evaluación al
  día.
- **Todas las categorías desactivadas:** crear una evaluación se rechaza con un
  mensaje que explica que el club no tiene categorías activas.
- **Miembro dado de baja con evaluación:** se conserva, y se ve solo cuando el
  directorio incluye a los inactivos.
- **Nombre de categoría muy largo:** máximo 40 caracteres, para que la pantalla
  no se rompa a 375 px.
- **Dos evaluaciones del mismo miembro:** imposible por diseño, una restricción
  de la base lo impide.

## 8. UX / UI

- **Mockup:** `docs/mockups/evaluations-light.png` y `evaluations-dark.png`.
  Se siguen el OVR grande, la lista de categorías con su barra y su número, el
  selector de jugador y el botón de editar. **La tarjeta "Position score" del
  mockup no se construye** (la v1.1 del SRD sustituyó las ponderaciones por
  posición por las categorías configurables).
- **Flujo principal:** Evaluaciones → elegir jugador → editar → guardar.
- **Viewports:** 375 / 768 / 1440, tema claro y oscuro, inglés y español.
- El mockup es de escritorio: en el móvil, la lista de jugadores y la ficha no
  caben a la vez, y se resuelven como dos pasos.

## 9. Requerimientos no funcionales

- **Seguridad:** FR-055 es la regla más delicada de la plataforma. Se aplica en
  tres capas: RLS en la base, comprobación en el handler y la frontera de rutas.
  Hay un test por capa, y uno que pega a la API como Player.
- **Accesibilidad:** las barras de valoración no pueden ser solo color: llevan
  su número. Axe sin violaciones.
- **Rendimiento:** la lista de Evaluaciones sirve 30 miembros con su OVR en una
  consulta, sin una por miembro.
- **Bitácora:** NFR-010 pide registrar el acceso a datos sensibles.

## 10. Preguntas abiertas

- [ ] ¿El orden de las categorías lo decide el club, o van siempre en el orden
      en que se crearon? Propuesta: lo decide el club, igual que las posiciones
      de E18a.
- [ ] ¿Un Committee debería ver los OVR sin las categorías? El SRD dice que no
      ve nada. Se deja como está, y si el club lo pide se abre después.

## 11. Descomposición en tickets

| #   | Ticket                                                                         | Tamaño | Depende de | auto-merge | ui-review |
| --- | ------------------------------------------------------------------------------ | ------ | ---------- | ---------- | --------- |
| T1  | Guarda las evaluaciones y el catálogo de categorías, con RLS estricta          | M      | —          | No         | No        |
| T2  | Sirve y guarda la evaluación de un miembro por API, con su OVR                 | M      | T1         | No         | No        |
| T3  | Configura las categorías por API: añadir, renombrar, desactivar y poner al día | M      | T1         | No         | No        |
| T4  | La pantalla de Evaluaciones: lista, ficha del jugador y edición                | M      | T2         | No         | Sí        |
| T5  | La pantalla de categorías, dentro de Evaluaciones                              | S      | T3, T4     | No         | Sí        |
| T6  | El aviso de notas privadas y la marca de "sin evaluar" en el directorio        | S      | T2         | No         | Sí        |

Total: **6 tickets**, M. T1 y T2 son la base que E10 necesitará para leer el
nivel de cada jugador.
