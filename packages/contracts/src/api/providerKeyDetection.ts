// Pure, browser-safe API-key-format → provider detection.
//
// Shared by the web BYOK form (auto-detect on paste), the daemon
// `POST /api/provider/detect` endpoint, and the `od provider detect` CLI
// subcommand, so all three agree on what a key means. No network access,
// no Node APIs — the daemon strips/derives the versioned paths itself
// (see `googleGenerativeLanguageBaseUrl`), so the base URLs here are the
// canonical provider origins.
//
// The free model per provider is the cheapest reliable chat model that
// provider offers — auto-selected after detection so a pasted key just
// works. It is a cheap first pick, not a quality pick: the user can
// switch to a stronger model in the same picker afterwards. When the
// fetched live model list does not contain the free model, the Settings
// reconciliation falls back to the provider's preferred list instead of
// failing.

export type DetectedProviderProtocol = 'anthropic' | 'google' | 'openai';

export interface DetectedProvider {
  protocol: DetectedProviderProtocol;
  /** Canonical base URL for the provider. */
  baseUrl: string;
  /** Human label shown in the auto-detect notice. */
  providerLabel: string;
  /**
   * Cheapest reliable chat model for this provider — auto-selected after
   * detection. For OpenRouter this is a literally-free (`:free`) model:
   * OpenRouter's free catalogue rotates, and live-checked 2026-11-20
   * there is no DeepSeek or Qwen free variant right now — the previous
   * `deepseek/deepseek-chat` pick is paid, so it would fail or charge.
   * `nvidia/nemotron-3.5-lightning:free` (1M context, strong coder) is
   * the current free default. The model field stays editable after
   * auto-detect, so any other `:free` id can be pasted in instead.
   */
  freeModel: string;
  /** Which key shape matched, for diagnostics. */
  matchKind: string;
}

/** Cheapest reliable chat model per detectable provider protocol. */
export const FREE_MODEL_BY_DETECTED_PROTOCOL: Record<
  DetectedProviderProtocol,
  string
> = {
  anthropic: 'claude-haiku-4-5',
  google: 'gemini-3.8-flash',
  openai: 'gpt-4o-mini',
};

const GOOGLE_GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com';

/** Legacy AI Studio keys (AIza…) and service-account-bound keys (AQ.…). */
function isGoogleGeminiApiKeyShape(apiKey: string): boolean {
  if (apiKey.startsWith('AIza')) return true;
  // https://docs.cloud.google.com/docs/authentication/api-keys#api-keys-bound-sa
  return /^AQ\.[A-Za-z0-9_-]{20,}$/.test(apiKey);
}

/**
 * Detect the provider a pasted API key belongs to, from the key format
 * alone. Returns null when the key matches no known shape — callers must
 * leave the current provider/base URL untouched in that case.
 *
 * Order matters: `sk-or-` and `sk-ant-` must be checked before the generic
 * `sk-` rule, and the Google shape before it (a Google key never starts
 * with `sk-`, but keeping the specific rules first keeps the intent clear).
 */
export function detectProviderFromApiKey(
  apiKey: string,
): DetectedProvider | null {
  const key = apiKey.trim();
  if (!key) return null;
  if (key.startsWith('sk-ant-')) {
    return {
      protocol: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      providerLabel: 'Anthropic (Claude)',
      freeModel: FREE_MODEL_BY_DETECTED_PROTOCOL.anthropic,
      matchKind: 'sk-ant-',
    };
  }
  if (key.startsWith('sk-or-')) {
    return {
      protocol: 'openai',
      baseUrl: 'https://openrouter.ai/api/v1',
      providerLabel: 'OpenRouter',
      freeModel: 'nvidia/nemotron-3.5-lightning:free',
      matchKind: 'sk-or-',
    };
  }
  if (key.startsWith('xai-')) {
    return {
      protocol: 'openai',
      baseUrl: 'https://api.x.ai/v1',
      providerLabel: 'xAI',
      freeModel: 'grok-3-mini',
      matchKind: 'xai-',
    };
  }
  if (key.startsWith('gsk_')) {
    return {
      protocol: 'openai',
      baseUrl: 'https://api.groq.com/openai/v1',
      providerLabel: 'Groq',
      // Groq's free tier covers all its models under rate limits;
      // llama-3.3-70b-versatile is the flagship free chat model. The user
      // has several Groq keys (Hermes runs 7 Groq connections) — a pasted
      // gsk_ key must detect instead of silently doing nothing.
      freeModel: 'llama-3.3-70b-versatile',
      matchKind: 'gsk_',
    };
  }
  if (isGoogleGeminiApiKeyShape(key)) {
    return {
      protocol: 'google',
      baseUrl: GOOGLE_GEMINI_BASE_URL,
      providerLabel: 'Google Gemini',
      freeModel: FREE_MODEL_BY_DETECTED_PROTOCOL.google,
      matchKind: 'google-key',
    };
  }
  if (key.startsWith('sk-')) {
    return {
      protocol: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      providerLabel: 'OpenAI',
      freeModel: FREE_MODEL_BY_DETECTED_PROTOCOL.openai,
      matchKind: 'sk-',
    };
  }
  return null;
}

export interface ProviderDetectRequest {
  apiKey: string;
}

export interface ProviderDetectResponse {
  detected: boolean;
  protocol: DetectedProviderProtocol | null;
  baseUrl: string | null;
  freeModel: string | null;
  providerLabel: string | null;
}

export function detectProviderResponse(
  apiKey: string,
): ProviderDetectResponse {
  const detected = detectProviderFromApiKey(apiKey);
  if (!detected) {
    return {
      detected: false,
      protocol: null,
      baseUrl: null,
      freeModel: null,
      providerLabel: null,
    };
  }
  return {
    detected: true,
    protocol: detected.protocol,
    baseUrl: detected.baseUrl,
    freeModel: detected.freeModel,
    providerLabel: detected.providerLabel,
  };
}
