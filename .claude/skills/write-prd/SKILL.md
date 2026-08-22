---
name: write-prd
description: >
  Write a requirements document (PRD) for a feature or product: problem, users,
  scope, functional requirements with acceptance criteria, UX notes, metrics
  and open questions, structured so it can be decomposed into factory tickets
  with write-ticket. Use for "PRD", "documento de requerimientos", "spec",
  "requirements". Supports Spanish and English.
argument-hint: "[feature/product name] [es|en]"
---

# Write PRD

You are writing the document that everything downstream depends on: tickets
come from it, tests come from the tickets, and the review agents check against
those tests. Ambiguity here becomes bugs later, so be concrete.

**Language:** use the language requested; if none, match the user's request.
Templates: `template.es.md` / `template.en.md` in this directory.

## Scale check (before anything else)

Judge the size of the input:

- **Whole product** (an SRD, a long multi-feature brief): do NOT write one
  giant PRD. First produce the master plan: `docs/plan-maestro.md` with the
  epic table (scope, size, dependencies), parallel lanes and ordering
  rationale. Get it approved, create the epic issues, and only then write
  PRDs one epic at a time (the first one right away if the user agrees).
- **Single feature**: write its PRD normally, and append its epic row to
  `docs/plan-maestro.md` (create the file with a minimal table if it doesn't
  exist yet), declaring dependencies on existing epics if any.

Either way the plan lives in the repo, never only in the conversation.

## Method

1. **Interview before writing.** If any of these is unknown, ask (batch the
   questions, max one round): Who is the user? What problem, in their words?
   How do they solve it today? What does success look like, measurably?
   What is explicitly NOT in v1?
2. **Requirements are numbered (RF-1, RF-2...)** and each has its own
   acceptance criteria in Given/When/Then. A requirement without verifiable
   criteria is an opinion, not a requirement.
3. **Prioritize with MoSCoW** (Must/Should/Could/Won't-this-time). Every
   "Must" must trace to the problem statement; if it doesn't, demote it.
4. **Edge cases and error states get their own section.** Empty states, limits,
   concurrency, permissions, offline. The factory implements what is written.
   Unwritten edge cases become production bugs.
5. **End with the ticket decomposition**: proposed list of tickets (title +
   size + dependencies + auto-merge recommendation), ready to feed
   `write-ticket`.
6. **Recommend auto-merge per ticket** with a one-line rationale. Recommend
   YES only for mechanical, well-fenced work: data restructuring pinned by
   tests, styles covered by visual baselines, internal refactors with no
   behavior change, docs. Recommend NO for anything touching auth,
   permissions, payments, data deletion, or new business logic. The human
   ratifies or vetoes these at the write-ticket review gate. Your
   recommendation is advice, never a decision.

## Output

Write the PRD to `docs/prd/[feature-name].md` in the repo. After approval,
**offer** to run `write-ticket` in batch mode to create the issues: the
decomposition table's groups become epics (parent issues) with the tickets
linked as native sub-issues, plus dependency labels. Offer it; do not do it.
Creating issues is a separate decision with its own gate.

## Where you stop

Planning ends at the plan. When the tickets exist, you are DONE: report what
was created and hand off the command, never the work.

> Listo: `docs/prd/favoritos.md` + 9 tickets (#4–#12) bajo el épico #3.
> **No voy a empezar a trabajarlos.** Cuando quieras arrancar la fábrica:
> `bash scripts/process-backlog.sh`, o etiqueta un issue `ready-for-dev`
> para que lo trabaje la nube.

Implementing one of them right now (however obvious the next ticket looks)
violates the "Autonomy boundary" rule in `CLAUDE.md`.

This skill never talks to GitHub directly, because planning and syncing are
separate responsibilities. `write-ticket` owns all `gh` calls.

Epic granularity tip: prefer a few epics with many tasks (e.g. 4×9) over many
epics with few tasks (12×3). With tiny epics the board's rollup bars stop
telling you anything.
