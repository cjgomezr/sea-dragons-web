---
name: write-ticket
description: >
  Write an executable GitHub issue/ticket with acceptance criteria, expected
  tests, edge cases and factory labels. Use whenever creating or refining
  issues, tickets, user stories or tasks, especially during planning sessions
  that feed the autonomous backlog. Supports Spanish and English.
argument-hint: "[short description of the feature/bug] [es|en]"
---

# Write Ticket

You are writing a ticket that an **autonomous agent** will implement without
asking questions. The bar: could someone implement this correctly with ZERO
follow-up? If not, the ticket is not done.

**Language:** use the language requested; if none, match the language of the
user's request. Templates: `template.es.md` and `template.en.md` in this
directory. Follow the structure exactly.

## Rules for a factory-grade ticket

1. **Title**: imperative + specific. Bad: "Login improvements". Good:
   "Bloquear cuenta tras 5 intentos fallidos de login en 15 min".
2. **Acceptance criteria in Given/When/Then**: each criterion independently
   verifiable and translatable into a test, one behavior each. If you cannot
   write it as Given/When/Then, you do not understand the requirement yet:
   ask the user BEFORE creating the ticket.
3. **Expected tests listed explicitly**: the implementer writes these FIRST
   (TDD). Include the edge cases: empty, null, huge input, concurrency,
   failure of external dependency.
4. **Scope fence**: an explicit "out of scope" list. This is what prevents
   an autonomous agent from wandering.
5. **UI tasks** must reference the mockup file if one exists, or state
   "no mockup: heuristic review against design-system.md", and list which
   screens/viewports the ui-reviewer must check. Look in **`docs/mockups/`**
   before assuming there is none. That is where bootstrap files any design
   the human handed over, one image per screen. A mockup that exists but goes
   uncited downgrades the review from Mode A (compare against the design) to
   Mode B (heuristic), which is the weaker of the two.
6. **Labels** (create with `gh label create` if missing):
   - State: `pending` (always at creation)
   - Priority: `priority:high|medium|low`
   - Size: `size:S|M|L` (S ≤ 2h, M ≤ 1 day, L: split it; never create an L
     without proposing the split)
   - Dependencies: `blocked-by-N` per blocking issue
7. **One ticket = one deliverable.** If the description contains "and" twice,
   propose splitting.

## Output

By default, show the ticket for confirmation, then create it:

```bash
gh issue create --title "..." --body-file /tmp/ticket.md \
  --label "pending,priority:medium,size:S"
```

## Batch mode (decomposing a PRD into many tickets)

**Review gate: never skip it.** Before creating anything, print a summary
table (epic | ticket count | ticket titles + sizes + dependencies +
suggested auto-merge with one-line rationale) and wait for explicit
confirmation. Issue creation is not cleanly reversible.

The auto-merge suggestions come from the PRD (or apply the same criteria:
YES only for mechanical, test-fenced work; NO for auth, permissions,
payments, deletions, new business logic). Apply the `auto-merge` label ONLY
to tickets the human explicitly confirmed. Their gate confirmation ratifies
the suggested set, and any veto ("not #3") overrides the suggestion.

Also suggest the `ui-review` label (same ratify-at-gate mechanism) for
tickets whose deliverable is user-facing UI where visual judgment matters:
new screens, layout changes, design-system work. Skip it for backend, data,
config, or trivial UI tweaks already fenced by visual regression tests.
This label only has effect when `factory-models.json` → `review.uiReview`
is `"label"` (the default): it marks which tickets earn the (token-costly)
screenshot review by the ui-reviewer agent.

Pre-create every label the batch uses (`gh issue create` hard-fails on a
missing label and would abort the batch halfway):

```bash
for l in epic auto-merge ui-review pending "size:S" "size:M" "size:L" \
         "priority:high" "priority:medium" "priority:low"; do
  gh label create "$l" 2>/dev/null || true
done
```

### Epics as native sub-issues

When the tickets come grouped (a PRD's decomposition table, phases,
milestones), create each group as an epic (a parent issue) and link its
tickets as native sub-issues, which gives rollup progress bars and lets the
board group by "Parent issue":

```bash
# 1. Create the epic (parent)
gh issue create --title "[Epic] <group title>" --body "<group summary>" --label "epic"

# 2. Create each ticket normally, then link it as a sub-issue.
#    GOTCHA: the endpoint wants the numeric DATABASE id, not the issue
#    number and not the GraphQL node id. Fetch it explicitly:
DB_ID=$(gh api "repos/$REPO/issues/$CHILD_NUMBER" --jq .id)
gh api --method POST "repos/$REPO/issues/$PARENT_NUMBER/sub_issues" -F "sub_issue_id=$DB_ID"
```

### Board (optional)

If `.plan/project.json` exists, add each created issue to the board:
`bash scripts/task-status.sh <N> "Todo"`. If it doesn't exist, skip silently,
because labels remain the source of truth for the factory queue either way.

After the batch, report: epics created, tickets created (with numbers), the
dependency graph, and the board URL if applicable.

### Then stop: creating is not starting

Your job ends when the issues exist. Close with the handoff, never with work:

> 9 tickets creados (#4–#12) bajo el épico #3. **No voy a empezar a
> trabajarlos.** Para arrancar la fábrica: `bash scripts/process-backlog.sh`,
> o etiqueta un issue `ready-for-dev` para que lo trabaje la nube.

`pending` labels you just applied are a queue, not a dispatch. See "Autonomy
boundary" in `CLAUDE.md`.
