# CLAUDE.md: Victoria Seadragons

## Project

Plataforma web del club Victoria Seadragons (rugby subacuático, Melbourne):
membresías, calendario y RSVP, asistencia, evaluaciones, team builder, noticias
y cobros por Stripe. Fuente: `docs/SRD_Victoria_Seadragons_Club_Platform.md`
(v1.3) y `docs/plan-maestro.md` (14 epics).

`docs/preguntas-abiertas.md` lista los bloqueadores y contradicciones que la
auditoría del bootstrap encontró en esos dos documentos. Antes de escribir un
ticket de un epic, comprueba si ese epic aparece ahí sin resolver.

Stack: Next.js 16 (App Router) + TypeScript estricto + Supabase (Postgres,
Auth, Storage) + Stripe (desde E12). API REST JSON versionada bajo
`src/app/api/v1` (CON-002: Release 2 es React Native sobre los mismos
endpoints).

## Commands

- Install: `npm install`
- Dev server: `npm run dev` (sirve `http://localhost:3417`;
  bootstrap assigns this project its own port, never the shared 3000)
- Tests: `npm test` (Vitest)
- E2E / visual: `npx playwright test`
- Lint: `npm run lint`
- Types: `npm run typecheck`

## Definition of Done

A task is ONLY finished when ALL of the following are true. The Stop hook
enforces this; you cannot end the session with failing checks.

1. All tests pass (`npm test`), including new tests for the new behavior.
2. Lint passes with zero warnings (`npm run lint`).
3. Type check passes (`npm run typecheck`).
4. If UI changed: visual regression + accessibility tests pass
   (`npx playwright test`) whenever the project has a Playwright config. They
   cost no tokens, so they are never skipped to save budget. If Playwright or
   `scripts/ui-preflight.sh` reports that something else already answers on
   the app's URL, that is a blocker, not a nuisance: a server you did not
   start may belong to another project, and every screenshot taken against it
   is meaningless. Free the port or set `APP_URL`; never review around it.
   The `ui-reviewer` subagent (APPROVED) is additionally required according
   to the UI-review policy in `factory-models.json` → `review.uiReview`:
   `"always"` = every UI change; `"label"` (default) = only when this issue
   carries the `ui-review` label; `"off"` = never.
5. The `code-reviewer` subagent has replied `APPROVED`.
6. Budget: 5 correction cycles TOTAL across all
   checks (the Stop gate enforces the same number). If still failing, stop,
   label the issue `needs-human`, and comment exactly what was tried and what
   is blocking. If the gate itself gave up (`.factory/gate-gave-up` exists),
   opening or readying a PR is FORBIDDEN.

## Workflow: TDD first

For every task: write the tests FIRST from the acceptance criteria, confirm
they fail, then implement until green. Never weaken or delete a test to make
it pass. If a test seems wrong, say so explicitly and ask.

## Clean code standards (JS/TS)

These are checked by the code-reviewer subagent. Violations are `Medium`+.

- **Naming:** intention-revealing names. Functions are verbs (`calculateTotal`),
  booleans read as predicates (`isValid`, `hasAccess`). No abbreviations except
  universal ones (`id`, `url`).
- **Functions:** small, one job. Soft limit ~30 lines; extract when a comment
  would be needed to separate sections. Max 3 positional params (use an
  options object beyond that). Prefer early returns / guard clauses over deep
  nesting.
- **Types:** strict TypeScript. No `any` (use `unknown` + narrowing). Model
  domain concepts as types: discriminated unions over loose shapes with
  optional fields. Public functions have explicit return types.
- **Design principles:** SOLID where it genuinely improves the design, never
  as box-ticking. KISS: the simplest solution that correctly solves the
  problem. YAGNI: no speculative abstractions, config, or extension points
  for hypothetical future needs. Build what the ticket asks.
- **Magic values:** no unexplained literals scattered in logic. Name
  constants meaningfully (`MAX_LOGIN_ATTEMPTS = 5`, not a bare `5`).
