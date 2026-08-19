# Architecture

## High-level flow
```text
Participant PWA ─┐
Control Room ────┼──> Supabase Auth / Postgres / Realtime / Storage
Projector ───────┤
Admin ───────────┘
                    │
                    └── privileged Edge Functions
                         (timer, scoring, recovery, void, audit)
```

## Rules
- Browser clients are never authoritative for score, deadline or eligibility.
- RLS protects every exposed table.
- Projector receives display-safe state only.
- Media uses protected storage/signed delivery.
- Demo and production environments are isolated.
- Live control uses an exclusive `control_locks` record.

## Application boundaries
- `apps/participant`: participant-only UX and private results.
- `apps/control-room`: operational commands and live monitoring.
- `apps/projector`: presentation state rendering.
- `apps/admin`: content and event governance.
- `packages/quiz-engine`: pure domain rules.
- `packages/scoring`: deterministic ranking/scoring.
- `packages/types`: shared contracts.
- `packages/ui`: common presentation primitives.
- `packages/security`: client-safe guards/contracts.
