# GeriCare Quiz — Technical Specification

**Baseline:** v1.0 — 19 Aug 2026

## Locked competition model
- Preliminary rounds use 3 manually selected questions per round.
- All participants receive the same assigned questions; question order and option order are randomized per participant.
- Questions have equal points (10 by default).
- Round 6 is optional; preliminary ranking uses the best 5 eligible rounds.
- Results are hidden for 15 minutes after round submission.
- Final: Top 10 finalists, 10 questions × 10 points; preliminary score is a tie-break only.
- Tie-break: final score → preliminary Best-5 → cumulative response time → sudden-death MCQs.
- Wrong/ambiguous live question: void it, award full points to everyone, exclude its response time, no replacement.
- Each participant's timer begins server-side when Start is pressed.
- 20-second cumulative connectivity grace per round; system-wide outage supports protected recovery.
- First tab/visibility violation warns; second terminates the round.
- Questions cannot be reused within this conference; assigned questions are reserved.
- Video questions permit replay; projector video auto-plays with sound.
- Admin: email + password + email OTP/2FA. No automatic inactivity logout.

## Surfaces
1. Participant PWA
2. Control Room
3. Projector Client
4. Admin / Question Editor

## Backend
Supabase Auth, PostgreSQL, RLS, Realtime, Storage and server-side Edge Functions. Server state is authoritative for timing, scoring, eligibility, result release and recovery.

## Event lifecycle
`draft → registration_open → live → preliminary_complete → final → completed → archived`

## Core entities
Events, settings, profiles, event participants, admin roles, questions, options, media, rounds, round questions, attempts, responses, results, leaderboard snapshots, finalists, final attempts/responses, sudden-death attempts/responses, audit events, integrity events, control locks, projector sessions and AI generation/QA records.

## Acceptance principles
No cross-participant data leakage; deterministic server-side scoring; protected result release; duplicate question prevention; realtime recovery; auditable privileged actions; isolated Demo Mode; reproducible exports.
