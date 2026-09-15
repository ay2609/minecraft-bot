import OpenAI, { RateLimitError, BadRequestError } from 'openai';

export type LLMResult =
  | { ok: true; data: unknown }
  | { ok: false; kind: 'rate_limit' | 'context_length' | 'parse_failure' | 'api_error'; message: string; attempt: number };

export type LLMCallFn = (
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  modelId: string,
) => Promise<OpenAI.Chat.Completions.ChatCompletion>;

function preview(text: string, maxChars = 240): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > maxChars ? `${normalized.slice(0, maxChars)}...` : normalized;
}

export class FireworksLLMClient {
  private readonly callFn: LLMCallFn;
  private readonly modelId: string;

  constructor(apiKey: string, modelId: string, callFn?: LLMCallFn) {
    this.modelId = modelId;
    if (callFn) {
      // Injected stub (for tests)
      this.callFn = callFn;
    } else {
      const client = new OpenAI({
        apiKey,
        baseURL: 'https://api.fireworks.ai/inference/v1',
        maxRetries: 0, // Surface RateLimitError immediately; we manage retries
      });
      this.callFn = (messages, model) =>
        client.chat.completions.create({
          model,
          messages,
          response_format: { type: 'json_object' },
          max_tokens: 1024,
        });
    }
  }

  async call(messages: OpenAI.Chat.ChatCompletionMessageParam[]): Promise<LLMResult> {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        console.log(
          `[LLMClient] request model=${this.modelId} attempt=${attempt} messages=${messages.length}`,
        );
        const response = await this.callFn(messages, this.modelId);
        const choice = response.choices[0];
        const content = choice?.message?.content ?? '';
        console.log(
          `[LLMClient] response attempt=${attempt} finish=${choice?.finish_reason ?? 'unknown'} chars=${content.length} preview=${preview(content)}`,
        );

        // Check for truncated output BEFORE attempting JSON parse
        if (choice?.finish_reason === 'length') {
          return {
            ok: false,
            kind: 'context_length',
            message: 'finish_reason=length; output truncated at max_tokens',
            attempt,
          };
        }

        try {
          return { ok: true, data: JSON.parse(content) };
        } catch {
          console.warn(
            `[LLMClient] parse failure attempt=${attempt} preview=${preview(content)}`,
          );
          if (attempt === 2) {
            return {
              ok: false,
              kind: 'parse_failure',
              message: `JSON parse failed after ${attempt} attempt(s)`,
              attempt,
            };
          }
          // Fall through to retry
        }
      } catch (error) {
        if (error instanceof RateLimitError) {
          console.warn(`[LLMClient] rate-limit attempt=${attempt} message=${error.message}`);
          return { ok: false, kind: 'rate_limit', message: error.message, attempt };
        }
        if (error instanceof BadRequestError) {
          // The openai SDK stores the raw body in error.error; the nested error object
          // is at error.error.error (body.error) with the code field inside it.
          const body = error.error as Record<string, unknown> | null;
          const nested = body?.['error'] as Record<string, unknown> | undefined;
          const code = nested?.['code'];
          if (code === 'context_length_exceeded') {
            console.warn(`[LLMClient] context-length attempt=${attempt} message=${error.message}`);
            return { ok: false, kind: 'context_length', message: error.message, attempt };
          }
          console.warn(`[LLMClient] api-error attempt=${attempt} message=${error.message}`);
          return { ok: false, kind: 'api_error', message: error.message, attempt };
        }
        console.warn(`[LLMClient] unexpected-error attempt=${attempt} message=${String(error)}`);
        return { ok: false, kind: 'api_error', message: String(error), attempt };
      }
    }
    // Unreachable — TypeScript needs explicit return
    return { ok: false, kind: 'api_error', message: 'Unexpected loop exit', attempt: 2 };
  }
}