- **Errors:** never swallow errors. Catch only where you can handle or add
  context. Fail fast with clear messages. No error-silencing `|| {}` / `?.`
  chains that hide bugs.
- **State & purity:** prefer pure functions; isolate side effects at the edges.
  No mutation of shared state; prefer `const` and immutable updates.
- **Duplication:** rule of three (extract on the third occurrence, not the
  second). Do not create speculative abstractions.
- **Comments:** code explains _what_, comments explain _why_. Delete commented-
  out code (git remembers it).
- **Dependencies:** no new runtime dependency without a one-line justification
  in the PR description.
- **Tests:** Arrange-Act-Assert, one behavior per test, descriptive names
  (`"returns empty list when user has no orders"`). Test behavior, not
  implementation details.

## Autonomy boundary (read this BEFORE the lifecycle below)

The factory never starts working on its own. The lifecycle in the next section
is **a procedure to follow when dispatched**, not a standing order to go look
for work. Run it ONLY when one of these is true:

- **The session opened with a prompt telling you to process issues**, e.g.
  "Process GitHub issue #N following the issue lifecycle in CLAUDE.md…" or
  "Process up to 5 eligible pending issues per CLAUDE.md…". That is what
  `scripts/process-backlog.sh` and `.github/workflows/claude-backlog.yml`
  (the `ready-for-dev` label and the nightly cron) send.
- **The human in this session said so, naming the work**: "trabaja el #3",
  "implementa el ticket 7", "procesa el backlog".
