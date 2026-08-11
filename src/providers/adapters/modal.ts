// providers/adapters/modal.ts
// Adaptateur pour Modal (Serverless GPU, OpenAI-compatible)
// Base URL: dépend de l'app déployée sur Modal

import type {
  AdapterChatOptions,
  AdapterChatResult,
  ApiErrorResponse,
  ChatMessage,
  OpenAIChatRequestBody,
  OpenAIChatResponse,
  ProviderAdapter,
} from '../types.js';

export default {
  name: 'modal',

  async chat(messages: ChatMessage[], options: AdapterChatOptions): Promise<AdapterChatResult> {
    const { model, apiKey, tools, temperature = 0.7 } = options;
    // Modal utilise un URL d'app personnalisé, le model sert d'URL de base
    const baseUrl = model || 'https://YOUR_APP--YOUR_USER.modal.run';

    const body: Omit<OpenAIChatRequestBody, 'model'> = {
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
    const timeoutId = setTimeout(() => controller.abort(), 120000); // 120s pour Modal (cold starts)

    try {
      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const error = (await response
          .json()
          .catch(() => ({ error: { message: response.statusText } }))) as ApiErrorResponse;
        throw new Error(error.error?.message || `Erreur Modal (${response.status})`);
      }

      const data = (await response.json()) as OpenAIChatResponse;
      const choice = data.choices[0];

      return {
        content: choice.message.content,
        toolCalls: choice.message.tool_calls || null,
        finishReason: choice.finish_reason,
        usage: data.usage,
      };
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error('[Modal] Timeout (120s)');
      }
      throw err;
    }
  },
} satisfies ProviderAdapter;
