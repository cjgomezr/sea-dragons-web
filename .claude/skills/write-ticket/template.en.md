# [Imperative, specific title]

## Context
[1-3 sentences: why this task exists, what user problem it solves.
Link to parent PRD/issue if applicable.]

## Acceptance criteria
- [ ] **Given** [initial state], **when** [action], **then** [observable result]
- [ ] **Given** ..., **when** ..., **then** ...
<!-- Each criterion = one test. Always include edge cases. -->

## Expected tests (write these FIRST, before the code: TDD)
- `describe("...")`: [happy path]
- `describe("...")`: [edge case: empty / null / huge input]
- `describe("...")`: [failure case: external dependency fails]

## UI (only if applicable)
- Mockup: `[docs/mockups/screen.png]`, or else "No mockup: heuristic review against design-system.md"
- Screens to verify: [...]
- Viewports: 375 / 768 / 1440

## Out of scope
- [What this ticket explicitly does NOT include]

## Technical notes (optional)
- [Likely affected files, decisions already made, gotchas]

---
Labels: `pending`, `priority:[high|medium|low]`, `size:[S|M]`[, `blocked-by-N`]
