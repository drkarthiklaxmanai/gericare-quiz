import { supabase } from './supabase'

export type QuizActionResult<T = unknown> = { data: T | null; error: Error | null }

async function call<T>(action: string, payload: Record<string, unknown> = {}): Promise<QuizActionResult<T>> {
  if (!supabase) return { data: null, error: new Error('Supabase is not configured') }
  const { data, error } = await supabase.functions.invoke('quiz-api', { body: { action, ...payload } })
  if (error) return { data: null, error: new Error(error.message) }
  if (data?.error) return { data: null, error: new Error(data.error) }
  return { data: data as T, error: null }
}

export const quizApi = {
  availableRounds: (eventId: string) => call('available_rounds', { event_id: eventId }),
  startRound: (eventId: string, roundId: string) => call('start_round', { event_id: eventId, round_id: roundId }),
  answer: (attemptId: string, questionId: string, optionKey: string) => call('answer', { attempt_id: attemptId, question_id: questionId, option_key: optionKey }),
  finishRound: (attemptId: string) => call('finish_round', { attempt_id: attemptId }),
  integrity: (attemptId: string, eventType: string, metadata: Record<string, unknown> = {}) => call('integrity', { attempt_id: attemptId, event_type: eventType, metadata }),
  history: (eventId: string) => call('history', { event_id: eventId }),
  leaderboard: (eventId: string) => call('leaderboard', { event_id: eventId }),
}
