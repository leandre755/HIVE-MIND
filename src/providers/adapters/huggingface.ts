// providers/adapters/huggingface.ts
// Adaptateur pour Hugging Face Router (surface OpenAI-compatible via le SDK officiel)

import OpenAI, { APIError } from 'openai';
import { safeReadFileSync } from '../../utils/safeFs.js';
import { resolveConfigPath } from '../../config/ConfigPathResolver.js';

import { resolveApiKey } from '../../config/keyResolver.js';

import type {
  AdapterChatOptions,
  AdapterChatResult,
  ChatMessage,
  ProviderAdapter,
} from '../types.js';
import { requireModel } from '../requireModel.js';

/** Forme du fichier `config/credentials.json` réellement lue par cet adapter. */
interface CredentialsFile {
  familles_ia?: {
    HF_TOKEN?: string;
    huggingface?: string;
    [key: string]: unknown;
  };
}

function isValidHfToken(token?: string | null): token is string {
  if (!token || typeof token !== 'string') return false;
  const trimmed = token.trim();
  return trimmed !== '' && !trimmed.startsWith('VOTRE') && !trimmed.startsWith('${');
}

function resolveHfToken(creds?: CredentialsFile | null): string | null {
  const candidates: (string | undefined)[] = [
    creds?.familles_ia?.huggingface,
    creds?.familles_ia?.HF_TOKEN,
    process.env.HF_TOKEN,
    process.env.HUGGINGFACE_KEY,
  ];

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'string') continue;
    const resolved = resolveApiKey(candidate, 'huggingface');
    if (isValidHfToken(resolved)) {
      return resolved;
    }
  }

  return null;
}

export class HuggingFaceAdapter {
  name = 'huggingface';

  /** `null` tant qu'aucun token exploitable n'a été trouvé (voir `_initClient`). */
  client: OpenAI | null;

  constructor() {
    this.client = null;
    this._initClient();
  }

  _initClient() {
    let creds: CredentialsFile | null = null;
    try {
      const credsPath = resolveConfigPath('credentials.json');
      creds = JSON.parse(safeReadFileSync(credsPath, 'utf-8')) as CredentialsFile;
    } catch {
      // Ignoré : creds conserve sa valeur initiale null
    }

    const token = resolveHfToken(creds);
    if (token) {
      this.client = new OpenAI({
        baseURL: 'https://router.huggingface.co/v1',
        apiKey: token,
      });
    } else {
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
        throw new Error('Quota Hugging Face dépassé (Rate Limit)', { cause: error });
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
