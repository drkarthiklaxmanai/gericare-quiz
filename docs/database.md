# Database Specification

## Primary tables
`events`, `event_settings`, `profiles`, `event_participants`, `event_admins`, `questions`, `question_options`, `question_media`, `rounds`, `round_questions`, `attempts`, `responses`, `round_results`, `leaderboard_snapshots`, `finalists`, `final_attempts`, `final_responses`, `sudden_death_attempts`, `sudden_death_responses`, `audit_events`, `integrity_events`, `control_locks`, `projector_sessions`, `ai_generation_jobs`, `ai_sources`, `ai_qa_flags`.

## Key invariants
- Unique `(event_id, question_id)` for assignment/reservation.
- A participant has at most one active attempt per round.
- Response ownership is `(attempt_id, participant_id)` and is server-validated.
- Score fields are generated/reconciled server-side.
- Result release uses a server timestamp, never a client timestamp.
- Audit events are append-only.

## RLS model
Participants: own membership/attempt/response/released-result rows only.
Question Editors: assigned events/questions and live controls according to role.
Super Admin: full event administration.
Projector: display-safe presentation data only.

## Migrations
Schema changes are versioned in `supabase/migrations/` and must be tested before production deployment.
