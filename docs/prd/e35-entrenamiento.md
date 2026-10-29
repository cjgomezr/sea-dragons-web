# PRD: E35 · Entrenamiento: rutinas y ciclos

**Estado:** aprobado · **Fecha:** 27 de octubre de 2026 · **Autor:** Camilo Gómez, con Claude

Épica #895, añadida después del plan (fila E35 de `docs/plan-maestro.md`). Parte del handoff de Claude Design `docs/design/design_handoff_training/` (Training v1), con los cambios que se acordaron el 27 de octubre de 2026 y que están en las decisiones de abajo. Cuando el handoff y este PRD no coinciden, manda este PRD. La plantilla Excel del handoff (`EXCEL_TEMPLATE.md`) queda para E36.

Depende de E12 (la membresía y su regla de "al día") y de E26 (el estilo de la configuración del club y las tablas que se ordenan arrastrando).

## Principio

**Simple y fácil de usar.** El entrenador planifica en pocos clics y el socio abre la app y ve qué toca hoy y con cuántos kilos. Ante la duda, gana la opción con menos pantallas, menos campos y menos estados. El plan de muestra (`docs/design/design_handoff_training/muestra/plan-uwr-sep-2026.json`) es una muestra para probar que el modelo alcanza, no algo que haya que reproducir exacto.

## Decisiones