- **An `@claude` mention asked for the work by name** ("@claude implementa
  este issue"). A mention that asks a _question_ is a question: answer it in
  the thread and do not open a branch.

The test is always the same: **did the instruction that opened this session, or
the human in it, tell you to process issues?** Judge it from the prompt in
front of you, not from guessing who launched you. If nothing told you to, you
were not dispatched. In particular, **the existence of `pending` issues is not
a dispatch**, not even issues you created yourself two minutes ago. After a
planning session (master plan, PRD, tickets) you STOP and hand off:

> Listo: 9 tickets creados (#4–#12). **No voy a empezar a trabajarlos.**
> Cuando quieras arrancar la fábrica: `bash scripts/process-backlog.sh`
> (o etiqueta un issue `ready-for-dev` para que lo trabaje la nube).

### Actions that need an explicit OK first

Show exactly what you are about to do, then wait, even in `auto` permission
mode, and even if the user sounds enthusiastic:

1. **Creating issues or epics as planning**: decomposing a PRD, a master plan,
   a backlog. Always print the review table (epic | tickets | sizes |
   dependencies | suggested labels) and wait for confirmation. `write-ticket`'s
   gate is mandatory, never a formality, because creating issues is not
   cleanly reversible.
2. **Starting work on a ticket** when you were not dispatched (see above).

### What a dispatch already authorizes (do not re-ask)

Being dispatched IS the OK for everything its prompt covers. Do not stop
mid-ticket to ask for any of this:

- The lifecycle's own machinery: labels, branch, commits, push, draft PR, and
  the `auto-merge` path when the human already put that label on the issue.
- **The scope the prompt states.** "Process up to 5 eligible pending issues"
  authorizes all five, including re-checking eligibility after each one. Finish
  the run the prompt asked for; do not stop after the first issue.
- **Issues the lifecycle itself tells you to open**: the `priority:high` "main
  roto por #X" of the "Exceptional situations" section, or any blocker you must
  file to hand the ticket back safely. These are incident reports, not
  planning: file them and say so. Rule 1 above is about _planning_ work into
  existence, and a headless worker has nobody to ask anyway.

This boundary is about the **queue**, not about being helpful. A direct request
("arregla este bug", "agrégale un botón", "explícame esto") is just work: do
it. What you never do is go find work nobody handed you.

## Issue lifecycle (the factory loop)

Queue states are GitHub labels: `pending` → `in-progress`. There is NO `done`
label: the final state is the issue **closed** (the PR's `Closes #N` does it on
merge, and `labels-cleanup.yml` strips the queue labels). Never create or apply
a `done` label. Dependencies: label `blocked-by-N`; an issue is eligible only
when all its blockers are closed.

Execute these steps IN ORDER:

1. **Pick** the next `pending` issue that is not blocked (lowest number first,
   respecting `priority:high` > `priority:medium` > `priority:low`).

2. **Already-done check (idempotency), BEFORE writing any code.** Verify the
   issue isn't already implemented: if every acceptance criterion is met by
   existing code (its tests exist and pass with zero changes), do NOT create an
   empty PR. Comment on the issue with the evidence (which tests, which
   commits/PRs), remove `in-progress`, and close it. Re-queued or duplicated
   tickets are normal; re-implementing them is not.

3. **Claim**: `gh issue edit N --add-label "in-progress" --remove-label "pending"`,
   create branch `impl-N`, and if a board is configured run
   `bash scripts/task-status.sh N "In Progress"` (no-op without
   `.plan/project.json`).

4. **TDD** until green (Definition of Done items 1–3). Before opening the PR,
   sync with main: `git fetch origin && git rebase origin/main`.

5. **Review**: launch `code-reviewer` (and `ui-reviewer` ONLY when the UI-review
   policy in `factory-models.json` applies; see Definition of Done item 4) →
   fix findings → re-review, until `APPROVED` or 3 rounds.

6. **Check the boxes**: update the issue body marking each acceptance criterion
   `[x]`, ONLY those a passing test actually proves (`gh issue view N --json
body -q .body` → edit → `gh issue edit N --body-file`). A box you cannot back
   with a test stays unchecked and gets a comment explaining why.

7. **PR**: write the description to a file and open it as draft:
   `gh pr create --draft --body-file /tmp/pr-N.md`. The body MUST contain
   `Closes #N`, a summary of what was implemented, a one-line justification for
   any new runtime dependency, and a loud **⚠ Not verified** section if anything
   could not be checked. A human merges; never merge yourself.
   EXCEPTION: if the issue carries the `auto-merge` label (a human put it there
   on purpose), once the PR is green run `gh pr ready && gh pr merge --auto
--squash`. If that command fails or the PR stays `BLOCKED` (auto-merge not
   enabled in the repo, branch protection requiring an up-to-date branch),
   comment on the issue saying the auto-merge could not be queued and why. Do
   NOT assume it worked. Never add the `auto-merge` label yourself.

8. **Blockers.** Retries are ONLY for problems you can fix yourself (failing
   tests, lint, types, your own bugs) and the budget is 5 correction cycles TOTAL across all checks; the Stop gate
   enforces the same number. If the blocker is something only a human can
   provide (missing credentials or env vars, an external service not
   configured, a permission not granted, a dependency that cannot be
   installed), do NOT retry and do NOT work around it silently: STOP, label
   `needs-human`, and comment EXACTLY what is missing, where the human gets it,
   and where to put it (e.g. "falta SUPABASE_SERVICE_ROLE_KEY en .env.local:
   dashboard → Settings → API"). Attempt #2 against a missing key is identical
   to attempt #1. Partial work may be delivered ONLY if the PR and the issue
   state loudly what was NOT verified and why.

## Project skills (load them, don't improvise)

Skills in `.claude/skills/` are this project's written expertise. They are
MANDATORY, not suggestions: before writing or reviewing code that falls under
one, load it and follow it. The table below is the contract. Keep it updated
whenever a skill is added or removed.

| Skill                                   | Load it when…                            |
| --------------------------------------- | ---------------------------------------- |
| `write-prd`                             | planning a feature or decomposing a spec |
| `write-ticket`                          | creating or refining issues              |
| `bootstrap`                             | initializing a brand-new project         |
| `nextjs-supabase-practices`             | touching any .ts/.tsx under `src/`, any migration under `supabase/migrations/`, or any `api/v1` handler |

If a task clearly falls under a skill that does NOT exist yet (a stack, a
domain, a recurring procedure with rules worth writing down), say so in the PR
description. Proposing new skills is part of the job.

## Exceptional situations (read before improvising)

- **Main is broken (not by you).** If the Stop gate fails on tests you did not
  touch, check main first (`gh run list --branch main --limit 1`, or run the
  suite on a clean checkout). If main is red: do NOT try to fix it inside your
  ticket. Open a `priority:high` issue "main roto por #X", label your ticket
  `blocked-by-<that issue>`, return it to `pending`, and stop.
- **Rebase conflict you cannot resolve with certainty:** never force it;
  `needs-human` + comment listing the conflicting files.
- **Flaky test:** run it 3 times. If it fails non-deterministically, do NOT
  delete it or mark it skip: `needs-human` + comment with the three outputs.
- **The Stop gate gave up** (it blocked the maximum number of times and let you
  stop; it leaves `.factory/gate-gave-up`): you are FORBIDDEN from opening a PR
  or marking one ready. Label the issue `needs-human` and comment which checks
  are still red.
- **Integration tests without credentials in the cloud:** if the runner lacks
  the app's env vars and the ticket does not depend on those services, you may
  skip those tests declaring "⚠ integration tests not run in CI" in the PR. If
  the ticket does depend on them, `needs-human` naming the missing repo secret.
- **Never print the contents of a `.env*` file** (not in comments, PRs or
  logs). To check a variable exists use `grep -c '^NAME=' .env.local` or
  `[ -n "${NAME:-}" ]`.
- **Running out of context mid-ticket:** commit what is green, push the branch,
  and comment on the issue what is done and what remains. Never leave silent
  uncommitted work.

Board rules: the board is the human's control surface. A non-epic card moved
to **Todo** means "work this", and the next `process-backlog.sh` run re-queues
it (reopening the issue if it was closed). Note what that is and is not: a card
in Todo is **intent to queue, never a dispatch** (see "Autonomy boundary"). The
script reconciles the board into labels before picking work; you never go read
the board yourself looking for something to do. Never set a board status to
"Done" manually: the
Project's built-in workflows do it when the issue closes / the PR merges. The
agent only ever writes "In Progress" (and "Todo" at creation time).

## Documents & tickets

Issues, PRDs and PR descriptions are written with the `write-ticket` /
`write-prd` skills. Default language: es. When in doubt,
match the language of the request.

### House style (applies to everything the factory writes)

Issues, PRDs, plans, PR descriptions, commit messages and issue comments all
go to humans. Write them the way a competent colleague writes, not the way a
model writes.

- **No em dashes.** Never use the `—` character. It is the single clearest
  tell that a text was machine-written, and this project treats it as a
  defect. Use a colon when what follows explains what came before, parentheses
  or commas for an aside, a semicolon to join two related clauses, and a plain
  full stop when the sentence is simply carrying two ideas. Splitting into two
  short sentences is almost always the best option.
- **Vary the fix.** Solving every case with a colon reads just as mechanical
  as the dash did. Let the punctuation follow the meaning.
- Avoid the other tells too: opening with "Great question", closing with a
  summary nobody asked for, three-item lists where two items would do, and
  hedging like "it's worth noting that".
- Prefer short sentences and concrete nouns. If a sentence needs a comma to
  survive, it usually wants to be two sentences.

## Planning artifacts (never chat-only)

- **Master plan → `docs/plan-maestro.md`, always.** Any epic-level
  decomposition (whether it comes from a full SRD, a long brief, or features
  arriving over time) is WRITTEN to that file, never only shown in chat. It
  contains: the epic table (scope/FRs covered, size, dependencies), parallel
  lanes, ordering rationale, and cross-cutting technical decisions.
- **It is a living document.** When a new feature/epic arrives later, append
  its row to the table (with dependencies on existing epics) in the same
  commit that creates its epic issue. Mark it as added post-plan.
- The full chain must stay traceable in the repo:
  source (SRD/brief) → `docs/plan-maestro.md` → `docs/prd/<epic>.md` →
  tickets → code.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
