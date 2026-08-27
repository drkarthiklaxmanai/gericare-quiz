import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

type RequestBody = {
  action: "generate" | "qa";
  event_id: string;
  topic?: string;
  difficulty?: number;
  category?: string;
  stem?: string;
  options?: string[];
  correct_index?: number;
  explanation?: string;
};

type Draft = {
  stem: string;
  options: [string, string, string, string];
  correct_index: number;
  explanation: string;
  difficulty: number;
  category: string | null;
  references: string[];
};

const MODEL = Deno.env.get("QUESTION_AI_MODEL") || "gpt-5.6-sol";
const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "content-type": "application/json" },
});

function deterministicQa(draft: Partial<Draft>) {
  const flags: Array<{ code: string; severity: "warning" | "error"; message: string }> = [];
  const opts = draft.options ?? [];
  if (!draft.stem?.trim()) flags.push({ code: "missing_stem", severity: "error", message: "Question stem is required." });
  if (opts.length !== 4) flags.push({ code: "option_count", severity: "error", message: "Exactly four options are required." });
  if (opts.some(x => !x?.trim())) flags.push({ code: "blank_option", severity: "error", message: "All four options must contain text." });
  if (new Set(opts.map(x => x.trim().toLowerCase())).size !== opts.length) flags.push({ code: "duplicate_options", severity: "error", message: "Options must be distinct." });
  if (draft.correct_index == null || !Number.isInteger(draft.correct_index) || draft.correct_index < 0 || draft.correct_index > 3) flags.push({ code: "answer_key", severity: "error", message: "A single valid correct answer is required." });
  if (!draft.explanation?.trim()) flags.push({ code: "missing_explanation", severity: "warning", message: "Add an explanation before approval." });
  return flags;
}

async function callOpenAI(apiKey: string, input: string) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "authorization": `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, input, reasoning: { effort: "medium" }, max_output_tokens: 1800 })
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`openai_${response.status}:${raw.slice(0,500)}`);
  const parsed = JSON.parse(raw);
  const text = parsed.output?.flatMap((x: any) => x.content ?? []).find((x: any) => x.type === "output_text")?.text;
  if (!text) throw new Error("openai_empty_output");
  return { text, response_id: parsed.id as string | undefined, usage: parsed.usage ?? null };
}

function parseDraft(text: string): Draft {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const x = JSON.parse(cleaned);
  const draft: Draft = {
    stem: String(x.stem ?? "").trim(),
    options: Array.isArray(x.options) ? x.options.map((v: unknown) => String(v).trim()).slice(0,4) as Draft["options"] : [] as unknown as Draft["options"],
    correct_index: Number(x.correct_index),
    explanation: String(x.explanation ?? "").trim(),
    difficulty: Math.min(5, Math.max(1, Number(x.difficulty ?? 3))),
    category: x.category == null ? null : String(x.category),
    references: Array.isArray(x.references) ? x.references.map((v: unknown) => String(v)).slice(0,5) : []
  };
  const flags = deterministicQa(draft);
  if (flags.some(f => f.severity === "error")) throw new Error(`invalid_model_output:${JSON.stringify(flags)}`);
  return draft;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !anonKey) return json({ error: "server_not_configured" }, 500);
  const supabase = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: auth } } });
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return json({ error: "unauthorized" }, 401);

  let body: RequestBody;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
  if (!body.event_id) return json({ error: "event_id_required" }, 400);

  const { data: admin, error: adminError } = await supabase.from("event_admins").select("role").eq("event_id", body.event_id).eq("user_id", userData.user.id).maybeSingle();
  if (adminError || !admin) return json({ error: "forbidden" }, 403);

  if (body.action === "qa") {
    const base = { stem: body.stem ?? "", options: (body.options ?? []) as Draft["options"], correct_index: body.correct_index ?? -1, explanation: body.explanation ?? "", difficulty: body.difficulty ?? 3, category: body.category ?? null, references: [] };
    const flags = deterministicQa(base);
    return json({ ok: true, flags, pass: !flags.some(f => f.severity === "error") });
  }

  if (body.action !== "generate") return json({ error: "unknown_action" }, 400);
  const topic = body.topic?.trim();
  if (!topic) return json({ error: "topic_required" }, 400);
  const difficulty = Math.min(5, Math.max(1, body.difficulty ?? 3));
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) return json({ error: "openai_key_missing", message: "Set OPENAI_API_KEY as a Supabase Edge Function secret." }, 503);

  const input = { topic, difficulty, category: body.category ?? null, model: MODEL };
  const { data: job, error: jobError } = await supabase.from("ai_generation_jobs").insert({ event_id: body.event_id, created_by: userData.user.id, input, status: "running" }).select("id").single();
  if (jobError) return json({ error: "job_create_failed", detail: jobError.message }, 500);

  try {
    const prompt = `You are an expert medical conference quiz question writer. Create ONE single-best-answer MCQ on the requested topic. It must be accurate, clinically defensible, unambiguous, and appropriate for an expert conference quiz. Difficulty is 1 (easy) to 5 (very hard). Avoid trivia, trick wording, absolutes unless true, overlapping choices, and more than one plausible best answer. Do not fabricate citations. If you cannot provide a reliable citation, return an empty references array.\n\nTopic: ${topic}\nCategory: ${body.category ?? "General"}\nDifficulty: ${difficulty}\n\nReturn ONLY valid JSON with exactly these keys: {"stem":string,"options":[string,string,string,string],"correct_index":0|1|2|3,"explanation":string,"difficulty":1|2|3|4|5,"category":string|null,"references":string[]}. The explanation should briefly justify the correct answer and, where useful, why the strongest distractor is wrong.`;
    const result = await callOpenAI(apiKey, prompt);
    const draft = parseDraft(result.text);
    const flags = deterministicQa(draft);
    const output = { draft, qa_flags: flags, provider: "openai", model: MODEL, response_id: result.response_id, usage: result.usage };
    const { error: updateError } = await supabase.from("ai_generation_jobs").update({ status: "completed", output, completed_at: new Date().toISOString() }).eq("id", job.id);
    if (updateError) throw new Error(`job_update_failed:${updateError.message}`);
    return json({ ok: true, job_id: job.id, status: "completed", ...output });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await supabase.from("ai_generation_jobs").update({ status: "failed", output: { error: message }, completed_at: new Date().toISOString() }).eq("id", job.id);
    return json({ error: "generation_failed", job_id: job.id, detail: message }, 502);
  }
});
