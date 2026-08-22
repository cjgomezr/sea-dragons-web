# PRD: [Feature name]

**Status:** draft | approved · **Date:** [...] · **Author:** [...]

## 1. Problem
[2-4 sentences. What hurts, for whom, and what happens today without this.
With evidence where it exists: metrics, complaints, support tickets.]

## 2. Users & context
- **Primary user:** [who, what they know, on what device]
- **How they solve it today:** [current workaround]

## 3. Goal & success metrics
- Goal: [one sentence]
- Metrics: [e.g. "80% of users complete X in < 2 min", "cut support tickets about Y by 50%"]

## 4. Scope
**In (v1):** [...]
**Explicitly out (for now):** [...]

## 5. Functional requirements
### FR-1 · [Name] · [Must|Should|Could]
[One-sentence description.]
- **Given** ..., **when** ..., **then** ...
- **Given** ..., **when** ..., **then** ...

### FR-2 · [Name] · [Must|Should|Could]
[...]

## 6. Edge cases & error states
- [Empty state: ...]
- [Limits: max input, huge lists, ...]
- [Errors: network down, insufficient permissions, ...]
- [Concurrency: two users edit at once → ...]

## 7. UX / UI
- Mockups: [paths or "no mockup: design-system.md applies"]
- Flows: [main flow steps]
- Viewports: 375 / 768 / 1440

## 8. Non-functional requirements
- Performance: [e.g. response < 200ms p95]
- Accessibility: complies with design-system.md (zero axe violations)
- Security: [relevant authn/authz]

## 9. Open questions
- [ ] [Question blocking an FR, and whose answer it is]

## 10. Ticket decomposition (for write-ticket)
| # | Proposed title | Size | Depends on | Suggested auto-merge |
|---|---|---|---|---|
| 1 | [...] | S | none | Yes: [one-line rationale] |
| 2 | [...] | M | 1 | No: [touches business logic or security] |
