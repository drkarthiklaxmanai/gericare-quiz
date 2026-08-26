import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const p0 = read('supabase/migrations/20260826200000_p0_competition_correctness.sql')
const revisions = read('supabase/migrations/20260826202500_allow_answer_revisions_until_finish.sql')
const p1 = read('supabase/migrations/20260826213000_p1_production_hardening.sql')
const quizApi = read('supabase/functions/quiz-api/index.ts')

test('preliminary rounds remain server-authoritative at 90 seconds', () => {
  assert.match(p0, /round_duration_seconds[^\n]*90|jsonb_set\([^\n]*round_duration_seconds[^\n]*90/s)
  assert.match(p0, /attempt_already_used/)
})

test('round answers are scored from the final saved selections', () => {
  assert.match(revisions, /create or replace function public\.finish_quiz_attempt/i)
  assert.match(revisions, /sum\(coalesce\(r\.points_awarded,0\)\)/i)
  assert.match(revisions, /on conflict\s*\(attempt_id,question_id\)/i)
  assert.doesNotMatch(revisions, /response_already_submitted/i)
})

test('manual round release is the sole participant release source', () => {
  assert.match(quizApi, /results_released_at/)
  assert.match(quizApi, /from\("rounds"\)/)
  assert.doesNotMatch(quizApi, /releasedAttempts/)
  assert.match(p0, /result_release_delay_seconds/)
  assert.match(p1, /settings\s*=\s*coalesce\(settings,'\{\}'::jsonb\)\s*-\s*'result_release_delay_seconds'/i)
})

test('integrity termination does not invent an automatic answer release', () => {
  assert.match(p0, /record_integrity_event/i)
  assert.doesNotMatch(p0, /make_interval\s*\([^)]*900|interval\s*'15 minutes'/i)
  assert.match(p0, /results_released_at/i)
})

test('participant PII and responses require super admin', () => {
  assert.match(p1, /require_super_admin/i)
  assert.match(p1, /ea\.role::text='super_admin'/i)
  assert.match(p1, /admin_participant_roster/i)
  assert.match(p1, /admin_participant_responses/i)
})

test('final qualification uses score and time from the same best five rounds', () => {
  assert.match(p1, /row_number\(\) over\s*\(\s*partition by ep\.id\s*order by a\.score desc, a\.valid_response_time_ms asc/i)
  assert.match(p1, /sum\(score\) filter \(where score_rank<=5\)/i)
  assert.match(p1, /sum\(valid_response_time_ms\) filter \(where score_rank<=5\)/i)
  assert.match(p1, /order by preliminary_score desc, preliminary_time_ms asc/i)
})
