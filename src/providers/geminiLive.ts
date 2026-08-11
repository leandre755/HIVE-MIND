// providers/geminiLive.ts
// providers/geminiLive.js
// Provider pour Gemini 2.5 Flash Native Audio via Live API (WebSocket)
// Supporte: Transcription vocale, Réponses HD, Détection d'émotion, Tool calling

import {
  GoogleGenAI,
  Modality,
  type FunctionCall,
  type FunctionDeclaration,
  type FunctionResponse,
  type LiveConnectConfig,
  type LiveServerMessage,
  type LiveServerToolCall,
  type Part,
  type Session,
} from '@google/genai';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { safeWriteFile } from '../utils/safeFs.js';
import { requireModel } from './requireModel.js';

/**
 * Voix HD disponibles (30 voix, 24 langues)
 */
export const HD_VOICES = {
  // Voix principales
  ZEPHYR: 'Zephyr', // Neutre, professionnel
  PUCK: 'Puck', // Joueur, énergique
  KORE: 'Kore', // Doux, empathique
  ACHERNAR: 'Achernar', // Profond, autoritaire
  ACHIRD: 'Achird', // Clair, articulé
  ALGENIB: 'Algenib', // Chaleureux, amical
  // ... autres voix disponibles via l'API
};

/** Intervalle de scrutation de la file de messages du WebSocket. */
const RESPONSE_POLL_INTERVAL_MS = 100;

/** Fréquence d'échantillonnage du flux PCM renvoyé par la Live API. */
const LIVE_AUDIO_SAMPLE_RATE = 24000;

/**
 * Callback d'exécution d'outil. La valeur retournée alimente directement
 * `FunctionResponse.response`, dont le contrat upstream est
 * `Record<string, unknown>`.
 */
export type LiveToolCallHandler = (call: FunctionCall) => Promise<Record<string, unknown>>;

/** Options de construction du provider. */
export interface GeminiLiveProviderOptions {
  /** Identifiant résolu depuis `models_config.json` — aucun défaut local. */
  model?: string;
  voice?: string;
  tools?: FunctionDeclaration[];
  onToolCall?: LiveToolCallHandler | null;
}

/** Options d'un appel unitaire (`processAudio`, `textToSpeech`). */
export interface GeminiLiveCallOptions {
  voice?: string;
}

/**
 * Résultat d'un tour de conversation Live.
 *
 * `audioParts` conserve les fragments base64 bruts : `textToSpeech` les
 * réutilise pour bâtir l'en-tête WAV, que `audioBuffer` (déjà concaténé) ne
 * permet plus de reconstituer sans redécoder.
 */
export interface GeminiLiveResponse {
  audioParts: string[];
  audioBuffer: Buffer | null;
  transcription: string;
  /**
   * Toujours `null` en l'état : la Live API n'expose pas de champ d'émotion sur
   * `serverContent`. Le champ est conservé car `GeminiLiveAdapter.transcribe`
   * le relaie à ses appelants.
   */
  emotion: string | null;
  /** Renseigné par `textToSpeech` seulement, après écriture du fichier WAV. */
  filePath?: string;
}

/** Identifiants tels que lus dans `config/credentials.json`. */
export interface GeminiLiveCredentials {
  familles_ia?: { gemini?: string };
}

/**
 * Accumule les fragments d'un tour du modèle.
 *
 * Les fragments audio sans charge utile sont ignorés : `Blob.data` est
 * optionnel dans le contrat upstream, et un `undefined` poussé dans la liste
 * ferait échouer `Buffer.from` à la concaténation.
 *
 * @param parts Fragments reçus dans `serverContent.modelTurn.parts`.
 * @param audioParts Accumulateur de fragments base64, muté en place.
 * @returns Le texte concaténé des fragments textuels.
 */
function collectTurnParts(parts: Part[], audioParts: string[]): string {
  let text = '';
  for (const part of parts) {
    if (part.inlineData?.data) {
      audioParts.push(part.inlineData.data);
    }
    if (part.text) {
      text += part.text;
    }
  }
  return text;
}

/**
 * Provider Gemini Live Audio
 * Utilise le WebSocket Live API pour l'audio natif
 */
export class GeminiLiveProvider {
  ai: GoogleGenAI;
  model: string;
  defaultVoice: string;
  tools: FunctionDeclaration[];
  onToolCall: LiveToolCallHandler | null;

