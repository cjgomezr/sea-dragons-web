# 🏭 Guía de la Fábrica, explicada fácil

Esta es tu fábrica de software: tú decides **qué** construir, y ella se encarga
del **cómo**. Tú eres el arquitecto que aprueba los planos y recibe las llaves;
la fábrica pone los obreros, el inspector de calidad y el capataz.

---

## Parte 1: Lo que se hace UNA sola vez por computador

(Si ya usaste la fábrica en este computador, sáltate esta parte.)

1. Instalar las herramientas: **git**, **node**, **gh** (con `gh auth login`),
   **jq** y **claude** (Claude Code).
2. La primera vez que arranques un proyecto, la fábrica instala sola los
   "agentes revisores" en tu computador (carpeta `C:\Users\TU_USUARIO\.claude\`).
   Si ya existía un `settings.json` ahí, hay que fusionarlo a mano una vez
   (pedirle ayuda a Claude con eso es válido).
3. **El token de la nube** (para que la fábrica trabaje sin tu PC): corre
   `claude setup-token` en la terminal, autoriza en el navegador, y guarda el
   token que te da en un lugar seguro (un gestor de contraseñas). Es de tu
   cuenta y sirve para todos tus proyectos; se genera UNA vez.

> 💡 Truco: si algo recién instalado "no se reconoce", cierra la terminal y
> abre una nueva. Las terminales viejas no ven los programas nuevos.

---

## Parte 2: Empezar un proyecto NUEVO

**Comando 1** (en la terminal, donde guardas tus proyectos):

```
gh repo create mi-app --template TU_USUARIO/fabrica-template --private --clone
cd mi-app
```

Esto crea el repo en GitHub copiando tu plantilla, y lo descarga a tu disco.

**Comando 2:**

```
claude "/bootstrap una app de [lo que quieras] con [el stack que quieras]"
```

Ejemplo real: `claude "/bootstrap una app de recetas colombianas con Vite + TypeScript"`

También puedes pasarle un documento entero (un SRD, un brief largo) o **no
pasarle nada**. En ese caso te entrevista.

**¿Tienes diseños?** Pásaselos también: un HTML, un PDF, capturas, lo que
exportes de Figma. No es adorno: los guarda en `docs/mockups/`, saca de ahí
los colores y la tipografía para `design-system.md`, y a partir de ese momento
el revisor visual **compara cada pantalla contra tu diseño** en vez de revisarla
solo con reglas generales. Sin diseño funciona igual, pero con menos filo.

`/bootstrap` te lleva de la mano en **5 fases, con 2 paradas** donde espera tu
respuesta:

| Fase                | Qué hace                                                                                                                                                                                                   | ¿Te pregunta?        |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| **0 · Diagnóstico** | Revisa el repo, lee lo que le mandaste (o te hace 4 preguntas si fue poco) y te muestra **la propuesta de cáscara**: a qué repo va a escribir, qué herramientas instala, qué construye y **qué NO**        | **SÍ, aquí decides** |
| 1 · Setup mecánico  | Dependencias, Playwright, las 13 etiquetas, modelos                                                                                                                                                        | no, te reporta       |
| 2 · La cáscara      | El esqueleto mínimo que camina, con sus tests (TDD), y rellena la configuración                                                                                                                            | no, te reporta       |
| 3 · Verificación    | Corre tests, lint, tipos y el servidor de verdad. Commit y push                                                                                                                                            | no, te reporta       |
| **4 · Handoff**     | Te dice qué sigue y te deja el comando listo: planear con `/write-prd` (te sugiere hacerlo en terminal aparte, y te explica por qué, pero si prefieres seguir ahí, se sigue). También te ofrece el tablero | **SÍ, aquí decides** |

Dos cosas importantes de la Fase 0: la **cáscara** es a propósito mínima (el
andamio y las herramientas que tu proyecto sí o sí necesita, nada más). Lo
demás lo construyen los tickets, uno por uno y revisados. Y la lista de
**"qué NO incluye"** es tu red de seguridad: si ves ahí algo que esperabas
tener ya, dilo antes de aprobar.

Lo que hablen en la Fase 0 **queda escrito en el repo**: tu documento en
`docs/srd.md` si le pasaste uno, o `docs/brief.md` con tu idea y las respuestas
de la entrevista si arrancaste con una frase. Por eso el handoff de la Fase 4
te da el comando ya apuntando a ese archivo. Abres la terminal nueva y sigues
donde ibas, sin que nadie te vuelva a preguntar lo mismo.

> 🛑 **`/bootstrap` nunca se pone a programar tickets solo.** Termina
> entregándote el terreno listo y el comando del siguiente paso. Arrancar la
> fábrica es siempre una decisión tuya (Paso 3 de la Parte 3).

El repositorio de GitHub ya lo creaste tú con el Comando 1; bootstrap solo
verifica y te dice a qué repo va a escribir. El **tablero** (que es otra cosa)
no se crea solo: te lo ofrece al final, en la Fase 4.

**Comando 3: las DOS llaves de la nube** (los secretos NO se copian con la
plantilla, por seguridad; hay que plantarlos en cada repo, y son 20 segundos):

```
gh secret set CLAUDE_CODE_OAUTH_TOKEN        # la bolsa del turno NOCTURNO (cron)
gh secret set CLAUDE_TOKEN_TU_USUARIO        # TU token personal (menciones @claude y ready-for-dev)
```

En ambos pega el token que guardaste en la Parte 1 (sí, el mismo valor: son
dos cerraduras, una llave). El nombre del segundo lleva tu usuario de
GitHub en MAYÚSCULAS (guiones → `_`): ej. `CLAUDE_TOKEN_CJGOMEZR`.

¿Por qué dos? El común paga solo el trabajo que nadie pidió (el cron); todo
lo que pide una persona se cobra a SU token, así que en equipo nadie
subsidia a nadie (Parte 8). Verifica con `gh secret list` que estén los dos.

> ⚠ Si tu usuario no es el que viene en el template: revisa que el mapa de
> credenciales de los workflows (`.github/workflows/claude-backlog.yml` y
> `claude-mentions.yml`, paso "Resolver credencial del actor") tenga tu
> línea `TOK_TU_USUARIO: ${{ secrets.CLAUDE_TOKEN_TU_USUARIO }}`, o pídele
> a Claude que la agregue.

Sin esto, la fábrica nocturna y las menciones @claude no funcionan (el
Claude que corre en GitHub no tiene cómo autenticarse). También necesitas
**una vez por cuenta** la GitHub App de Claude instalada:
github.com/apps/claude → Install → All repositories.

**El tablero visual (opcional):** dile a Claude:

> Crea un GitHub Project para este repo, vincúlalo y corre project-setup.sh

Solo hay 2 cosas que Claude no puede hacer por ti (limitaciones de GitHub):

- Correr `gh auth refresh -s project,repo` (te pide autorizar en el navegador).
- Activar 3 interruptores en la página del Project (⚙ → Workflows):
  **Item added → Todo**, **Item closed → Done**, **Pull request merged → Done**.
  Y agrupar la vista por **Parent issue**.

---

## Parte 3: Crear una funcionalidad (el ciclo que repetirás siempre)

### Paso 1: Planear 🧠

Abre Claude en el repo y ponlo en modo plan (tecla **Shift+Tab** hasta que
diga `plan`). Luego pídele:

```
/write-prd [descripción de lo que quieres, con tus palabras]
```

Claude te hará unas pocas preguntas (tú eres el dueño del producto, así que
responde lo que quieres). Después te muestra un **PRD**: el documento que
dice qué se va a construir y cómo se sabrá que quedó bien.

**Léelo con calma.** Este es TU momento de mayor poder: cambiar algo aquí es
gratis; cambiarlo después cuesta. Si algo no te gusta, díselo con tus
palabras y lo reescribe.

### Paso 2: Aprobar los tickets 🎫

Al aprobar el PRD, Claude te ofrece crear los **tickets** (las tareas) en
GitHub. Antes de crear nada te muestra una tabla resumen y espera tu
confirmación. Confirmas → crea un "épico" (tarea padre) con sub-tareas, cada
una con sus criterios de aceptación y sus dependencias.

**Aquí decides también la confianza:** los tickets mecánicos y de bajo riesgo
(datos, estilos, refactors con buenos tests) pueden llevar la etiqueta
**`auto-merge`**: sus PRs se mergearán solos al quedar verdes, para que la
cadena avance de noche sin ti. Dilo en la confirmación:

> Confirmo. Ponle auto-merge a los tickets 1 y 5; el 2 y el 3 los reviso yo.

Los delicados (lógica de negocio, seguridad) déjalos sin etiqueta: te
esperarán.

> 🛑 **Crear los tickets NO arranca nada.** Al terminar, Claude te resume qué
> creó y se detiene, aunque el siguiente ticket sea obvio. La fábrica solo se
> pone a programar cuando TÚ la sueltas (Paso 3), cuando etiquetas un issue
> `ready-for-dev`, o de noche con el cron. Si alguna vez ves que empieza sola,
> es un bug de la plantilla: la regla está escrita en `CLAUDE.md`, sección
> _Autonomy boundary_.

### Paso 3: Soltar la fábrica 🤖

En una terminal **Git Bash** (en VS Code: panel de terminal → flechita ▼ →
Git Bash), parado en la carpeta del repo:

```bash
bash scripts/process-backlog.sh
```

El script busca la siguiente tarea disponible y lanza un Claude que la
trabaja solo (con permisos `auto` puede pedirte confirmación alguna vez; para
cero interrupciones, ábrelo en el devcontainer): marca la tarea "en progreso", escribe los tests PRIMERO,
implementa hasta que pasen, se hace revisar por el agente revisor hasta
recibir APPROVED, y abre un **Pull Request en borrador**. Tú no haces nada.

### Paso 4. Tu único trabajo: revisar y mergear 👑

Cuando llegue el PR: ábrelo en GitHub, mira los cambios ("Files changed"),
y si te gusta: botón **"Ready for review"** → botón **"Merge pull request"**.
(Los tickets con `auto-merge` se saltan este paso solos, porque tú se lo
permitiste al etiquetarlos.)

Al mergear pasa la magia en cadena: la tarea se cierra sola → el tablero la
pasa a Done → la barra del épico avanza → y la siguiente tarea queda
desbloqueada.

### Paso 5: Repetir

¿Quedan tareas? Corre el script otra vez (Paso 3). ¿Se acabaron? Tu
funcionalidad está lista. ¿Quieres otra funcionalidad? Vuelve al Paso 1.

```
PLANEAR → APROBAR → SOLTAR LA FÁBRICA → MERGEAR → REPETIR
```

---

## Parte 4: La fábrica sin tu computador (nube y celular) ☁️📱

Con las dos llaves configuradas (Parte 2, comando 3), la fábrica también corre en
los servidores de GitHub, y tu PC puede estar apagado. Tienes tres gatillos:

1. **Etiqueta `ready-for-dev`:** pónsela a un issue (desde la app de GitHub
   del celular si quieres) → GitHub arranca una máquina y lo procesa.
2. **El turno nocturno:** cada noche, el workflow procesa automáticamente
   hasta 5 tareas elegibles del backlog. Combinado con `auto-merge`, una
   cadena entera puede avanzar mientras duermes; los PRs sin etiqueta te
   esperan para el desayuno.
3. **Menciones `@claude`:** comenta `@claude ...` en cualquier issue y te
   responde en el mismo hilo. Sirve hasta para planear desde el celular:
   > @claude sigue la skill .claude/skills/write-prd: hazme las preguntas
   > aquí en comentarios y no crees issues hasta que yo confirme.

Todo se observa en la pestaña **Actions** del repo (los logs de cada
corrida). Los PRs se revisan y mergean desde el navegador del celular sin
problema.

---

## Parte 4.5. Los modelos: cuánta potencia usa cada pieza 🎛️

Cada pieza de la fábrica puede usar un modelo distinto de Claude, y eso
controla directamente cuánto consumes. Todo se configura en UN archivo en la
raíz del repo: **`factory-models.json`**.

| Pieza          | Qué es                               | Recomendado                                     |
| -------------- | ------------------------------------ | ----------------------------------------------- |
| `worker`       | El obrero que implementa cada ticket | `sonnet`                                        |
| `codeReviewer` | El inspector de código               | `sonnet`                                        |
| `uiReviewer`   | El inspector visual                  | `sonnet`                                        |
| `planning`     | Tus sesiones de PRD y plan maestro   | `opus` (lo eliges tú con `/model` en la sesión) |

La regla de dedo: **sonnet para el trabajo diario** (rápido y económico, muy
capaz), y **opus solo donde el error cuesta caro** (el PRD de pagos, el
epic de permisos, el plan maestro). Subes la perilla para ese epic y la
vuelves a bajar.

Para cambiar: edita `factory-models.json`, corre
`bash scripts/apply-models.sh` (propaga el cambio a los agentes), y
commitea ambos. El worker y los workflows de la nube leen el JSON
directamente y no necesitan nada más. `/bootstrap` te pregunta esto al crear
cada proyecto.

> 💡 Ojo también con tu modelo personal: si tu `settings.json` usa la
> variante `[1m]` (contexto de 1 millón), cada sesión consume mucho más
> rápido. Para el trabajo de fábrica, la variante estándar sobra.

**Revisión visual: cuándo mira el ui-reviewer.** Los tests de píxeles de
Playwright corren siempre y no gastan tokens. Lo caro es el agente
ui-reviewer _mirando_ screenshots. Eso se controla en el mismo
`factory-models.json`, clave `review.uiReview`:

- `"label"` (default): solo revisa los tickets que lleven la etiqueta
  **`ui-review`**. La fábrica la sugiere para pantallas nuevas y cambios de
  layout, y tú la ratificas en el gate (igual que auto-merge).
- `"always"`: revisa todo ticket que toque UI (máxima calidad visual).
- `"off"`: nunca (útil al principio de una app, cuando la UI es provisional).

Cambiar este valor no necesita `apply-models.sh`: se edita y ya. También
puedes ponerle o quitarle la etiqueta `ui-review` a cualquier ticket desde
la app de GitHub, como con auto-merge.

## Parte 4.7: El tablero es tu panel de control 🎛️

Arrastrar una tarjeta (no-épica) a la columna **Todo** significa "quiero esto
trabajado". Al inicio de cada corrida, el script lo traduce a la cola real: le
pone `pending` y, si el issue estaba cerrado o marcado `needs-human`, lo
reabre/reintenta. No necesitas comandos.

> ⚠ Por eso: **no arrastres a Todo tarjetas ya terminadas** que no quieras
> rehacer. (Si pasa, la fábrica detecta que ya está implementado, lo comenta y
> vuelve a cerrar el issue, pero gasta una corrida.)

**Los talleres de los obreros.** Cada ticket se trabaja en una copia aparte del
repo (un _worktree_) dentro de `.claude/worktrees/impl-N`. No se commitean y no
estorban, pero ocupan disco. Para ver y limpiar los viejos:

```bash
git worktree list
git worktree remove .claude/worktrees/impl-15 --force   # ya mergeado
```

## Parte 5. ¿Y si algo sale mal?

- Si la fábrica se atasca con una tarea (lo intenta varias veces y no puede),
  le pone la etiqueta **`needs-human`** y deja un comentario explicando qué
  intentó. Búscalas con: `gh issue list --label needs-human`
- La fábrica no puede terminar con tests fallando mientras le queden intentos
  (el "Stop hook" la bloquea). Si agota los intentos, el portero la deja salir
  pero con obligación de marcar `needs-human` y prohibición de abrir/marcar
  listo el PR. Y solo mergea sola donde TÚ pusiste `auto-merge`. Y
  cualquier merge se deshace con el botón "Revert" del PR; git nunca olvida.
- Si un comando te falla en la terminal, copia el error completo y pégaselo a
  Claude: "me salió este error, ayúdame".

---

## Parte 6: Los AGENTES (los empleados especialistas)

Un agente es otro Claude con personalidad e instrucciones propias, que el
Claude principal contrata para tareas específicas. Son archivos `.md` que
puedes abrir y leer.

**Dónde viven:** `C:\Users\TU_USUARIO\.claude\agents\` (para todos tus
proyectos) y también en `.claude/agents/` dentro del repo.

| Agente            | Qué hace                                                                                                                                                                                                                                                                                                                                                         |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **code-reviewer** | El inspector de calidad del código. Recibe qué se pidió y qué se construyó, y busca errores, casos olvidados, problemas de seguridad y violaciones de los estándares. Reporta con severidad (Critical/High/Medium/Low) citando archivo y línea. Cuando todo está bien dice la palabra mágica: `APPROVED`. Máximo 3 rondas, no se queda discutiendo para siempre. |
| **ui-reviewer**   | El inspector visual: tiene "ojos". Toma capturas de pantalla de la app en 3 tamaños (celular, tablet, computador) y las mira de verdad. Si hay un diseño de referencia, compara contra él; si no, revisa contra la lista de reglas de `design-system.md` (alineación, espaciados, contraste, accesibilidad). También dice `APPROVED` cuando aprueba.             |

---

## Parte 7: Las SKILLS (los procedimientos expertos)

Una skill es un manual de instrucciones que Claude carga cuando lo necesita.
Se invocan escribiendo `/nombre` dentro de Claude. También son archivos que
puedes leer y editar.

**Dónde viven:** `.claude/skills/` dentro de cada repo (vienen con la
plantilla).

| Skill             | Qué hace                                                                                                                                                                                                                                                                                                                                |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **/bootstrap**    | El arranque guiado, en 5 fases con 2 paradas: diagnostica el repo, te entrevista (o lee tu SRD), te propone la cáscara y **espera tu ok**; luego instala, construye el esqueleto con tests, verifica, commitea, y termina preguntándote qué sigue. Una vez por proyecto. Nunca se pone a trabajar tickets solo.                         |
| **/write-prd**    | El entrevistador de requisitos. Te pregunta lo necesario y escribe el PRD: el documento con el problema, los requisitos verificables (formato Dado/Cuando/Entonces), los casos borde y la propuesta de tickets. También acepta que le pases un documento tuyo (una spec, un SRD) y pregunta solo lo que falte.                          |
| **/write-ticket** | El redactor de tareas ejecutables. Convierte requisitos en tickets de GitHub tan completos que un agente puede implementarlos sin preguntar nada: criterios de aceptación, tests esperados, qué queda fuera, etiquetas y dependencias. En modo lote crea el épico con sus sub-tareas, siempre mostrándote la tabla antes de crear nada. |

### Agregar tus propias skills 🧩

Las tres skills que trae el kit no son un límite: puedes escribir las tuyas
para lo que tu proyecto necesite (buenas prácticas de Go, reglas de tu API,
el procedimiento de despliegue, el estilo de tu empresa…).

**Cómo:** una carpeta con un archivo, dentro del repo:

```
.claude/skills/go-practices/SKILL.md
```

```markdown
---
name: go-practices
description: Buenas prácticas de Go de este proyecto. Úsala al escribir o
  revisar cualquier código Go: errores, interfaces, concurrencia, tests.
---

# Go: reglas del proyecto

- Envuelve errores con contexto: `fmt.Errorf("cargando usuario %s: %w", id, err)`
- Las interfaces se definen donde se CONSUMEN, no donde se implementan
- Todo lo que pueda tardar recibe `context.Context` como primer parámetro
- Tests table-driven con subtests nombrados
  ...
```

Con eso queda disponible al instante para ti (`/go-practices`) y para **todos
los obreros**, incluidos los de la nube, porque viaja con el repo.

**El paso que no debes olvidar:** agrega su fila a la tabla "Project skills"
del `CLAUDE.md`, diciendo cuándo cargarla. Esa tabla es lo que convierte la
skill de "sugerencia que Claude quizá active" en "regla que el obrero debe
seguir". Si no la agregas, funcionará a veces; si la agregas, siempre.

> 💡 ¿No sabes escribirla? Pídeselo a Claude: _"crea una skill
> `.claude/skills/go-practices/SKILL.md` con las buenas prácticas de Go que
> deba seguir la fábrica en este proyecto, y agrégala a la tabla de skills del
> CLAUDE.md"_. Y `/bootstrap` te la ofrece al crear proyectos nuevos.

---

## Otras piezas que trabajan solas (no las llamas, pero existen)

| Pieza                       | Qué hace                                                                                                                                                                                                                   | Dónde vive                   |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| **CLAUDE.md**               | El reglamento del proyecto: qué significa "terminado", los estándares de código y el ciclo de vida de las tareas. Claude lo lee en cada sesión.                                                                            | Raíz del repo                |
| **design-system.md**        | La verdad visual: colores, espaciados, tipografía y la checklist que usa el ui-reviewer.                                                                                                                                   | Raíz del repo                |
| **Stop hook**               | El portero implacable: cada vez que Claude intenta terminar, corre lint + tipos + tests. Si algo falla, no lo deja terminar y le muestra el error para que siga corrigiendo.                                               | `.claude/hooks/stop-gate.sh` |
| **process-backlog.sh**      | El capataz: busca la siguiente tarea sin bloqueos y lanza un Claude a trabajarla.                                                                                                                                          | `scripts/`                   |
| **ui-preflight.sh**         | El portero del puerto: levanta el servidor de ESTA app y le prohíbe al ui-reviewer fotografiar cualquier otro que ya esté respondiendo. Sin él, otro proyecto en el mismo puerto se revisa en silencio.                    | `scripts/`                   |
| **task-status.sh**          | El mensajero del tablero: mueve las tarjetas del board ("In Progress"). Done lo pone GitHub solo al mergear.                                                                                                               | `scripts/`                   |
| **claude-backlog.yml**      | La fábrica nocturna: el turno de noche en los servidores de GitHub (por horario, o al etiquetar `ready-for-dev`). Hasta 5 tareas por corrida.                                                                              | `.github/workflows/`         |
| **check-worker-claimed.sh** | El detector de corridas mudas: si el worker de la nube termina sin tocar el issue (ni reclamarlo, ni bloquearlo, ni dejar PR), pone el job en rojo. Sin él, una corrida que no hizo nada se ve igual que una que funcionó. | `scripts/`                   |
| **claude-mentions.yml**     | El oído de la fábrica: responde a `@claude` en issues y comentarios: tu línea directa desde el celular.                                                                                                                    | `.github/workflows/`         |

---

## Parte 8: Trabajar en equipo 👥

La fábrica soporta varias personas en el mismo repo. Lo que ya hace sola, y
lo que le toca configurar al equipo:

**Automático: el reclamo por assignee.** Cuando alguien (o el turno
nocturno) toma un ticket, se lo asigna en GitHub y verifica que nadie más lo
haya reclamado; si otro llegó primero, lo salta. Dos personas corriendo el
script a la vez no duplican trabajo. El cron nocturno también respeta los
reclamos: nunca toca un issue con assignee.

**Repartir por asignación (la forma más simple).** Asigna los tickets a
cada persona desde GitHub (o pídelo en el gate: "asigna el 2 y el 4 a
ana-lopez"). El script respeta las asignaciones solo con eso: los tickets de
otros son invisibles, los tuyos y los libres se procesan. Los tickets **sin
asignar son pozo común**: cualquiera (incluido el cron) los toma. Si
quieres el modo estricto que ignora el pozo:

```bash
ONLY_MINE=1 bash scripts/process-backlog.sh   # solo lo asignado a mí
```

> Regla mental del sistema: **asignar = reservar**. Un ticket asignado solo
> lo trabaja su dueño, y lo respetan los compañeros, el cron nocturno y el
> reclamo automático. Lo sin asignar es de quien lo tome primero.

**Carriles con `ONLY_LABEL`.** Para repartir el trabajo por áreas en vez de
competir por la misma cola: creen labels de área (`gh label create
area:billing`, `area:deportivo`, …), pídanle a write-ticket que los ponga al
crear tickets, y cada quien corre su carril:

```bash
ONLY_LABEL=area:billing bash scripts/process-backlog.sh
```

(la variable vive solo en esa corrida; sin ella, el script toma de toda la
cola, como siempre)

**Un clic obligatorio con auto-merge en equipo:** en GitHub → Settings →
Branches → Add branch protection rule para `main` → activar **"Require
branches to be up to date before merging"**. Evita que dos PRs verdes
probados contra mains distintos se mergeen y rompan main entre los dos.

**Los tokens, cada quien paga lo suyo:**

- **Local:** automático, el script usa la sesión de Claude de quien lo
  corre; cada persona gasta su propia suscripción sin configurar nada.
- **Nube:** los workflows resuelven la credencial **según quién pidió el
  trabajo** (quien comentó `@claude` o puso la etiqueta), con esta cadena:

  1. **Token personal del actor**, buscado como secreto
     `CLAUDE_TOKEN_SU_USUARIO` (el usuario de GitHub en mayúsculas, guiones
     → `_`). Cada integrante planta el suyo una vez:

     ```bash
     claude setup-token
     gh secret set CLAUDE_TOKEN_MI_USUARIO
     ```

     …y alguien agrega su línea al **mapa** de los dos workflows
     (`claude-backlog.yml` y `claude-mentions.yml`, paso "Resolver
     credencial del actor"):
     `TOK_MI_USUARIO: ${{ secrets.CLAUDE_TOKEN_MI_USUARIO }}`

  2. **API key de equipo** (`ANTHROPIC_API_KEY`): el ÚNICO fallback para
     humanos, porque es bolsa común por definición (créditos que paga el
     proyecto). Opcional: si no existe, no hay fallback.
  3. **Sin token personal y sin API key de equipo → no corre.** La fábrica
     responde en el issue con las instrucciones exactas para que esa persona
     se plante su token. Nadie trabaja con la cuenta de otro.

  El **token común del repo** (`CLAUDE_CODE_OAUTH_TOKEN`) es exclusivo del
  **cron nocturno**: el turno de noche no tiene "actor real" a quién
  cobrarle, así que cobra a esa bolsa designada (o a la API key de equipo
  si no existe).

- **Letra pequeña de confianza:** cualquiera con permiso de push podría
  editar el workflow y leer los tokens del mapa. Es el modelo de todo
  secreto de repo, pero con tokens personales pesa más: mantengan la branch
  protection (cambios a workflows entran por PR revisado) y el mapa solo
  con gente de confianza.

**Reglas de convivencia:** un solo dueño del cron nocturno (los demás no
necesitan tocarlo); el label `auto-merge` es una decisión de confianza
COMPARTIDA: acuerden en equipo qué tipo de tickets lo merecen, porque
cualquiera puede etiquetar código que tocan todos; y cada persona hace su
instalación user-level (`bash scripts/install-user-level.sh`) y mantiene su
propio `.env.local` (los secretos no se comparten por git, así que pásense
los valores por un gestor de contraseñas de equipo).

## Chuleta de comandos

```bash
# Proyecto nuevo
gh repo create mi-app --template TU_USUARIO/fabrica-template --private --clone
claude "/bootstrap descripción de la app y stack"
gh secret set CLAUDE_CODE_OAUTH_TOKEN     # bolsa del cron (pegar token guardado)
gh secret set CLAUDE_TOKEN_TU_USUARIO     # tu token personal (mismo valor)

# Token de la nube (solo la primera vez en la vida)
claude setup-token

# Nueva funcionalidad (dentro de claude, en modo plan: Shift+Tab)
/write-prd lo que quiero construir

# Soltar la fábrica (Git Bash, en la carpeta del repo)
bash scripts/process-backlog.sh
ONLY_LABEL=area:billing bash scripts/process-backlog.sh   # solo mi carril por área (equipos)
ONLY_MINE=1 bash scripts/process-backlog.sh               # solo tickets asignados a mí

# Ver el estado de las tareas
gh issue list --label pending        # las que faltan
gh issue list --label in-progress    # en las que trabaja
gh issue list --label needs-human    # las que piden tu ayuda

# Confiar una tarea a la noche
gh issue edit N --add-label "auto-merge"     # que se mergee sola al quedar verde
gh issue edit N --add-label "ready-for-dev"  # que la nube la procese ya

# Cambiar los modelos de la fábrica
# (editar factory-models.json y luego:)
bash scripts/apply-models.sh

# Dentro de claude
Shift+Tab   # cambiar de modo (auto ↔ plan)
/model      # cambiar el modelo de TU sesión (para planear: opus)
/exit       # salir
claude --continue   # volver a la conversación anterior
```

---

_Regla de oro: gasta tus opiniones temprano (en el PRD) y tu ojo crítico al
final (en el PR). Todo lo del medio, déjaselo a la fábrica._
