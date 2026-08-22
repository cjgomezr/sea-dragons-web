---
name: bootstrap
description: >
  Guided step-by-step setup of a project freshly created from the fabrica
  template: diagnoses the repo, interviews the user (or reads their SRD),
  proposes a shell project and waits for approval, then installs everything,
  builds a walking skeleton with TDD, fills every {{...}} placeholder, verifies
  the commands really work, and hands off to planning, without ever starting
  to work tickets on its own. Use right after creating a repo from the
  template, when the user says "bootstrap", "inicializa el proyecto", "arranca
  el proyecto", "setup del proyecto", or invokes /bootstrap.
argument-hint: "[una idea corta, un SRD/brief completo, o nada y te entrevisto]"
---

# Bootstrap: el arranque guiado

You build the **shell** (la cáscara): a walking skeleton plus the tooling the
project genuinely needs. You do NOT build the product, you do NOT plan it, and
you NEVER start working tickets. The "Autonomy boundary" rule in `CLAUDE.md`
applies here too.

**Language:** respond in the language of the user's request.

## Shape of the run

Five phases, **two hard stops**. Announce each phase as you enter it and report
what it produced as you leave it, because the human must always know where in
the run they are and what just happened. Never merge two phases into one silent
block of work: the whole point of this skill is that the human is walked
through it.

| Fase                        | Qué hace                                                                           | ¿Para?                    |
| --------------------------- | ---------------------------------------------------------------------------------- | ------------------------- |
| 0 · Diagnóstico y propuesta | mira el repo, lee lo que le mandaron, entrevista si hace falta, propone la cáscara | **SÍ: espera el ok**      |
| 1 · Setup mecánico          | dependencias, Playwright, labels, modelos                                          | no (reporta)              |
| 2 · La cáscara              | walking skeleton con TDD, placeholders                                             | no (reporta)              |
| 3 · Verificación y commit   | corre todo de verdad, commitea, push                                               | no (reporta)              |
| 4 · Handoff                 | qué sigue: plan, tickets, tablero                                                  | **SÍ: pregunta y espera** |

---

## Fase 0: Diagnóstico y propuesta ⟵ PRIMERA PARADA

### 0.1 Dónde estamos (verificar, nunca asumir)

Run these and show the result as one compact block:

- Remoto: `git remote get-url origin` y
  `gh repo view --json nameWithOwner,visibility -q '.nameWithOwner + " (" + .visibility + ")"'`
- `gh auth status`. Si falla, PARA y pide `gh auth login`: sin eso no hay
  labels ni issues y media fábrica no existe.
- Kit user-level: ¿existe `~/.claude/agents/code-reviewer.md`?
- ¿Quedan placeholders `{{...}}`? Si no queda ninguno, este repo **ya fue
  bootstrapeado**. Dilo y pregunta antes de tocar nada.

**El repositorio de GitHub ya existe**: lo creó `gh repo create --template`
antes de invocarte. Tu trabajo es _decir a qué repo vas a escribir_, no crearlo.
Solo si NO hay remoto (alguien bajó la plantilla como zip o copió la carpeta)
dilo con claridad y ofrece
`gh repo create <nombre> --source=. --private --push`, esperando confirmación.
Nunca lo crees por tu cuenta.

### 0.2 Qué te mandaron

Solo hay dos casos. Di en voz alta en cuál estás:

- **Te dieron un documento** (un SRD, un brief largo: varias features,
  requisitos, secciones). Léelo entero. Extrae el stack, los servicios que
  hacen falta (auth, BD, pagos, colas) y qué es v1 frente a futuro. Pregunta
  SOLO lo genuinamente ambiguo, máximo una ronda.
