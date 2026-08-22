# 🏭 Fábrica de desarrollo autónoma (Template)

> Autonomous development factory template for Claude Code. **English below.**

> 🧭 **¿Primera vez con la fábrica?** Lee primero
> **[GUIA-DE-LA-FABRICA.md](./GUIA-DE-LA-FABRICA.md)**. Es el manual paso a
> paso explicado fácil: cómo se usa, qué hace cada agente y cada skill, y
> qué hacer cuando algo falla. Este README es la referencia técnica.
> _(New to the factory? Read the step-by-step guide first; it's in Spanish.)_

Repo template para arrancar cualquier proyecto con Claude Code trabajando en
loop autónomo: TDD con Stop hook que bloquea el final hasta que todo pase,
revisores de código y UI que iteran hasta `APPROVED` sin humano, skills para
tickets/PRDs ejecutables (ES/EN), y pipeline de issues en GitHub.

## Arranque rápido (2 comandos)

```bash
gh repo create mi-app --template TU_USUARIO/fabrica-template --private --clone && cd mi-app
claude "/bootstrap una to-do list con Vite + TypeScript vanilla"
```

La skill `/bootstrap` te guía en **5 fases con 2 paradas**: (0) diagnostica el
repo, te entrevista o lee tu SRD, y te propone la cáscara (**espera tu ok**);
(1) user-level + `npm install` + Playwright + labels + modelos; (2) walking
skeleton con TDD y todos los placeholders `{{...}}`; (3) verifica que
test/lint/typecheck/dev funcionan de verdad, commit y push; (4) handoff: te
pregunta qué sigue (plan, tickets, tablero). Acepta una idea corta, un SRD
completo, o nada.

Dos garantías de diseño: la **cáscara** solo trae lo inevitable (el resto lo
construyen los tickets, revisados), y `/bootstrap` **nunca empieza a trabajar
tickets**. Ver `CLAUDE.md` § _Autonomy boundary_. Los pasos manuales de abajo
son la versión detallada por si prefieres control fino o algo falla.

## ⚠️ Anexo: paso a paso manual (NO lo necesitas si usaste /bootstrap)

Esta sección documenta lo que `/bootstrap` hace por dentro. Sirve solo como
plan B (si la skill fallara) o para curiosos. Si ya corriste los comandos del
arranque rápido, tu proyecto YA tiene todo esto hecho. Sáltala completa.

**1. Crea tu proyecto:** botón **"Use this template"** en GitHub (o
`gh repo create mi-app --template TU_USUARIO/fabrica-template`).

**2. Instala la parte de usuario (una sola vez por máquina, no por proyecto):**

```bash
bash scripts/install-user-level.sh
```

Esto copia a `~/.claude/` el modo de permisos `auto` y los agentes
`code-reviewer` y `ui-reviewer`. La carpeta `user-level/` del repo es solo la
fuente de esa instalación; tu app nunca la usa.

**3. Adapta los placeholders al stack:** busca `{{...}}` en `CLAUDE.md`,
`design-system.md`, `package.json`, `tests/ui.spec.ts`,
`scripts/ui-preflight.sh`, **`.claude/agents/ui-reviewer.md`** y
`user-level/agents/ui-reviewer.md`. Las dos copias del ui-reviewer llevan el
mismo cambio (comando del dev server + URL): la de `.claude/agents/` es la que
Claude Code ejecuta; la de `user-level/` es solo la fuente del instalador.
Dale al proyecto un puerto propio en vez de 3000: si dos fábricas comparten
puerto, la segunda le saca capturas y le corre los tests visuales a la app de
la primera sin que nada falle.
Truco: abre Claude Code en el repo y pídele _"detecta el stack y rellena
todos los placeholders {{...}} del kit"_.

**4. Instala dependencias y navegadores:**

```bash
npm install && npx playwright install chromium
```

**5. Crea los labels del pipeline:**

```bash
for l in pending in-progress needs-human ready-for-dev auto-merge ui-review epic priority:high priority:medium priority:low size:S size:M size:L; do gh label create "$l" 2>/dev/null || true; done
```

**6. (Nube) App + llaves:** instala la GitHub App de Claude
(github.com/apps/claude → Install → All repositories) y planta las llaves:
`gh secret set CLAUDE_CODE_OAUTH_TOKEN` (bolsa del turno nocturno) y
`gh secret set CLAUDE_TOKEN_TU_USUARIO` (tu token personal, para menciones y
`ready-for-dev`; agrega tu línea `TOK_TU_USUARIO` al mapa de los workflows).
`ANTHROPIC_API_KEY` es el fallback opcional de equipo. Detalle completo en
GUIA-DE-LA-FABRICA.md, Parte 8.

## Qué hay en el repo

| Ruta                                              | Qué hace                                                                                          |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `CLAUDE.md`                                       | Definition of Done, estándares de código limpio (JS/TS), ciclo de vida de issues                  |
| `design-system.md`                                | La verdad visual: tokens + checklist heurística para el ui-reviewer                               |
| `.claude/settings.json` + `.claude/hooks/`        | Stop gate (bloquea terminar con checks rojos, con guard anti-loop) + lint automático post-edición |
| `.claude/skills/write-ticket`, `write-prd`        | Skills de tickets y PRDs con plantillas ES + EN                                                   |
| `.mcp.json` / `.mcp-variants/mobile.mcp.json`     | Ojos: Playwright (web) / mobile-mcp (móvil, futuro)                                               |
| `tests/ui.spec.ts`                                | Regresión visual (3 viewports) + axe-core + no-overflow                                           |
| `scripts/ui-preflight.sh`                         | Levanta el dev server del proyecto y le prohíbe al ui-reviewer fotografiar servidores ajenos      |
| `scripts/process-backlog.sh`                      | Loop autónomo local sobre el backlog (prioridades + `blocked-by-N`)                               |
| `scripts/project-setup.sh` / `task-status.sh`     | Tablero opcional (GitHub Projects v2): cachea los IDs y actualiza el estado del board             |
| `.github/workflows/claude-backlog.yml`            | Fábrica en la nube: label `ready-for-dev` o cron nocturno                                         |
| `.devcontainer/`                                  | Contenedor desechable para correr con bypass total de permisos                                    |
| `factory-models.json` + `scripts/apply-models.sh` | Qué modelo usa cada pieza y la política de revisión visual                                        |
| `.github/workflows/claude-mentions.yml`           | Responder a `@claude` en issues (desde el celular)                                                |
| `.github/workflows/labels-cleanup.yml`            | Limpia labels de cola al cerrar un issue                                                          |
| `user-level/`                                     | Fuente del install de `~/.claude/` (settings + agentes revisores)                                 |

## Flujo de trabajo

1. **Planificar:** `claude --permission-mode plan` → `/write-prd` → aprobar →
   `/write-ticket` en lote (crea los issues con dependencias).
2. **Procesar local:** `bash scripts/process-backlog.sh`.
3. **Procesar en la nube:** etiqueta un issue `ready-for-dev` o espera el cron.
4. **Tu único trabajo:** aprobar planes y mergear PRs (siempre llegan en draft).

Escalera de autonomía: `auto` (por defecto) → sandbox nativo → devcontainer
con bypass (loop nocturno) → GitHub Actions. Complemento recomendado: el
plugin oficial `code-review` de Anthropic para revisiones profundas pre-PR.

## Trabajo nocturno sin cuello de botella

El merge humano es el punto de control y, con dependencias en cadena, el
freno nocturno. Tres herramientas, en orden de preferencia:

1. **Backlog ancho:** con varias features en cola, la fábrica avanza de noche
   con los tickets independientes mientras una cadena espera tu merge.
2. **Label `auto-merge` (opt-in por ticket):** pónselo TÚ a los tickets de
   bajo riesgo al crearlos; su PR se mergea solo al quedar verde y desbloquea
   la cadena. Claude tiene prohibido ponerse ese label a sí mismo.
3. **Menciones `@claude`** (`claude-mentions.yml`): comenta `@claude ...` en
   cualquier issue desde el celular, para pedir PRDs, crear tickets tras tu
   ok en comentarios, o preguntas. Misma credencial que el backlog.

Credenciales de nube (una vez por repo): `claude setup-token` y luego
`gh secret set CLAUDE_CODE_OAUTH_TOKEN` (cron) + `gh secret set
CLAUDE_TOKEN_TU_USUARIO` (tú). Cada persona paga lo suyo; el token del cron no
subsidia a nadie. Ver GUIA Parte 8.

## Tablero opcional: GitHub Projects v2

Los labels son la cola de la máquina; el board es la vista humana **y su
entrada de intención**: arrastrar una tarjeta no-épica a "Todo" hace que la
siguiente corrida del script la re-encole (reabriendo el issue si estaba
cerrado). No arrastres a Todo tarjetas ya terminadas que no quieras rehacer. Setup una vez por repo:

```bash
gh auth refresh -s project,repo        # el scope 'project' es aparte; sin él, todo 403
bash scripts/project-setup.sh TU_USUARIO 1   # (--org para proyectos de organización)
```

Luego, en la UI del Project (⚙ → Workflows), activa: **Item added → Todo**,
**Item closed → Done**, **PR merged → Done**, y agrupa la vista por **Parent
issue**. Con eso el agente solo escribe "In Progress" (`scripts/task-status.sh`)
y GitHub maneja el resto. `write-ticket` en modo batch crea los epics como
issues padre y cuelga los tickets como sub-issues (ojo: el endpoint de
sub-issues exige el database ID numérico, no el número de issue; la skill ya
lo maneja).

**Móvil más adelante:** reemplaza `.mcp.json` por
`.mcp-variants/mobile.mcp.json` y el comando E2E por Maestro/Detox. Agentes,
hooks, skills y pipeline no cambian. iOS requiere macOS.

---

# 🏭 Autonomous development factory: Template (English)

Template repo to start any project with Claude Code working in an autonomous
loop: TDD with a Stop hook that blocks finishing until all checks pass, code
and UI reviewer agents that iterate to `APPROVED` without a human, executable
ticket/PRD skills (ES/EN), and a GitHub issue pipeline.

## Quick start (2 commands)

```bash
gh repo create my-app --template YOUR_USER/fabrica-template --private --clone && cd my-app
claude "/bootstrap a to-do list with Vite + vanilla TypeScript"
```

`/bootstrap` walks you through **5 phases with 2 hard stops**: (0) diagnose the
repo, interview you or read your SRD, propose the shell (**waits for your OK**);
(1) user-level check, deps + Playwright + labels + models; (2) walking skeleton
with TDD + placeholder filling; (3) real verification, commit and push;
(4) handoff: asks what comes next (plan, tickets, board). It accepts a
one-liner, a full SRD, or nothing at all. The shell stays minimal on purpose,
and bootstrap **never starts working tickets** (see `CLAUDE.md` § _Autonomy
boundary_). Manual steps below if you prefer fine control:

1. **"Use this template"** on GitHub (or `gh repo create my-app --template
YOUR_USER/fabrica-template`).
2. `bash scripts/install-user-level.sh`, once per machine; installs `auto`
   permission mode and the reviewer agents into `~/.claude/`.
3. Replace the `{{...}}` placeholders in `CLAUDE.md`, `design-system.md`,
   `package.json`, `tests/ui.spec.ts`, `scripts/ui-preflight.sh`,
   **`.claude/agents/ui-reviewer.md`** and `user-level/agents/ui-reviewer.md`
   (both ui-reviewer copies get the same dev server command + URL:
   `.claude/agents/` is the one Claude Code runs, `user-level/` is only the
   installer's source), or ask Claude Code to _"detect the stack and fill in
   all {{...}} placeholders"_. Give the project its own port instead of 3000:
   two factories sharing one port review each other's app and nothing fails.
4. `npm install && npx playwright install chromium`.
5. Create the 13 pipeline labels (`pending`, `in-progress`, `needs-human`,
   `ready-for-dev`, `auto-merge`, `ui-review`, `epic`, `priority:*`, `size:*`)
   with `gh label create`, or just run `bash scripts/bootstrap.sh`.
6. For the cloud factory: install the Claude GitHub App, then
   `gh secret set CLAUDE_CODE_OAUTH_TOKEN` (nightly pool) and
   `gh secret set CLAUDE_TOKEN_YOUR_USER` (your own runs). See GUIA Part 8.

## Workflow

Plan mode → `/write-prd` → `/write-ticket` (batch, with dependency labels) →
process the backlog locally (`scripts/process-backlog.sh`) or in the cloud
(`ready-for-dev` label / nightly cron). Humans only approve plans and merge
draft PRs.

Autonomy ladder: `auto` → native sandbox → devcontainer with full bypass →
GitHub Actions. Mobile later: swap `.mcp.json` for the mobile variant and the
E2E command for Maestro/Detox; everything else stays the same.

**Optional Projects v2 board:** labels stay the machine queue; the board is
the human view (epics as native sub-issues, rollup bars). Run
`gh auth refresh -s project,repo` (the `project` scope is the classic 403),
then `bash scripts/project-setup.sh OWNER N`, enable the built-in workflows
(Item added → Todo, Item closed → Done, PR merged → Done) and group the view
by Parent issue. The agent only ever writes "In Progress" via
`scripts/task-status.sh`; GitHub handles Done.
