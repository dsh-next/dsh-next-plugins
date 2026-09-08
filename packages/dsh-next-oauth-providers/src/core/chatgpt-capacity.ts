/**
 * ChatGPT OAuth (`openai-codex`) keeps pi-ai models and auth. Context / max
 * output defaults follow official OpenAI API cards, not the 272K Codex
 * listing. A stored Customized-settings value still wins.
 */

export const CHATGPT_OAUTH_FALLBACK_CONTEXT_WINDOW = 1_050_000
export const CHATGPT_OAUTH_FALLBACK_MAX_TOKENS = 128_000

export interface ChatGptCapacity {
  readonly contextWindow: number
  readonly maxTokens: number
}

/** Official API sizes keyed by pi-ai / Codex model id. */
export const CHATGPT_OAUTH_CAPACITIES: Readonly<Record<string, ChatGptCapacity>> = {
  'gpt-5.3-codex-spark': { contextWindow: 128_000, maxTokens: 128_000 },
  'gpt-5.4': { contextWindow: 1_050_000, maxTokens: 128_000 },
  'gpt-5.4-mini': { contextWindow: 400_000, maxTokens: 128_000 },
  'gpt-5.5': { contextWindow: 1_050_000, maxTokens: 128_000 },
  'gpt-5.6-luna': { contextWindow: 1_050_000, maxTokens: 128_000 },
  'gpt-5.6-sol': { contextWindow: 1_050_000, maxTokens: 128_000 },
  'gpt-5.6-terra': { contextWindow: 1_050_000, maxTokens: 128_000 },
  'gpt-6-astra': { contextWindow: 1_050_000, maxTokens: 128_000 },
}

export function chatgptOauthCapacity(modelId: string): ChatGptCapacity {
  return CHATGPT_OAUTH_CAPACITIES[modelId] ?? {
    contextWindow: CHATGPT_OAUTH_FALLBACK_CONTEXT_WINDOW,
    maxTokens: CHATGPT_OAUTH_FALLBACK_MAX_TOKENS,
  }
}