- **No te dieron documento**. Da igual si fue una frase suelta ("una app de
  recetas") o nada en absoluto: en ambos toca la entrevista de una ronda
  (0.3). La única diferencia es cuánto sabes ya: si no sabes ni qué quieren
  construir, esa es la primera pregunta del mismo bloque.

Los dos casos producen material, y en los dos la Fase 2 lo escribe al repo
(ver "El documento de partida"): lo que se habla aquí no se queda solo en la
conversación.

**Aparte de esos dos, te pueden pasar un diseño**: un `.html`, un PDF, un
PNG/JPG, una exportación de Figma. No es un tercer caso: es material _extra_
que puede llegar con un documento o en lugar de él (un diseño sin texto sigue
dejándote sin spec: entrevista igual). Trátalo como ciudadano de primera.
Míralo de verdad (`Read` ve imágenes y PDFs) y en la propuesta de 0.4 di qué
pantallas trae y qué tokens de marca sacaste. Los detalles, en "Si te dan un
diseño" (Fase 2).

**Nunca planees el producto aquí.** Si el SRD te da para épicas y PRDs, eso no
es tu trabajo: lo ofreces en la Fase 4. `/bootstrap` deja el terreno listo;
`/write-prd` decide qué se construye encima.

### 0.3 La entrevista (una sola ronda, cuando no te dieron documento)

Ask all of them together in one block, with `AskUserQuestion` when available.
Only ask what changes the shell; nothing about the product:

0. **¿Qué quieres construir?** SOLO si llegaste sin nada. Va primero y en el
   mismo bloque, en formato abierto; las otras cuatro son de opción. Si ya te
   dieron una frase, esta pregunta ya está contestada: no la repitas.
1. **¿Quién la usa?** solo tú / público en internet / un equipo interno
   → decide si hace falta auth desde el día uno.
2. **¿Dónde corre?** web / móvil / CLI / API sin interfaz
   → decide si hay UI (Playwright, design-system, ui-reviewer) o no.
3. **¿Guarda datos?** no / local (archivo, localStorage) / base de datos real
   → decide si la cáscara trae cliente de BD y migraciones.
4. **¿Stack?** el que prefieran, o "elige tú" → si eligen tú, propón uno con
   una línea de razón.

Si contestan "no sé" a algo, elige tú y márcalo en la propuesta como **decisión
tuya**, para que puedan vetarla.

### 0.4 La propuesta de cáscara ⟵ AQUÍ PARAS

Show ONE block and wait for an explicit OK. In this order:

1. **Repo destino**: a qué `owner/repo` vas a escribir.
2. **Stack y herramientas**: lo que vas a instalar, con una línea de por qué
   para cada pieza no obvia.
3. **Qué construye la cáscara**: el walking skeleton concreto (la ruta o el
   comando que funciona de punta a punta) y cuántos tests.
4. **Qué NO incluye**: la lista explícita de lo que queda para los tickets.
   Esta lista es lo que impide que construyas de más.
5. **Modelos**: el contenido actual de `factory-models.json` (worker,
   codeReviewer, uiReviewer, planning) con la regla de dedo en una línea:
   sonnet para el trabajo diario, opus solo donde el error cuesta caro. Que lo
   confirmen o lo cambien aquí mismo; no lo preguntes por separado. Aclara de
   paso, una sola vez y sin repetirlo después, que los tres primeros quedan
   configurados de verdad, mientras que `planning` es un recordatorio para sus
   propias sesiones (se elige con `/model`, no se aplica solo).
6. **Lo que pasa después**: las tres fases restantes, una línea cada una.

> **Regla de la cáscara: solo entra lo inevitable.** Framework, runner de
> tests, linter y typechecker siempre. Un servicio externo (BD, auth) entra
> SOLO si es requisito _Must_ del SRD o si salió de la entrevista, y entra
> como cliente configurado más una operación que camina, no como esquema
> completo. Todo lo demás lo construyen los tickets, revisados. Es el YAGNI
> del `CLAUDE.md` aplicado al arranque.

Si te corrigen, muestra la propuesta corregida y vuelve a esperar. No arranques
con dudas abiertas.

---

## Fase 1: Setup mecánico

Anuncia la fase. Corre `bash scripts/bootstrap.sh` (npm install, Playwright
chromium y los 13 labels). En Windows sin `bash`, corre los equivalentes:
`npm install`, `npx playwright install chromium`, y un `gh label create` por
label (pending, in-progress, needs-human, ready-for-dev, auto-merge, ui-review,
priority:high, priority:medium, priority:low, size:S, size:M, size:L, epic),
ignorando los errores de "already exists".

Si en la propuesta cambiaron algún modelo, edita `factory-models.json`. Corre
`bash scripts/apply-models.sh` **siempre**, aunque no hayan cambiado nada: es
idempotente y sincroniza el frontmatter de los agentes con el JSON, que pueden
llegar desalineados desde la plantilla. Avisa que ese script hace su propio
commit y push, así que verán un commit antes del de la Fase 3.

Si el proyecto lleva UI, la primera corrida de Playwright pedirá permiso para
el MCP, así que avísalo antes de que aparezca, para que no parezca un error.

Si faltaba el kit user-level, instálalo (`bash scripts/install-user-level.sh`) y
avisa que un cambio de `defaultMode` necesita reiniciar la sesión para cargar.

**Reporta al salir:** dependencias ✓, navegador ✓, N labels creados / M ya
existían, modelos aplicados.

---

## Fase 2: La cáscara

Anuncia la fase. Construye EXACTAMENTE lo aprobado en 0.4, ni más ni menos.

**TDD de verdad:** escribe los tests primero, confírmalos en rojo, implementa
hasta verde. Es la primera demostración del método que la fábrica usará en cada
ticket. No lo saltes por ser "solo el esqueleto". Sigue los tokens de
`design-system.md` para cualquier UI.

### Placeholders

Reemplaza TODOS los `{{...}}` en: `CLAUDE.md`, `design-system.md`,
`package.json`, `tests/ui.spec.ts`, `scripts/ui-preflight.sh`,
**`.claude/agents/ui-reviewer.md`** y `user-level/agents/ui-reviewer.md`
(comando del dev server + URL; mantén las DOS copias del ui-reviewer
sincronizadas: la de `.claude/agents/` es la que Claude Code ejecuta; la de
`user-level/` es solo la fuente del instalador de máquina).

**El puerto: uno propio, nunca 3000.** `{{APP_URL}}` se usa en cinco archivos
y todos tienen que decir lo mismo. Elige un puerto libre y poco disputado
(3300-3999 va bien) y verifica que nadie lo tenga tomado antes de fijarlo:

```bash
curl -sS -o /dev/null --max-time 2 http://localhost:3417 && echo "OCUPADO, elige otro" || echo "libre"
```

3000 es el default de medio mundo. Si dos proyectos de la fábrica lo comparten,
el segundo termina sacándole capturas y corriéndole los tests visuales a la app
del primero, y nada falla: las capturas salen perfectas, solo son de otra app.
Fija el puerto en el comando del dev server **con la bandera estricta** del
framework (`vite --strictPort --port 3417`, `next dev -p 3417`), porque los
que se corren solos al siguiente puerto libre reintroducen justo el problema.

Si el stack NO es npm/JS, reemplaza también los comandos dentro de
`.claude/hooks/stop-gate.sh` por los equivalentes de tu stack (cada check de
ahí corre solo si existe su archivo de configuración).

Los placeholders de marca de `design-system.md` (`{{COLOR_PRIMARY}}`,
`{{FONT_FAMILY}}`, `{{RADIUS}}`) no se deducen de un stack. **Sí se deducen de
un diseño**: si te dieron uno, sácalos de ahí (ver abajo). Si no hay diseño,
deja los defaults documentados y dilo explícitamente en el reporte ("usé el
azul por defecto #2563EB, cámbialo en design-system.md cuando tengas
identidad").

### Si te dan un diseño (HTML, PDF, imagen, export de Figma)

Un diseño no es decoración: es la referencia contra la que el `ui-reviewer`
juzgará cada pantalla, en su **Modo A** (comparar contra el mockup), que es
bastante mejor que el Modo B (heurístico). Sin estos tres pasos, ese modo
nunca se activa y el diseño se desperdicia.

1. **Guárdalo en `docs/mockups/`** con nombre descriptivo de la pantalla
   (`home.png`, `login.png`, `checkout-paso-2.pdf`). Esa carpeta es la
   convención que buscan `write-ticket` (campo `Mockup:` de su plantilla) y el
   `ui-reviewer`. Un mockup fuera de ahí es un mockup que nadie encuentra.
2. **Extrae los tokens a `design-system.md`**: color primario, tipografía,
   radios, escala de espaciado. De un HTML/CSS los valores son exactos: léelos,
   no los estimes. De un PDF o una imagen, mírala y anota junto a cada token
   que fue leído a ojo, para que el humano lo pueda corregir.
3. **Si el diseño es HTML**, además tómale una captura y guárdala junto al
   original: el Modo A del ui-reviewer compara imágenes, y un `.html` no le
   sirve tal cual.

```bash
npx playwright screenshot --viewport-size=1440,900 file://<ruta-absoluta>.html docs/mockups/<pantalla>.png
```

**Lo que NO haces:** implementar todas las pantallas del diseño. La cáscara
sigue siendo un esqueleto que camina. El diseño te da los _tokens_ y la
_referencia_, no la licencia para construir el producto entero. Las pantallas
salen de sus tickets, cada una revisada contra su mockup. En la propuesta de
0.4, lista las pantallas que viste bajo "qué NO incluye".

Deja `.mcp-variants/mobile.mcp.json` intacto (es texto instructivo).

### El documento de partida (siempre, venga como venga)

La Fase 0 siempre produce material: o el documento que te dieron, o las
respuestas de la entrevista. **Ese material se escribe al repo**, nunca se
queda solo en la conversación, porque es el origen de la cadena de
trazabilidad de `CLAUDE.md` (source → `plan-maestro.md` → PRDs → tickets →
código), y sin él la sesión de planeación arranca de cero y te vuelve a
preguntar lo mismo.

- **Te dieron un SRD / brief largo:** guárdalo tal cual en `docs/srd.md` (o
  déjalo donde esté si ya vive en el repo). No lo reescribas: es de ellos.
- **Salió de la entrevista** (una frase corta, o nada + entrevista): escribe
  `docs/brief.md` con lo que sí sabes, la idea en las palabras del usuario,
  las respuestas a las 4 preguntas, el stack elegido y las decisiones que
  tomaste tú (marcadas como tuyas), y lo que quedó explícitamente fuera de la
  cáscara. Corto y honesto: es un punto de partida, no un PRD.

### Si hay UI

`playwright.config.ts` DEBE traer un bloque `webServer`, para que la suite
levante y baje su propio dev server:

```ts
webServer: {
  command: '{{DEV_SERVER_CMD}}',
  url: '{{APP_URL}}',
  // Off a propósito: si algo ya responde en esa URL, Playwright falla en vez
  // de adoptarlo. Un servidor ajeno en el puerto haría que la suite compare
  // baselines contra otra app. Para reusar el tuyo: FABRICA_REUSE_SERVER=1.
  reuseExistingServer: !!process.env.FABRICA_REUSE_SERVER,
  timeout: 120_000,
},
```

Sin eso, el Stop hook corre `npx playwright test` por su cuenta y cada test
falla con ERR_CONNECTION_REFUSED apenas no haya un servidor arriba, bloqueando
la sesión por algo que no tiene nada que ver con el código.

El `ui-reviewer` no usa este bloque (saca sus capturas por fuera de la suite),
así que tiene su propia protección: `scripts/ui-preflight.sh`, que levanta el
dev server él mismo y se niega a fotografiar cualquier servidor que no haya
arrancado. Comprueba que funciona antes de cerrar la fase:
`bash scripts/ui-preflight.sh up && bash scripts/ui-preflight.sh down`.

Genera las líneas base visuales (`npx playwright test --update-snapshots`) y
commitéalas: si no, el Stop gate del primer ticket falla por baselines
faltantes.

### Si NO hay UI

Borra `tests/ui.spec.ts` y `scripts/ui-preflight.sh`, y no crees
`playwright.config.ts`.

**Reporta al salir:** archivos creados, cuántos tests y qué cubren, y qué
placeholders quedaron con valor por defecto.

---

## Fase 3: Verificación real y commit

Anuncia la fase. Corre y confirma en verde, mostrando la salida real: **los
cuatro comandos que acabas de escribir en `CLAUDE.md`** (tests, lint,
typecheck, y el dev server sirviendo de verdad; levántalo, comprueba HTTP 200,
bájalo). En un proyecto npm son `npm test`, `npm run lint`, `npm run
typecheck`; en otro stack son sus equivalentes, los mismos que pusiste en
`stop-gate.sh`. Si un comando de `CLAUDE.md` no corre aquí, el Stop gate del
primer ticket fallará por lo mismo. Arregla lo rojo antes de seguir. **No
reportes éxito por suposición.**

```bash
git add -A
git commit -m "Bootstrap: cáscara del proyecto + kit de fábrica configurado"
git push
```

Habilita auto-merge en el repo para que el label pueda funcionar (esto no
mergea nada por sí solo: solo permite que un PR que TÚ etiquetaste `auto-merge`
se mergee al quedar verde):

```bash
gh repo edit --enable-auto-merge 2>/dev/null || echo "⚠ actívalo a mano en Settings → General"
```

**Reporta al salir:** los cuatro checks con su resultado real y el commit
pusheado.

---

## Fase 4: Handoff ⟵ SEGUNDA PARADA

Anuncia la fase con un resumen del arranque completo (cáscara, verificación,
commit). Y entonces lo importante: **no empiezas a trabajar nada.**

### 4.1 Las llaves de la nube (informativo)

Corre `gh secret list`. Si falta `CLAUDE_CODE_OAUTH_TOKEN` (la bolsa del cron)
o `CLAUDE_TOKEN_<USUARIO_EN_MAYUSCULAS>` (el token personal, para menciones y
`ready-for-dev`), recuérdale los comandos exactos (ambos llevan el mismo valor):

```bash
gh secret set CLAUDE_CODE_OAUTH_TOKEN
gh secret set CLAUDE_TOKEN_SU_USUARIO
```

Y si su usuario de GitHub no está en el mapa de `.github/workflows/*.yml` (paso
"Resolver credencial del actor"), ofrece agregarle su línea `TOK_*`.

### 4.2 Qué sigue: sugiere, explica el porqué, y deja elegir

Tu trabajo aquí es que sepan cuál es el siguiente paso y **por qué conviene
darlo así**, no imponerles un camino. Sugieres, explicas, y si prefieren otra
cosa, se hace lo que digan sin insistir.

**El mensaje es el mismo los tres casos** (SRD, frase corta, o nada), porque el
documento de partida siempre existe: `docs/srd.md` si te lo dieron,
`docs/brief.md` si salió de la entrevista. Nombra el que corresponda y di qué
tiene dentro, para que sepan que no van a repetir lo ya conversado:

> La cáscara está lista, y lo que hablamos quedó en `docs/brief.md`
> (tu idea, las respuestas de la entrevista y el stack que elegimos).
>
> El siguiente paso es el plan maestro, y de ahí las épicas y los tickets.
> Te sugiero hacerlo en una terminal nueva, en modo plan (Shift+Tab):
>
> ```
> claude                          # en la carpeta del repo
> /write-prd usa docs/brief.md
> ```
>
> ¿Por qué aparte? Planear es la decisión más cara de deshacer: un error
> aquí se multiplica en cada ticket. En modo plan puedes discutir y
> reescribir el documento sin que nadie toque archivos. Y esta sesión ya
> gastó buena parte de su contexto instalando y verificando, así que el plan
> rinde más con la ventana limpia.
>
> Después de eso: al aprobar el PRD te propone los tickets (ves la tabla
> antes de que cree nada), y ya con tickets, `bash
scripts/process-backlog.sh` suelta la fábrica.
>
> Pero si prefieres seguir aquí y ahora, dímelo y arrancamos.

Si deciden seguir en esta sesión: adelante, sin repetir la sugerencia ni
hacerlos sentir que eligieron mal. Carga `write-prd` y sigue su "Scale check".

Dos cosas que NO haces en este mensaje: mencionar cambiar de modelo
(`factory-models.json` ya se decidió en la Fase 0, volver al tema estorba), y
proponer tú el contenido del plan. Decidir qué se construye es de `write-prd`,
con el humano delante.

Crear issues conserva su propia confirmación (`CLAUDE.md` → Autonomy boundary):
la tabla de revisión de `write-ticket` no se salta nunca.

**En ambos casos, ofrece el tablero** (opcional, nunca por defecto):

> ¿Quieres el tablero visual de GitHub (Projects v2)? Son 2 minutos, pero hay
> 2 cosas que solo puedes hacer tú: `gh auth refresh -s project,repo` (te abre
> el navegador) y activar 3 interruptores en la UI del Project.

Si aceptan: `gh project create --owner @me --title "<repo>"`, `gh project link`,
y `bash scripts/project-setup.sh <owner> <número>`. Luego recuérdales los tres
workflows a activar (**Item added → Todo**, **Item closed → Done**, **PR merged
→ Done**) y agrupar la vista por **Parent issue**.

### 4.3 Skill de buenas prácticas del stack (ofrécela)

Ofrece crear `.claude/skills/<stack>-practices/SKILL.md` con las reglas
idiomáticas del stack elegido (Go: envolver errores, interfaces donde se
consumen, propagar context, tests table-driven; Python: typing, ruff, fixtures
de pytest; Rails: fat models thin controllers…). Reglas que un agente pueda
APLICAR y un revisor pueda VERIFICAR, no un tutorial.

Si aceptan: escríbela con un `description` que dispare bien ("úsala al escribir
o revisar código <stack>…") y agrega su fila a la tabla "Project skills" del
`CLAUDE.md`. Si no, anota en el reporte que se puede agregar después.

---

## La regla que no se rompe

Terminas el bootstrap **sin haber trabajado un solo ticket**, pase lo que pase:
aunque existan issues `pending`, aunque los acabes de crear tú, aunque el SRD
sea clarísimo y el siguiente paso obvio. Arrancar la fábrica es una decisión
del humano y tiene su propio comando.
