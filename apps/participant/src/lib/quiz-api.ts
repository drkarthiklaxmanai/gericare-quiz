import { supabase } from './supabase'

export type QuizActionResult<T = unknown> = { data: T | null; error: Error | null }

async function call<T>(action: string, payload: Record<string, unknown> = {}): Promise<QuizActionResult<T>> {
  if (!supabase) return { data: null, error: new Error('Supabase is not configured') }
  const { data, error } = await supabase.functions.invoke('quiz-api', { body: { action, ...payload } })
  return { data: data as T | null, error: error ? new Error(error.message) : null }
}

export const quizApi = {
  startRound: (roundId: string) => call('start_round', { round_id: roundId }),
  answer: (attemptId: string, questionId: string, optionId: string) => call('answer', { attempt_id: attemptId, question_id: questionId, option_id: optionId }),
  finishRound: (attemptId: string) => call('finish_round', { attempt_id: attemptId }),
  integrity: (attemptId: string, eventType: string, metadata: Record<string, unknown> = {}) => call('integrity', { attempt_id: attemptId, event_type: eventType, metadata }),
}