- **D1. Una sección nueva, Entrenamiento.** La vista del socio vive en `/entrenamiento` y la de planificar en `/entrenamiento/planificar`. En el escritorio va en el menú lateral con el icono `barbell`; en el móvil va en "Más", sin tocar las cinco pestañas fijas. La API va bajo `/api/v1/training/...`.
- **D2. Ve el plan quien está al día.** Se reutiliza la regla de E12 (`isStandingCurrent`): en prueba, activa o con una exención vigente. Incluye a los Casual que estén al día. Quien no lo está ve la pantalla bloqueada, con un texto según el motivo (pendiente, pago fallido o cancelada) y un botón a Pagos.
- **D3. Planifican el Admin y el Coach.** Committee no: según el SRD es gobierno (eventos, noticias, grupos), no entrenamiento, igual que no reparte equipos. Admin y Coach ven también la vista del socio aunque su membresía no esté al día, porque la necesitan para revisar lo que planifican.
- **D4. Todo pasa por la API.** El handoff supone que la pantalla llama a funciones de la base. Aquí, como en el resto de la app (CON-002), la pantalla llama a `/api/v1/training/...`, la API comprueba el rol y la membresía, y escribe la bitácora con `recordAuditEvent`. Las funciones de la base que hagan falta son solo para `service_role`.
- **D5. Ciclos.** Un ciclo tiene nombre, un evento objetivo opcional con su fecha, y de 1 a 52 semanas. Estados: borrador, activo y archivado. Solo uno activo por club; activar uno archiva el anterior. La semana 1 empieza el lunes de la semana del evento menos (N − 1) semanas. Sin evento, se pide la fecha de inicio y se lleva al lunes de esa semana. "Hoy" y "la semana k" se calculan con la hora de Melbourne (NFR-003).
- **D6. Cada semana tiene una nota y una dosis, las dos opcionales.** La **nota** es un texto corto (hasta 140 caracteres) que ve el socio sobre los días: la fase, el foco o un hito ("Training Camp", "Test 3RM"). La **dosis de la semana** es lo que cambia semana a semana en el ejercicio principal: series, repeticiones y una intensidad, que es un % de la marca o un texto ("RPE 7"). Sustituye a "Macro Vol" y "Macro %" del plan de muestra.
- **D7. Hasta dos rutinas por día.** Cada día de la cuadrícula tiene una rutina, dos o ninguna (descanso). El socio ve las dos, una debajo de la otra.
- **D8. Rutinas.** Una rutina es del ciclo o compartida (sirve en todos). Su único campo es el nombre; el color se asigna solo. Duplicar un ciclo copia sus rutinas propias y deja las compartidas como referencia.
- **D9. Una fila de rutina es un ejercicio o un título de sección.** El título agrupa ("Warm up", "Main 1") y no lleva dosis. Las sesiones de piscina o de ESC se escriben con ejercicios del club ("Front crawl", "Fin kick") y su nota: no hay filas de texto libre sin ejercicio.
- **D10. La carga de una fila es una de cuatro.** Sin carga; **% de una marca**, fijo; **la dosis de la semana**, sobre una marca, que toma series, repeticiones e intensidad de la semana que se mira; o **texto** ("Bodyweight"). Los kilos se redondean a 2,5 kg: `round(marca × % / 100 / 2,5) × 2,5`.
- **D11. Marcas.** El club define las marcas (su mejor levantamiento a una repetición, 1RM, en kg). Cada socio guarda las suyas, y nadie más las ve: ni el Coach ni el Admin, solo cuentas ("3 socios la registraron"). Valores de más de 0 hasta 500, con un decimal como mucho. El valor de una marca no se escribe nunca en la bitácora.
- **D12. La biblioteca de ejercicios se copia a nuestra base.** Se cargan los unos 800 ejercicios de free-exercise-db (dominio público) desde una versión fija del repositorio, con un script aparte, no en una migración: producción reaplica las migraciones en cada merge. Las fotos (unos 33 MB) van a un bucket de Storage. Nombres y consejos en inglés. Actualizar la biblioteca es una decisión: se cambia la versión y se vuelve a correr el script.
- **D13. Ejercicios del club.** Nombre, consejos (uno por línea), enlace o búsqueda de YouTube, y hasta dos fotos (inicio y fin), todo opcional salvo el nombre. Un enlace tiene que empezar por `https://`; cualquier otro texto se usa como búsqueda. Con el campo vacío, un ejercicio del club no tiene "Watch on YouTube": su nombre ("Swim set") no encuentra nada útil, y quien quiera esa búsqueda escribe el nombre en el campo (#937). Uno de la biblioteca con el campo vacío busca su nombre. El nombre no puede repetir el de otro ejercicio de la biblioteca o del club, sin contar mayúsculas ni acentos (`immutable_unaccent` de `0049`).
- **D14. Textos en tú.** El español del handoff está en voseo ("Solo vos ves esto", "Renová"); la app usa tú.
- **D15. Colores como tokens.** Los colores del handoff que no son tokens (`#1d4869`, `#16304a`, `#0f2131`, `#22394d`) se añaden a `globals.css` con su versión clara. La paleta de las rutinas tiene una versión por tema, y el color solo se usa en barras, puntos y fondos tintados, nunca como color del texto.
- **D16. El plan de muestra se carga con un script de un solo uso**, desde `muestra/plan-uwr-sep-2026.json`, para tener un ciclo real con el que probar. Puede aproximarse: lo que no encaje (la sesión opcional de la semana, por ejemplo) va a la nota de la semana.

## 1. Problema

El plan de entrenamiento del club vive hoy en una hoja de Excel y en una web estática aparte. Cada socio pone sus marcas en su navegador y nadie más las ve, lo que está bien, pero el plan no está en la plataforma del club, no se puede cambiar sin tocar un archivo, y no sabe quién tiene la membresía al día. El entrenador no tiene dónde armar rutinas ni repartirlas en semanas sin una hoja de cálculo.

## 2. Usuarios y contexto

- **Socio**, casi siempre desde el móvil y a veces en el propio gimnasio: quiere ver qué toca hoy, cómo se hace cada ejercicio y con cuántos kilos.
- **Coach y Admin**, desde el escritorio para planificar un ciclo entero y desde el móvil para retocar una semana.
- **Hoy lo resuelven así:** el entrenador escribe el macrociclo en Excel y lo convierte en una página estática; cada socio guarda sus marcas en su navegador.

## 3. Objetivo y métricas de éxito

- **Objetivo:** que el entrenador planifique un ciclo en la app y que cada socio al día vea el día de hoy con sus kilos.
- **Métricas:**
  - Desde el inicio de sesión, el socio llega a la rutina de hoy en un toque desde el menú (escritorio) o en dos desde "Más" (móvil).
  - El plan de muestra (16 semanas, piscina, gimnasio y ESC) cabe en el modelo sin ejercicios inventados para cuadrar.
  - La página del socio responde en menos de 1 s en el p95 con un ciclo de 52 semanas.

## 4. Alcance

**Incluido:**

- Las tablas, la seguridad y la API de ciclos, semanas, días, rutinas, filas, ejercicios, marcas del club y marcas de cada socio.
- La biblioteca de free-exercise-db copiada a la base y a Storage.
- La vista del socio: el ciclo, las semanas, los días, la rutina del día con sus kilos, el ejercicio abierto con fotos, consejos y YouTube, Mis marcas y la pantalla bloqueada. En escritorio y móvil.
- Planificar, con cuatro pestañas: Ciclo, Rutinas, Ejercicios y Marcas. En escritorio y móvil.
- La entrada en la navegación.
- El ciclo de muestra cargado.

**Explícitamente fuera (por ahora):**

- La plantilla Excel y su importación (E36).
- Objetivos de tiempo, zonas de pulso, calcular la 1RM desde la 3RM.
- Registrar lo que hizo cada socio o su progreso.
- Avisos o notificaciones del plan.
- Relacionar los días del plan con los eventos del calendario.
- Más de dos rutinas por día, elegir el color de una rutina, tipos de sesión fijos.
- Traducir la biblioteca.

## 5. Requerimientos funcionales

### RF-1 · Datos y seguridad · Must

Siete tablas como en `DATA_MODEL.md`, más las semanas, con los cambios de las decisiones: `club_id` en todas, la ranura del día (1 o 2), la fila de sección, la carga "dosis de la semana" y el nombre normalizado con `immutable_unaccent`.

- **Dado** las tablas nuevas, **cuando** se aplica la migración dos veces, **entonces** no falla ni cambia datos (como pide la skill del proyecto, §7).
- **Dado** un socio, **cuando** pide por la API directamente las marcas de otro socio, **entonces** no las recibe.
- **Dado** un Coach o un Admin, **cuando** pide las marcas de un socio, **entonces** solo recibe cuántos la registraron, nunca los valores.
- **Dado** un socio que no está al día, **cuando** pide por la API la semana del ciclo activo, **entonces** responde 403 con el motivo de la puerta cerrada.
- **Dado** un Player o un Committee, **cuando** intenta crear o cambiar un ciclo, una rutina, un ejercicio o una marca del club, **entonces** responde 403.
- **Dado** un ciclo en borrador o archivado, **cuando** un socio que no es Admin ni Coach lo pide, **entonces** no existe para él (404).

### RF-2 · La biblioteca de ejercicios · Must

- **Dado** el script de carga con una versión fija de free-exercise-db, **cuando** se corre, **entonces** quedan sus ejercicios con nombre, consejos y fotos de inicio y fin, marcados como biblioteca.
- **Dado** que el script ya se corrió, **cuando** se corre otra vez con la misma versión, **entonces** no duplica nada.
- **Dado** la biblioteca cargada, **cuando** alguien intenta cambiar o borrar un ejercicio de la biblioteca por la API, **entonces** no puede.

### RF-3 · La semana del socio · Must

- **Dado** un socio al día y un ciclo activo, **cuando** abre Entrenamiento, **entonces** ve el nombre del ciclo, su evento con la fecha (o "Ends {fecha}"), cuántas semanas faltan y "week {k} of {N}".
- **Dado** la semana actual, **cuando** se pinta, **entonces** ve sus siete días con la rutina o rutinas de cada uno, "Rest" en los días vacíos, y la nota de la semana si la hay.
- **Dado** que hoy tiene rutina, **cuando** abre la página, **entonces** la rutina de hoy está seleccionada; si no, la del primer día de la semana con rutina.
- **Dado** el socio, **cuando** pasa a otra semana con ‹ › o la franja de semanas, **entonces** ve esa semana y un enlace "Back to this week".
- **Dado** un ciclo que todavía no empezó, o que ya terminó, **cuando** se pinta la cabecera, **entonces** dice "starts {fecha}" o "cycle finished".
- **Dado** que no hay ciclo activo, **cuando** abre Entrenamiento, **entonces** ve "No plan yet" y, si es Admin o Coach, un enlace a Planificar.

### RF-4 · La rutina del día con sus kilos · Must

- **Dado** una fila con "% de" una marca y el socio con esa marca, **cuando** se pinta, **entonces** dice los kilos redondeados a 2,5 y, debajo, "{pct}% of {marca} {valor}".
- **Dado** una fila con "dosis de la semana" y la semana con dosis 4 × 5 al 80%, **cuando** se pinta, **entonces** dice "4 × 5" y los kilos del 80% de su marca.
- **Dado** una fila con "dosis de la semana" y la semana con intensidad "RPE 7", **cuando** se pinta, **entonces** dice las series y repeticiones de la semana y "RPE 7".
- **Dado** una fila con "dosis de la semana" y una semana sin dosis, **cuando** se pinta, **entonces** dice las series y repeticiones de la propia fila, sin kilos.
- **Dado** una fila con % y el socio sin esa marca, **cuando** se pinta, **entonces** dice "{pct}%" en aviso y "of {marca} · add your mark".
- **Dado** el socio, **cuando** abre una fila, **entonces** ve las fotos que tenga el ejercicio (0, 1 o 2), los consejos y "Watch on YouTube", que abre en una pestaña nueva el enlace o la búsqueda de su texto. Con el campo vacío, uno de la biblioteca busca su nombre y uno del club no tiene botón (D13).
- **Dado** una fila abierta con % y sin marca, **cuando** escribe su marca en el campo de la fila, **entonces** se guarda y los kilos de todas las filas que la usan cambian al momento.
- **Dado** un título de sección, **cuando** se pinta, **entonces** separa las filas que siguen y no se abre.
- **Dado** un día con dos rutinas, **cuando** se pinta, **entonces** salen las dos, una debajo de la otra.

### RF-5 · Mis marcas · Must

- **Dado** el socio, **cuando** mira Mis marcas, **entonces** ve las marcas del club con su valor, "{n} of {m} set" y "Only you see these".
- **Dado** más de cuatro marcas, **cuando** se pinta, **entonces** salen solo las que usan las rutinas de esa semana, con "Show all {m} marks" para ver el resto.
- **Dado** un valor con coma, **cuando** se guarda, **entonces** se entiende como decimal; **dado** 0, un negativo, más de 500 o más de un decimal, **entonces** no se guarda y lo dice.
- **Dado** el socio que borra el valor, **cuando** sale del campo, **entonces** la marca queda sin valor.

### RF-6 · La pantalla bloqueada · Must

- **Dado** un socio con la membresía pendiente, con el pago fallido o cancelada, **cuando** abre Entrenamiento, **entonces** ve la cabecera del ciclo y una tarjeta con el texto de su motivo y el botón **Renew membership**, que lleva a Pagos.
- **Dado** un Admin o un Coach sin la membresía al día, **cuando** abre Entrenamiento, **entonces** ve el plan (D3).

### RF-7 · Planificar: ciclos · Must

- **Dado** el Coach en Planificar → Ciclo, **cuando** crea un ciclo con nombre, evento y semanas, **entonces** nace en borrador y la línea calculada dice cuándo empieza la semana 1.
- **Dado** un borrador, **cuando** pulsa **Make active**, **entonces** pasa a activo y el que lo era pasa a archivado.
- **Dado** un ciclo, **cuando** pulsa **Duplicate**, **entonces** nace un borrador "{nombre} (copy)" con copias de sus rutinas propias, la cuadrícula apuntando a las copias, sus notas y sus dosis.
- **Dado** que baja las semanas de un ciclo con rutinas en las que sobran, **cuando** guarda, **entonces** se le pide confirmar antes de quitarlas.
- **Dado** los ciclos archivados, **cuando** mira las tarjetas, **entonces** están detrás de "Show archived · {n}".

### RF-8 · Planificar: la cuadrícula, la nota y la dosis · Must

- **Dado** la cuadrícula de un ciclo, **cuando** el Coach elige una rutina en un día, **entonces** se guarda al momento y la celda se tiñe con su color.
- **Dado** un día con una rutina, **cuando** añade una segunda, **entonces** el día queda con dos; no se puede añadir una tercera.
- **Dado** la cuadrícula, **cuando** elige rutina, **entonces** solo puede elegir las de ese ciclo y las compartidas.
- **Dado** una semana, **cuando** el Coach escribe su nota o su dosis, **entonces** se guarda y el socio la ve.
- **Dado** **Copy week 1 to all weeks**, **cuando** lo pulsa, **entonces** copia los días de la semana 1 a las semanas 2 a N − 2 y deja intactas las dos últimas. Con menos de 4 semanas el botón no aparece.

### RF-9 · Planificar: rutinas · Must

- **Dado** el filtro "Routines of", **cuando** elige un ciclo, **entonces** ve sus rutinas y las compartidas al final, sin opción "All".
- **Dado** **+ New routine**, **cuando** la crea, **entonces** nace con un nombre y el siguiente color de la paleta.
- **Dado** el editor, **cuando** busca un ejercicio y lo elige, **entonces** se añade una fila con la última dosis que el club usó para ese ejercicio, o vacía si nunca se usó.
- **Dado** una búsqueda sin resultados, **cuando** pulsa **Create "{q}"**, **entonces** se crea un ejercicio del club con ese nombre y se añade la fila.
- **Dado** el editor, **cuando** añade un título de sección, **entonces** queda una fila de título que se puede arrastrar como las demás.
- **Dado** las filas, **cuando** las arrastra (o usa ↑ ↓ en el asa con el teclado), **entonces** cambian de orden y se guarda.
- **Dado** una rutina usada en la cuadrícula, **cuando** la borra, **entonces** se le pide confirmar con "Used on {n} days. Those days become Rest.".

### RF-10 · Planificar: ejercicios del club · Must

- **Dado** el formulario **New club exercise**, **cuando** guarda un nombre nuevo, **entonces** el ejercicio aparece al momento en la búsqueda de las rutinas.
- **Dado** un nombre que ya existe en la biblioteca o en el club, sin contar mayúsculas ni acentos, **cuando** guarda, **entonces** dice "There is already an exercise with that name.".
- **Dado** un enlace de YouTube que no empieza por `https://`, **cuando** guarda, **entonces** se guarda como texto de búsqueda.
- **Dado** una foto de más de 5 MB o que no es JPEG, PNG ni WebP, **cuando** la sube, **entonces** no se guarda y lo dice.
- **Dado** un ejercicio del club usado en una rutina, **cuando** intenta borrarlo, **entonces** no puede y le dice por qué.

### RF-11 · Planificar: marcas · Must

- **Dado** la pestaña Marcas, **cuando** añade "Power clean", **entonces** la marca aparece para todos los socios.
- **Dado** una marca, **cuando** la renombra, **entonces** las rutinas y los valores de los socios la siguen.
- **Dado** una marca usada en una rutina, **cuando** intenta borrarla, **entonces** el botón está desactivado con "In use: change those routine rows first".
- **Dado** una marca sin usar que registraron 3 socios, **cuando** la borra, **entonces** primero ve "3 members recorded "{name}". Their values will be deleted too. This can't be undone." y, al confirmar, se borran la marca y los valores.

### RF-12 · Entrada en la navegación · Must

- **Dado** cualquier socio con sesión, **cuando** mira el menú, **entonces** ve Entrenamiento (en "Más" en el móvil).
- **Dado** un Admin o un Coach, **cuando** está en Entrenamiento, **entonces** ve **Plan training** en la cabecera; los demás no.

### RF-13 · El ciclo de muestra · Should

- **Dado** el script de un solo uso, **cuando** se corre contra un club, **entonces** queda un ciclo en borrador con las rutinas, la cuadrícula, las notas y las dosis del plan de muestra, aproximado según D16.

## 6. Casos borde y estados de error

- **Sin ciclo activo:** "No plan yet" (RF-3).
- **Sin marcas en el club:** Mis marcas no se pinta, y la carga "% de" no se puede elegir.
- **Rutina vacía:** el socio ve "Nothing here yet" en lugar de las filas.
- **Ciclo de 52 semanas:** la franja de semanas se desplaza de lado en el móvil; la cuadrícula de Planificar tiene su propio desplazamiento.
- **Cambiar la fecha del evento de un ciclo activo:** todas las semanas se mueven con él; los días no cambian de semana.
- **Rutinas compartidas:** cambiarlas cambia también los ciclos archivados que las usan. Se dice en la pista de la pestaña Rutinas.
- **Dos entrenadores a la vez:** gana el último que guarda, celda a celda. No hay bloqueo.
- **Error al guardar** cualquier cosa: el control vuelve al valor anterior y se dice el error, como en Club → Positions.
- **Foto que no carga:** sale el icono genérico.
- **Socio que se va del club:** sus marcas se borran con él.

## 7. UX / UI

- **Mockups:** `docs/design/design_handoff_training/` (README, capturas y `Training v1.dc.html`), con los cambios de las decisiones. Lo que el handoff no dibuja y este PRD añade (la nota y la dosis de la semana, el segundo día, el título de sección) sigue el mismo estilo:
  - la nota va sobre los días, en texto secundario;
  - la dosis va en la fila de la semana de la cuadrícula, en una columna "Dose" con un campo corto;
  - la segunda rutina de un día es un segundo `<select>` que aparece con un "+" en la celda;
  - el título de sección es una fila con el texto en mayúsculas pequeñas, como las cabeceras de tabla.
- **Fallos del mock:** en `d04-coach-cycle.png` todas las celdas dicen "Rest" aunque estén teñidas, y en `m01-member-day.png` "2 of 3 set" se monta sobre el título. Manda el texto del README.
- **Viewports:** 375 / 768 / 1440, y 320 sin desplazamiento horizontal.

## 8. Requerimientos no funcionales

- **Rendimiento:** la página del socio en menos de 1 s en el p95 con un ciclo de 52 semanas; la búsqueda de ejercicios responde en menos de 300 ms.
- **Accesibilidad:** axe sin violaciones; objetivos táctiles de 44 px en el móvil; campos con texto de 16 px en el móvil.
- **Seguridad:** las marcas de cada socio, solo para él (RLS y API); el resto de los datos del plan, solo para socios al día y para Admin y Coach; escrituras solo de Admin y Coach.
- **Bitácora (NFR-010):** cada cambio de ciclos, rutinas, ejercicios y marcas del club. Nunca el valor de la marca de un socio.

## 9. Preguntas abiertas

Ninguna. Las respuestas del 27 de octubre de 2026 están en las decisiones.

## 10. Descomposición en tickets (para write-ticket)

| #   | Título propuesto                                                              | Tamaño | Depende de  | Auto-merge sugerido               |
| --- | ----------------------------------------------------------------------------- | ------ | ----------- | --------------------------------- |
| 1   | Crear las tablas de entrenamiento con su seguridad                            | M      | ninguna     | No: datos privados y RLS          |
| 2   | Cargar la biblioteca de free-exercise-db en la base y en Storage              | M      | 1           | No: carga datos en producción     |
| 3   | API del socio: la semana del ciclo activo, con la puerta de membresía al día  | M      | 1           | No: lógica de acceso              |
| 4   | API del socio: guardar y borrar sus marcas                                    | S      | 1           | No: datos privados                |
| 5   | Vista del socio: cabecera, semanas y días, y la entrada en la navegación      | M      | 3           | No: pantalla nueva (ui-review)    |
| 6   | Vista del socio: la rutina del día con sus kilos y el ejercicio abierto       | M      | 4, 5        | No: pantalla nueva (ui-review)    |
| 7   | Vista del socio: Mis marcas y la pantalla bloqueada                           | M      | 4, 5        | No: pantalla nueva (ui-review)    |
| 8   | API de planificar: marcas del club y ejercicios del club con fotos            | M      | 1, 2        | No: permisos y subida de archivos |
| 9   | API de planificar: ciclos, semanas (nota y dosis) y cuadrícula                | M      | 1           | No: lógica de negocio             |
| 10  | API de planificar: rutinas, sus filas y la última dosis                       | M      | 1           | No: lógica de negocio             |
| 11  | Planificar → Ciclo: tarjetas, datos y acciones del ciclo                      | M      | 9           | No: pantalla nueva (ui-review)    |
| 12  | Planificar → Ciclo: la cuadrícula con dos rutinas por día, la nota y la dosis | M      | 10, 11      | No: pantalla nueva (ui-review)    |
| 13  | Planificar → Rutinas: lista, editor de filas, secciones y arrastre            | M      | 10, 11      | No: pantalla nueva (ui-review)    |
| 14  | Planificar → Rutinas: añadir un ejercicio buscando o creándolo                | S      | 8, 13       | No: pantalla nueva (ui-review)    |
| 15  | Planificar → Ejercicios: lista y ejercicio del club                           | M      | 8, 11       | No: pantalla nueva (ui-review)    |
| 16  | Planificar → Marcas                                                           | S      | 8, 11       | No: borra datos de socios         |
| 17  | Cargar el ciclo de muestra                                                    | S      | 2, 8, 9, 10 | No: carga datos en producción     |

Orden sugerido: 1 → 2 → (3, 4, 8, 9, 10 en paralelo) → 5 → (6, 7, 11) → (12, 13, 15, 16) → 14 → 17.
