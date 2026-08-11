// services/voice/voiceProvider.ts
// Unified Voice Provider - Routes TTS/STT to appropriate adapters
// Features: Dynamic quota-based switching, multi-model support

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { resolveCredentials } from '../../config/keyResolver.js';

import { MinimaxTTSAdapter } from '../../providers/adapters/minimaxTTS.js';
import { GeminiTTSAdapter } from '../../providers/adapters/geminiTTS.js';
import { GttsTTSAdapter } from '../../providers/adapters/gttsTTS.js';
import { GeminiLiveAdapter } from '../../providers/adapters/geminiLive.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return String(error);
}

interface TTSModelConfig {
  provider: string;
  model: string;
  priority: number;
  [key: string]: unknown;
}

interface VoiceProviderConfig {
  debug?: boolean;
  minimax_config?: Record<string, unknown>;
  tts_models?: TTSModelConfig[];
  gemini_voices?: string[];
  live_model?: string;
  [key: string]: unknown;
}

interface SynthesizeOptions {
  model?: string;
  voice?: string;
  style?: string;
  tone?: string;
  accent?: string;
  pace?: string;
  language?: string;
  speaker_1?: string;
  speaker_2?: string;
  fallback_language?: string;
  fallbackUsed?: boolean;
  [key: string]: unknown;
}

interface SynthesizeResult {
  audioBuffer: Buffer;
  format: string;
  filePath?: string;
  [key: string]: unknown;
}

interface TTSAdapter {
  isAvailable(): boolean;
  synthesize(text: string, options: SynthesizeOptions): Promise<SynthesizeResult>;
  getAvailableVoices?(): string[];
}

interface QuotaManager {
  getAvailableKeyForModel(model: string, provider: string): Promise<number | null>;
  recordUsage(provider: string, model: string, tokens: number, keyIndex: number): Promise<void>;
}

interface Credentials {
  minimax?: string;
  gemini?: string;
  [key: string]: string | undefined;
}

