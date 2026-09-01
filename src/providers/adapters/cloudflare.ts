// providers/adapters/cloudflare.ts
// Adaptateur pour Cloudflare Workers AI
// Base URL: https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1

import type {
  AdapterChatOptions,
  AdapterChatResult,
  ChatMessage,
  OpenAIChatRequestBody,
  OpenAIChatResponse,
  ProviderAdapter,
} from '../types.js';
import { requireModel } from '../requireModel.js';

/**
 * Cloudflare enveloppe la réponse compatible OpenAI dans un champ `result` et
 * renvoie ses erreurs sous forme de tableau `errors[]` — deux écarts réels par
 * rapport aux autres fournisseurs OpenAI-compatible du dossier.
 */
interface CloudflareChatResponse {
  result: OpenAIChatResponse;
}

interface CloudflareErrorResponse {
  errors?: { message?: string }[];
}

export default {
  name: 'cloudflare',

  async chat(messages: ChatMessage[], options: AdapterChatOptions): Promise<AdapterChatResult> {
    const { model, apiKey, tools, temperature = 0.7 } = options;
    // Account ID doit être dans apiKey (format: account_id:api_token)
    const [accountId, apiToken] = (apiKey || '').split(':');
    if (!accountId || !apiToken) {
      throw new Error('[Cloudflare] apiKey doit être au format account_id:api_token');
    }

    const modelId = requireModel(model, 'Cloudflare Adapter');

    const body: OpenAIChatRequestBody = {
      model: modelId,
      messages: messages.map((m: ChatMessage) => ({
        role: m.role,
        content: m.content,
        ...(m.tool_calls && { tool_calls: m.tool_calls }),
        ...(m.tool_call_id && { tool_call_id: m.tool_call_id }),
      })),
      temperature,
      max_tokens: 4096,
    };

    if (tools?.length) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90000);

    try {
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1/chat/completions`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        },
      );

      clearTimeout(timeoutId);

      if (!response.ok) {
        const error = (await response.json().catch(() => ({
          errors: [{ message: response.statusText }],
        }))) as CloudflareErrorResponse;
        throw new Error(error.errors?.[0]?.message || `Erreur Cloudflare (${response.status})`);
      }

      const data = (await response.json()) as CloudflareChatResponse;
      const choice = data.result.choices[0];

      return {
        content: choice.message.content,
        toolCalls: choice.message.tool_calls || null,
        finishReason: choice.finish_reason,
        usage: data.result.usage,
      };
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error('[Cloudflare] Timeout (90s)', { cause: err });
      }
      throw err;
    }
  },
} satisfies ProviderAdapter;
