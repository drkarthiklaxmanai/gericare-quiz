# Admin / Question Editor

Administrative surface for GeriCare Quiz.

## Current capabilities

- Browse/search the event question bank.
- Create four-option single-best-answer MCQs.
- Generate an AI draft via the authenticated `question-ai` Supabase Edge Function.
- Run deterministic QA before approval.
- Human approval remains mandatory; AI never auto-approves questions.
- Manage categories and question metadata.
- Assign exactly three approved questions to a preliminary round.
- Prevent reuse of a reserved question within the same event.
- Lock a round's three-question set.

## Required frontend variables

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_EVENT_ID` (optional when the signed-in editor has access to only one event)

## Required server-side Edge Function secret

- `OPENAI_API_KEY`
- Optional `QUESTION_AI_MODEL` (defaults to `gpt-5.6-sol`)

Never expose `OPENAI_API_KEY` through a `VITE_*` variable or browser bundle.