function stripInlineAudioTags(text: string): string {
  return String(text || '')
    .replace(/\[[^\]\n]{1,80}\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function loadCredentials(): Credentials {
  try {
    const credsPath = join(__dirname, '..', '..', 'config', 'credentials.json');
    const creds = JSON.parse(readFileSync(credsPath, 'utf-8'));
    const resolved = resolveCredentials(creds);
    return (resolved.familles_ia as Credentials) ?? {};
  } catch (error: unknown) {
    console.warn(`[VoiceProvider] Erreur chargement credentials: ${extractErrorMessage(error)}`);
    return {};
  }
}

export class VoiceProvider {
  private config: VoiceProviderConfig;
  private quotaManager: QuotaManager | null;
  private adapters: Map<string, TTSAdapter>;
  private credentials: Credentials;

  constructor(config: VoiceProviderConfig, quotaManager: QuotaManager | null = null) {
    this.config = config ?? {};
    this.quotaManager = quotaManager;
    this.adapters = new Map();
    this.credentials = loadCredentials();
    this._initializeAdapters();
  }

  private _initializeAdapters(): void {
    const minimaxKey = this.credentials.minimax;
    const minimaxConfig = this.config.minimax_config ?? {};
    this.adapters.set(
      'minimax',
      new MinimaxTTSAdapter(minimaxKey, minimaxConfig) as unknown as TTSAdapter,
    );

    const geminiKey = this.credentials.gemini;
    this.adapters.set('gemini', new GeminiTTSAdapter(geminiKey, {}) as unknown as TTSAdapter);

    this.adapters.set('gtts', new GttsTTSAdapter({}) as unknown as TTSAdapter);

    this.adapters.set(
      'gemini_live',
      new GeminiLiveAdapter(geminiKey, { model: this.config.live_model }) as unknown as TTSAdapter,
    );

    console.log(`[VoiceProvider] 🎙️ ${this.adapters.size} adaptateurs initialisés`);
  }

  private async _trySynthesizeWithModel(
    text: string,
    modelConfig: TTSModelConfig,
    options: SynthesizeOptions,
  ): Promise<SynthesizeResult | null> {
    const { provider, model } = modelConfig;
    const adapter = this.adapters.get(provider);

    if (!adapter || !adapter.isAvailable()) {
      return null;
    }

    let selectedKeyIndex = 1;
    if (this.quotaManager) {
      const bestKey = await this.quotaManager.getAvailableKeyForModel(model, provider);
      if (bestKey === null) {
        return null;
      }
      selectedKeyIndex = bestKey;
    }

    try {
      const synthesizeOptions: SynthesizeOptions = {
        ...modelConfig,
        ...options,
        model,
      };

      const result = await adapter.synthesize(text, synthesizeOptions);

      if (this.quotaManager) {
        await this.quotaManager.recordUsage(provider, model, 0, selectedKeyIndex);
      }

      console.log(`[VoiceProvider] ✅ TTS réussi via ${provider}/${model}`);

      return {
        ...result,
        provider,
        model,
      };
    } catch (error: unknown) {
      console.error(
        '[VoiceProvider] ❌ Erreur %s/%s:',
        provider,
        model,
        extractErrorMessage(error),
      );
      return null;
    }
  }

  async textToSpeech(
    text: string,
    options: SynthesizeOptions = {},
  ): Promise<SynthesizeResult | null> {
    if (!text || text.trim().length === 0) {
      console.warn('[VoiceProvider] Texte vide, TTS ignoré');
      return null;
    }

    const ttsModels = [...(this.config.tts_models ?? [])].sort(
      (a: TTSModelConfig, b: TTSModelConfig) => a.priority - b.priority,
    );

    if (ttsModels.length === 0) {
      console.error('[VoiceProvider] ❌ Aucun modèle TTS configuré');
      return null;
    }

    for (const modelConfig of ttsModels) {
      const result = await this._trySynthesizeWithModel(text, modelConfig, options);
      if (result) return result;
    }

    console.error('[VoiceProvider] ❌ Aucun provider TTS disponible (tous épuisés ou en erreur)');
    return null;
  }

  async textToSpeechWithVoice(
    text: string,
    voiceName: string,
    options: SynthesizeOptions = {},
  ): Promise<SynthesizeResult | null> {
    const geminiAdapter = this.adapters.get('gemini');

    if (!geminiAdapter || !geminiAdapter.isAvailable()) {
      console.warn(
        '[VoiceProvider] Gemini non disponible pour voix spécifique, repli sur TTS standard',
      );
      return this.textToSpeech(text, options);
    }

    let resolvedVoice = voiceName;
    const availableVoices = geminiAdapter.getAvailableVoices?.() ?? [];
    if (voiceName && !availableVoices.includes(voiceName)) {
      console.warn(`[VoiceProvider] Voix "${voiceName}" inconnue, fallback sur Aoede`);
      resolvedVoice = 'Aoede';
    }

    try {
      const result = await geminiAdapter.synthesize(text, {
        ...options,
        voice: resolvedVoice || 'Aoede',
      });

      console.log(`[VoiceProvider] ✅ TTS Gemini réussi avec voix "${resolvedVoice || 'Aoede'}"`);

      return {
        ...result,
        provider: 'gemini',
        voice: resolvedVoice || 'Aoede',
      };
    } catch (error: unknown) {
      console.error(
        '[VoiceProvider] ❌ Erreur voix "%s":',
        resolvedVoice,
        extractErrorMessage(error),
      );
      return this.textToSpeech(text, options);
    }
  }

  private async _trySynthesizeGemini(
    cleanText: string,
    geminiAdapter: TTSAdapter,
    geminiModel: string,
    options: SynthesizeOptions,
  ): Promise<SynthesizeResult | null> {
    let geminiKeyIndex = 1;
    if (this.quotaManager) {
      const bestKey = await this.quotaManager.getAvailableKeyForModel(geminiModel, 'gemini');
      if (bestKey === null) {
        console.log(`[VoiceProvider] gemini/${geminiModel} toutes clés épuisées, fallback GTTS`);
        return null;
      }
      geminiKeyIndex = bestKey;
    }

    const availableVoices = geminiAdapter.getAvailableVoices?.() ?? [];
    const voice = availableVoices.includes(options.voice ?? '') ? options.voice : 'Aoede';

    try {
      const result = await geminiAdapter.synthesize(cleanText, {
        model: geminiModel,
        voice,
        style: options.style,
        tone: options.tone,
        accent: options.accent,
        pace: options.pace,
        language: options.language,
        speaker_1: options.speaker_1,
        speaker_2: options.speaker_2,
      });

      if (this.quotaManager) {
        await this.quotaManager.recordUsage('gemini', geminiModel, 0, geminiKeyIndex);
      }

      console.log(`[VoiceProvider] ✅ Plugin TTS via gemini/${geminiModel}`);
      return {
        ...result,
        provider: 'gemini',
        model: geminiModel,
        voice,
        fallbackUsed: false,
      };
    } catch (error: unknown) {
      console.error('[VoiceProvider] ❌ Plugin TTS Gemini échoué:', extractErrorMessage(error));
      return null;
    }
  }

  async textToSpeechGeminiFirst(
    text: string,
    options: SynthesizeOptions = {},
  ): Promise<SynthesizeResult | null> {
    if (!text || String(text).trim().length === 0) {
      console.warn('[VoiceProvider] Texte vide, TTS plugin ignoré');
      return null;
    }

    const cleanText = String(text).trim();
    const geminiAdapter = this.adapters.get('gemini');
    const geminiModel = (options.model as string) ?? 'gemini-3.1-flash-tts-preview';

    if (geminiAdapter?.isAvailable()) {
      const result = await this._trySynthesizeGemini(
        cleanText,
        geminiAdapter,
        geminiModel,
        options,
      );
      if (result) return result;
    }

    return this.textToSpeechGttsOnly(cleanText, {
      language: (options.fallback_language as string) ?? (options.language as string) ?? 'fr',
      fallbackUsed: true,
    });
  }

  async textToSpeechGttsOnly(
    text: string,
    options: SynthesizeOptions = {},
  ): Promise<SynthesizeResult | null> {
    const gttsAdapter = this.adapters.get('gtts');
    const cleanText = String(text ?? '').trim();

    if (!cleanText) {
      console.warn('[VoiceProvider] Texte vide, GTTS ignoré');
      return null;
    }

    if (!gttsAdapter?.isAvailable()) {
      console.error('[VoiceProvider] ❌ GTTS indisponible');
      return null;
    }

    try {
      const fallbackText = stripInlineAudioTags(cleanText);
      const result = await gttsAdapter.synthesize(fallbackText || cleanText, {
        language: (options.language as string) ?? 'fr',
      });

      console.log('[VoiceProvider] ✅ Plugin TTS via gtts');
      return {
        ...result,
        provider: 'gtts',
        model: 'gtts',
        fallbackUsed: options.fallbackUsed ?? false,
      };
    } catch (error: unknown) {
      console.error('[VoiceProvider] ❌ Plugin TTS GTTS échoué:', extractErrorMessage(error));
      return null;
    }
  }

  async speechToText(_audioPath: string, _options: SynthesizeOptions = {}): Promise<string | null> {
    console.warn('[VoiceProvider] STT non implémenté ici, utiliser transcriptionService');
    return null;
  }

  async voiceToVoice(
    audioPath: string,
    aiCallback: (text: string) => Promise<string>,
    options: SynthesizeOptions = {},
  ): Promise<SynthesizeResult | null> {
    const transcription = await this.speechToText(audioPath, options);
    if (!transcription) {
      console.error('[VoiceProvider] V2V: Échec transcription');
      return null;
    }

    const response = await aiCallback(transcription);
    if (!response) {
      console.error('[VoiceProvider] V2V: Échec réponse AI');
      return null;
    }

    const ttsResult = await this.textToSpeech(response, options);
    if (!ttsResult) {
      console.error('[VoiceProvider] V2V: Échec TTS');
      return null;
    }

    return {
      ...ttsResult,
      transcription,
      response,
    };
  }

  getGeminiVoices(): string[] {
    return this.config.gemini_voices ?? [];
  }

  getTTSModels(): TTSModelConfig[] {
    return this.config.tts_models ?? [];
  }

  async healthCheck(): Promise<{ tts: Record<string, string>; stt: Record<string, string> }> {
    const status: { tts: Record<string, string>; stt: Record<string, string> } = {
      tts: {},
      stt: {},
    };

    for (const [name, adapter] of this.adapters) {
      Reflect.set(status.tts, name, adapter.isAvailable() ? 'available' : 'unavailable');
    }

    return status;
  }
}
