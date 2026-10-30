import { AIRA_SYSTEM_PROMPT, buildGroundedPrompt, validateGroundedAnswer, type GroundedResult, type GroundingEvidence } from "@/lib/domain/aira";
import { scanPrivacy } from "@/lib/domain/privacy";

/**
 * Optional LLM layer for AIRA. Off unless AIRA_LLM_API_KEY is set. Called only AFTER the three-organisation threshold has passed,
 * with approved shared copies only (GroundingEvidence). Any failure returns { ok: false } and the caller uses the deterministic answer.
 *
 *   AIRA_LLM_PROVIDER  anthropic | openai          (default anthropic)
 *   AIRA_LLM_API_KEY   provider key                (required to enable)
 *   AIRA_LLM_MODEL     model id                    (default claude-haiku-5-5 / gpt-4o-mini)
 *   AIRA_LLM_BASE_URL  OpenAI-compatible base URL  (optional, e.g. a self-hosted or alternative provider)
 *   AIRA_LLM_TIMEOUT_MS                            (default 15000)
 */
export type LlmConfig = { provider: "anthropic" | "openai"; apiKey: string; model: string; baseUrl?: string; timeoutMs: number };

export function llmConfigFromEnv(env: Record<string, string | undefined> = process.env): LlmConfig | null {
  const apiKey = env.AIRA_LLM_API_KEY?.trim();
  if (!apiKey) return null;
  const provider = env.AIRA_LLM_PROVIDER === "openai" ? "openai" : "anthropic";
  return { provider, apiKey, model: env.AIRA_LLM_MODEL?.trim() || (provider === "openai" ? "gpt-4o-mini" : "claude-haiku-5-5"),
    baseUrl: env.AIRA_LLM_BASE_URL?.trim() || undefined, timeoutMs: Number(env.AIRA_LLM_TIMEOUT_MS) || 15000 };
}

async function complete(cfg: LlmConfig, system: string, user: string, signal: AbortSignal): Promise<string> {
  if (cfg.provider === "anthropic") {
    const res = await fetch(`${cfg.baseUrl ?? "https://api.anthropic.com"}/v1/messages`, {
      method: "POST", signal,
      headers: { "content-type": "application/json", "x-api-key": cfg.apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: cfg.model, max_tokens: 600, temperature: 0.2, system, messages: [{ role: "user", content: user }] }),
    });
    if (!res.ok) throw new Error(`provider_http_${res.status}`);
    const data = await res.json() as { content?: { type: string; text?: string }[] };
    return (data.content ?? []).filter(c => c.type === "text").map(c => c.text ?? "").join("");
  }
  const res = await fetch(`${cfg.baseUrl ?? "https://api.openai.com/v1"}/chat/completions`, {
    method: "POST", signal,
    headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({ model: cfg.model, temperature: 0.2, max_tokens: 600, response_format: { type: "json_object" },
      messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
  });
  if (!res.ok) throw new Error(`provider_http_${res.status}`);
  const data = await res.json() as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content ?? "";
}

export async function groundedSynthesis(question: string, themeTitle: string, evidence: GroundingEvidence[], cfg = llmConfigFromEnv()): Promise<GroundedResult> {
  if (!cfg) return { ok: false, reason: "llm_not_configured" };
  if (!evidence.length) return { ok: false, reason: "no_evidence" };
  // The question is user-typed; never forward restricted identifiers to a third-party provider.
  if (scanPrivacy(question).length) return { ok: false, reason: "question_contains_restricted_material" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const raw = await complete(cfg, AIRA_SYSTEM_PROMPT, buildGroundedPrompt(question, themeTitle, evidence), controller.signal);
    const result = validateGroundedAnswer(raw, evidence.map(e => e.id));
    if (result.ok && scanPrivacy(result.answer).length) return { ok: false, reason: "answer_contains_restricted_material" };
    return result;
  } catch (e) {
    return { ok: false, reason: controller.signal.aborted ? "provider_timeout" : (e as Error).message?.startsWith("provider_http_") ? (e as Error).message : "provider_error" };
  } finally {
    clearTimeout(timer);
  }
}
