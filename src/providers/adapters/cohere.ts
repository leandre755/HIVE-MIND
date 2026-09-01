// providers/adapters/cohere.ts
// Adaptateur pour Cohere (Command A, Aya)
// Base URL: https://api.cohere.com/v2

import type {
  AdapterChatOptions,
  AdapterChatResult,
  ChatMessage,
  ProviderAdapter,
  ToolCall,
  ToolDefinition,
} from '../types.js';
import { requireModel } from '../requireModel.js';

/**
 * Corps de requête Cohere v2. Trois écarts réels avec le protocole OpenAI :
 * les messages `system` sont extraits dans un champ `system` dédié, il n'y a
 * pas de `tool_choice`, et les outils sont reconstruits explicitement.
 */
interface CohereChatRequestBody {
  model: string;
  messages: {
    role: string;
    content?: string | unknown[] | null;
    tool_calls?: ToolCall[];
    tool_call_id?: string;
  }[];
  temperature?: number;
  max_tokens?: number;
  system?: string;
  tools?: ToolDefinition[];
}

/** Réponse `POST /v2/chat` : le contenu est une liste de fragments typés. */
interface CohereChatResponse {
  message: {
    content?: { text?: string }[];
    tool_calls?: ToolCall[] | null;
  };
  finish_reason?: string;
  /** Cohere nomme ses compteurs `input_tokens` / `output_tokens`. */
  usage?: { input_tokens?: number; output_tokens?: number };
}

interface CohereErrorResponse {
  message?: string;
}

export default {
  name: 'cohere',

  async chat(messages: ChatMessage[], options: AdapterChatOptions): Promise<AdapterChatResult> {
    const { model, apiKey, tools, temperature = 0.7 } = options;
    const modelId = requireModel(model, 'Cohere Adapter');

    // Cohere v2 utilise un format natif différent d'OpenAI
    const systemMsgs = messages.filter((m: ChatMessage) => m.role === 'system');
    const chatMsgs = messages.filter((m: ChatMessage) => m.role !== 'system');

    const body: CohereChatRequestBody = {
      model: modelId,
      messages: chatMsgs.map((m: ChatMessage) => ({
        role: m.role,
        content: m.content,
        ...(m.tool_calls && { tool_calls: m.tool_calls }),
        ...(m.tool_call_id && { tool_call_id: m.tool_call_id }),
      })),
      temperature,
      max_tokens: 4096,
    };

    if (systemMsgs.length > 0) {
      body.system = systemMsgs.map((m: ChatMessage) => String(m.content ?? '')).join('\n');
    }

    if (tools?.length) {
      body.tools = tools.map((t: ToolDefinition) => ({
        type: 'function',
        function: {
          name: t.function.name,
          description: t.function.description,
          parameters: t.function.parameters,
        },
      }));
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    try {
      const response = await fetch('https://api.cohere.com/v2/chat', {
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
          .catch(() => ({ message: response.statusText }))) as CohereErrorResponse;
        throw new Error(error.message || `Erreur Cohere (${response.status})`);
      }

      const data = (await response.json()) as CohereChatResponse;

      // Cohere v2 retourne un format différent
      const message = data.message;
      const toolCalls = message.tool_calls || null;
      const content = message.content?.map((c) => c.text ?? '').join('') || '';

      return {
        content,
        toolCalls,
        finishReason: data.finish_reason || 'stop',
        usage: data.usage
          ? {
              prompt_tokens: data.usage.input_tokens,
              completion_tokens: data.usage.output_tokens,
              total_tokens: (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0),
            }
          : undefined,
      };
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error('[Cohere] Timeout (60s)', { cause: err });
      }
      throw err;
    }
  },
} satisfies ProviderAdapter;