  constructor(apiKey: string, options: GeminiLiveProviderOptions = {}) {
    this.ai = new GoogleGenAI({ apiKey });
    this.model = requireModel(options.model, 'GeminiLiveProvider');
    this.defaultVoice = options.voice ?? HD_VOICES.ZEPHYR;
    this.tools = options.tools ?? [];
    this.onToolCall = options.onToolCall ?? null;
  }

  /**
   * Configure les outils disponibles pour le modèle
   * @param tools Déclarations de fonctions au format Gemini.
   */
  setTools(tools: FunctionDeclaration[]): void {
    this.tools = tools;
  }

  /**
   * Définit le callback pour les appels d'outils
   * @param callback Exécuteur appelé pour chaque `FunctionCall` reçu.
   */
  setToolCallback(callback: LiveToolCallHandler): void {
    this.onToolCall = callback;
  }

  /**
   * Traite un message audio et retourne une réponse audio
   * @param audioBuffer Audio PCM 16-bit, 16 kHz, mono.
   * @param options Voix de réponse ; à défaut celle du provider.
   * @returns Le tour complet du modèle (audio, transcription).
   * @throws {Error} Toute erreur de connexion ou de session, après fermeture
   *   de la session pour ne pas laisser le WebSocket ouvert.
   */
  async processAudio(
    audioBuffer: Buffer,
    options: GeminiLiveCallOptions = {},
  ): Promise<GeminiLiveResponse> {
    const voice = options.voice ?? this.defaultVoice;
    const responseQueue: LiveServerMessage[] = [];
    let session: Session | undefined;

    try {
      const config: LiveConnectConfig = {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: voice,
            },
          },
        },
        contextWindowCompression: {
          triggerTokens: '25600',
          slidingWindow: { targetTokens: '12800' },
        },
      };

      // Ajouter les outils si configurés
      if (this.tools.length > 0) {
        config.tools = [{ functionDeclarations: this.tools }];
      }

      // Connexion WebSocket
      session = await this.ai.live.connect({
        model: this.model,
        config,
        callbacks: {
          onopen: () => console.log('[GeminiLive] Session ouverte'),
          onmessage: (message: LiveServerMessage) => responseQueue.push(message),
          onerror: (e: ErrorEvent) => console.error('[GeminiLive] Erreur:', e.message),
          onclose: () => console.log('[GeminiLive] Session fermée'),
        },
      });

      // Envoyer l'audio
      session.sendRealtimeInput({
        media: {
          mimeType: 'audio/pcm;rate=16000',
          data: audioBuffer.toString('base64'),
        },
      });

      // Attendre la réponse complète
      const response = await this._waitForResponse(responseQueue, session);

      session.close();
      return response;
    } catch (error: unknown) {
      console.error('[GeminiLive] Erreur processAudio:', error);
      if (session) session.close();
      throw error;
    }
  }

  /**
   * Génère une réponse audio à partir de texte (TTS HD)
   * @param text Texte à convertir en audio.
   * @param options Voix de synthèse ; à défaut celle du provider.
   * @returns Le tour du modèle, `filePath` renseigné vers un WAV temporaire
   *   dès qu'au moins un fragment audio a été reçu.
   * @throws {Error} Toute erreur de connexion, de session ou d'écriture, après
   *   fermeture de la session.
   */
  async textToSpeech(
    text: string,
    options: GeminiLiveCallOptions = {},
  ): Promise<GeminiLiveResponse> {
    const voice = options.voice ?? this.defaultVoice;
    const responseQueue: LiveServerMessage[] = [];
    let session: Session | undefined;

    try {
      const config: LiveConnectConfig = {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: voice,
            },
          },
        },
      };

      session = await this.ai.live.connect({
        model: this.model,
        config,
        callbacks: {
          onmessage: (message: LiveServerMessage) => responseQueue.push(message),
          onerror: (e: ErrorEvent) => console.error('[GeminiLive] TTS Error:', e.message),
        },
      });

      // Envoyer le texte
      session.sendClientContent({
        turns: [text],
      });

      // Attendre l'audio
      const response = await this._waitForResponse(responseQueue, session);

      session.close();

      // Sauvegarder en fichier WAV
      if (response.audioBuffer) {
        const filePath = join(tmpdir(), `gemini_tts_${randomUUID()}.wav`);
        const wavBuffer = this._createWavBuffer(response.audioParts, LIVE_AUDIO_SAMPLE_RATE);
        await safeWriteFile(filePath, wavBuffer);
        response.filePath = filePath;
      }

      return response;
    } catch (error: unknown) {
      console.error('[GeminiLive] Erreur TTS:', error);
      if (session) session.close();
      throw error;
    }
  }

  /**
   * Exécute les outils demandés par le modèle et renvoie leurs résultats.
   *
   * @param toolCall Bloc `toolCall` du message serveur.
   * @param session Session ouverte, utilisée pour la réponse.
   */
  private async _respondToToolCall(toolCall: LiveServerToolCall, session: Session): Promise<void> {
    const handler = this.onToolCall;
    if (!handler) return;

    console.log('[GeminiLive] Tool call:', toolCall.functionCalls);

    const results: FunctionResponse[] = [];
    for (const call of toolCall.functionCalls ?? []) {
      const result = await handler(call);
      results.push({
        name: call.name,
        id: call.id,
        response: result,
      });
    }

    session.sendToolResponse({ functionResponses: results });
  }

  /**
   * Attend la réponse complète du modèle.
   *
   * INVARIANT : ne retourne qu'après réception d'un `turnComplete`. Les
   * fragments audio accumulés dans `audioParts` sont dans l'ordre d'arrivée,
   * ce dont dépend la validité du WAV produit par `_createWavBuffer`.
   *
   * @private
   */
  private async _waitForResponse(
    queue: LiveServerMessage[],
    session: Session,
  ): Promise<GeminiLiveResponse> {
    const audioParts: string[] = [];
    let transcription = '';
    const emotion: string | null = null;
    let done = false;

    while (!done) {
      const message = queue.shift();

      if (!message) {
        await new Promise((resolve) => setTimeout(resolve, RESPONSE_POLL_INTERVAL_MS));
        continue;
      }

      // Traiter le contenu du serveur
      if (message.serverContent) {
        const content = message.serverContent;

        // Fin du tour
        if (content.turnComplete) {
          done = true;
          continue;
        }

        // Parties du modèle
        if (content.modelTurn?.parts) {
          transcription += collectTurnParts(content.modelTurn.parts, audioParts);
        }
      }

      // Appel d'outil
      if (message.toolCall && this.onToolCall) {
        await this._respondToToolCall(message.toolCall, session);
      }
    }

    return {
      audioParts,
      audioBuffer:
        audioParts.length > 0
          ? Buffer.concat(audioParts.map((d: string) => Buffer.from(d, 'base64')))
          : null,
      transcription: transcription.trim(),
      emotion,
    };
  }

  /**
   * Crée un buffer WAV (PCM 16-bit mono) à partir de fragments base64.
   *
   * @param pcmParts Fragments PCM encodés en base64, dans l'ordre d'arrivée.
   * @param sampleRate Fréquence d'échantillonnage à inscrire dans l'en-tête.
   * @private
   */
  private _createWavBuffer(
    pcmParts: string[],
    sampleRate: number = LIVE_AUDIO_SAMPLE_RATE,
  ): Buffer {
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
    const blockAlign = (numChannels * bitsPerSample) / 8;

    const pcmBuffer = Buffer.concat(pcmParts.map((d: string) => Buffer.from(d, 'base64')));
    const dataLength = pcmBuffer.length;

    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + dataLength, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(numChannels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write('data', 36);
    header.writeUInt32LE(dataLength, 40);

    return Buffer.concat([header, pcmBuffer]);
  }
}

/**
 * Construit le provider depuis les identifiants du dépôt.
 *
 * @throws {Error} Si `familles_ia.gemini` est absent : échec fermé plutôt
 *   qu'une session ouverte sans clé.
 */
export function createGeminiLiveProvider(
  credentials: GeminiLiveCredentials,
  options: GeminiLiveProviderOptions = {},
): GeminiLiveProvider {
  const apiKey = credentials.familles_ia?.gemini;
  if (!apiKey) {
    throw new Error('[GeminiLive] Clé API Gemini manquante');
  }
  return new GeminiLiveProvider(apiKey, options);
}

export default GeminiLiveProvider;
