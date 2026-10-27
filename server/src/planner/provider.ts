export interface ModelClient {
  model: string;
  complete(input: {
    system: string;
    user: string;
    signal?: AbortSignal;
  }): Promise<string>;
}

export interface ProviderConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  maxTokens: number;
}

export class ModelCallError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'ModelCallError';
  }
}

const DEFAULT_BASE_URL = 'http://127.0.0.1:11434/v1';
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_TOKENS = 1_200;

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Reads planner configuration from the server environment.
 * Missing key, base URL, or model disables AI planning; the caller falls back.
 */
export function loadProviderConfig(
  env: NodeJS.ProcessEnv = process.env,
): ProviderConfig | null {
  const apiKey = env.ANIRA_PLANNER_API_KEY?.trim();
  const model = env.ANIRA_PLANNER_MODEL?.trim();
  const baseUrl = (env.ANIRA_PLANNER_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(
    /\/+$/,
    '',
  );

  if (!apiKey || !model) {
    return null;
  }

  return {
    apiKey,
    baseUrl,
    model,
    timeoutMs: positiveInteger(env.ANIRA_PLANNER_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    maxTokens: positiveInteger(env.ANIRA_PLANNER_MAX_TOKENS, DEFAULT_MAX_TOKENS),
  };
}

export function createOpenAiCompatibleClient(config: ProviderConfig): ModelClient {
  return {
    model: config.model,
    async complete({ system, user, signal }) {
      let response: Response;

      try {
        response = await fetch(`${config.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify({
            model: config.model,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user },
            ],
            temperature: 0.1,
            max_tokens: config.maxTokens,
            stream: false,
          }),
          signal,
        });
      } catch {
        throw new ModelCallError('provider_unreachable');
      }

      if (!response.ok) {
        throw new ModelCallError(`provider_status_${response.status}`);
      }

      let payload: unknown;

      try {
        payload = await response.json();
      } catch {
        throw new ModelCallError('provider_invalid_response');
      }

      const content =
        typeof payload === 'object' && payload !== null
          ? (payload as { choices?: Array<{ message?: { content?: unknown } }> })
              .choices?.[0]?.message?.content
          : undefined;

      if (typeof content !== 'string' || content.trim().length === 0) {
        throw new ModelCallError('provider_empty_response');
      }

      return content;
    },
  };
}