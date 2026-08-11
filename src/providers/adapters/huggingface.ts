// providers/adapters/huggingface.ts
// Adaptateur pour Hugging Face Router (surface OpenAI-compatible via le SDK officiel)

import OpenAI, { APIError } from 'openai';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import type {
  AdapterChatOptions,
  AdapterChatResult,
  ChatMessage,
  ProviderAdapter,
} from '../types.js';
import { requireModel } from '../requireModel.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Forme du fichier `config/credentials.json` réellement lue par cet adapter. */
interface CredentialsFile {
  familles_ia?: { HF_TOKEN?: string };
}

class HuggingFaceAdapter {
  name = 'huggingface';

  /** `null` tant qu'aucun token exploitable n'a été trouvé (voir `_initClient`). */
  client: OpenAI | null;

  constructor() {
    this.client = null;
    this._initClient();
  }

  _initClient() {
    try {
      const credsPath = join(__dirname, '..', '..', 'config', 'credentials.json');
      const creds = JSON.parse(readFileSync(credsPath, 'utf-8')) as CredentialsFile;
      const token = creds.familles_ia?.HF_TOKEN;

      if (token && !token.startsWith('VOTRE')) {
        this.client = new OpenAI({
          baseURL: 'https://router.huggingface.co/v1',
          apiKey: token,
        });
      }
    } catch {
      this.client = null;
    }
  }

  async chat(
    messages: ChatMessage[],
    options: AdapterChatOptions = {},
  ): Promise<AdapterChatResult> {
    const client = this.client;
    if (!client) {
      throw new Error('HuggingFace Adapter non initialisé (Token manquant)');
    }

    try {
      const completion = await client.chat.completions.create({
        model: requireModel(options.model, 'HuggingFace Adapter'),
        messages: messages as OpenAI.ChatCompletionMessageParam[],
        ...(typeof options.max_tokens === 'number' && { max_tokens: options.max_tokens }),
        temperature: options.temperature || 0.7,
      });

      return {
        content: completion.choices[0].message.content,
        metadata: {
          model: completion.model,
          usage: completion.usage,
        },
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[HuggingFace] Error: ${message}`);
      if (error instanceof APIError && error.status === 429) {
        throw new Error('Quota Hugging Face dépassé (Rate Limit)');
      }
      throw error;
    }
  }
}

// Export a singleton instance (since router likely expects an object with chat method)
// OR export the Class if router does `new Adapter()`.
// Based on `loadAdapters` doing `registerAdapter(name, adapter.default)`,
// and strict usage `providerRouter.chat()` which likely calls `adapter.chat()`,
// we should export an INSTANCE.
const huggingfaceAdapter: ProviderAdapter = new HuggingFaceAdapter();

export default huggingfaceAdapter;
