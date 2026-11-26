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

/** Délai maximal d'attente Live API (ms), borne 32-bit Node et plafond messages. */
const [DEF_TIMEOUT_MS, MAX_TIMEOUT_MS, MAX_TURN_MESSAGES] = [30_000, 2_147_483_647, 10_000];

/** Fréquence d'échantillonnage du flux PCM renvoyé par la Live API. */
const LIVE_AUDIO_SAMPLE_RATE = 24000;

/** Exécuteur d'outil (`signal` annulé sur `toolCallCancellation` ou fin de session). */
type ToolRes = Record<string, unknown>;
export type LiveToolCallHandler = (call: FunctionCall, signal: AbortSignal) => Promise<ToolRes>;

/** Options de configuration de l'adapter Live (`model` résolu possible au moment de l'appel). */
export interface GeminiLiveAdapterOptions {
  /** Identifiant résolu depuis `models_config.json` — aucun défaut local. */
  model?: string;
  voice?: string;
  tools?: FunctionDeclaration[];
  onToolCall?: LiveToolCallHandler | null;
  apiVersion?: string;
  timeoutMs?: number;
}

/** Options de construction du provider (`model` requis à l'instanciation). */
export type GeminiLiveProviderOptions = GeminiLiveAdapterOptions & { model: string };

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

function normalizeGeminiApiKey(rawKey: unknown): string {
  const k = typeof rawKey === 'string' ? rawKey.trim() : '';
  if (!k || k.toLowerCase() === 'no_key') throw new Error('[GeminiLive] Clé API Gemini manquante');
  return k;
}
class LiveTimeoutError extends Error {
  constructor() {
    super("[GeminiLive] Délai d'attente Live API dépassé");
  }
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

type LiveTurnState = { error: Error | null; closed: boolean; wakeup: (() => void) | null };
type TurnBase = { queue: LiveServerMessage[]; session: Session; state: LiveTurnState };
type TurnC = TurnBase & { cancelledIds: Set<string>; deadlineMs: number };
type LiveTurnContext = TurnC & { aborts: Map<string, AbortController> };
async function raceWithDeadline<T>(p: Promise<T>, deadlineMs: number, onLate?: (v: T) => void) {
  const ms = deadlineMs - Date.now();
  if (ms <= 0) {
    p.then(onLate, () => {}).catch(() => {});
    throw new LiveTimeoutError();
  }
  let done = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tout = new Promise<never>((_, rej) => {
    timer = setTimeout(() => {
      done = true;
      rej(new LiveTimeoutError());
    }, ms);
  });
  const tracked = p.then((v) => {
    if (done && onLate) onLate(v);
    return v;
  });
  tracked.catch(() => {});
  try {
    return await Promise.race([tracked, tout]);
  } finally {
    done = true;
    clearTimeout(timer);
  }
}
function awaitToolOrTurnEnd(fnP: Promise<ToolRes>, sig: AbortSignal) {
  fnP.catch(() => {});
  if (sig.aborted) return Promise.resolve(null);
  let stop: (() => void) | undefined;
  const endP = new Promise<null>((r) => {
    stop = () => r(null);
    sig.addEventListener('abort', stop, { once: true });
  });
  return Promise.race([fnP, endP]).finally(() => stop && sig.removeEventListener('abort', stop));
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
  timeoutMs: number;

  constructor(apiKey: string, options: GeminiLiveProviderOptions) {
    const httpOptions = { apiVersion: options.apiVersion?.trim() || 'v1beta' };
    this.ai = new GoogleGenAI({ apiKey: normalizeGeminiApiKey(apiKey), httpOptions });
    this.model = requireModel(options.model, 'GeminiLiveProvider').trim();
    this.defaultVoice = options.voice ?? HD_VOICES.ZEPHYR;
    this.tools = options.tools ?? [];
    this.onToolCall = options.onToolCall ?? null;
    const t = options.timeoutMs;
    const validT = typeof t === 'number' && Number.isFinite(t) && t > 0;
    this.timeoutMs = validT ? Math.min(t, MAX_TIMEOUT_MS) : DEF_TIMEOUT_MS;
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

  private _liveConfig(voice: string, inputMode = false): LiveConnectConfig {
    const cfg: LiveConnectConfig = {
      responseModalities: [Modality.AUDIO],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
    };
    if (!inputMode) return cfg;
    const comp = { triggerTokens: '25600', slidingWindow: { targetTokens: '12800' } };
    cfg.contextWindowCompression = comp;
    if (this.tools.length > 0) cfg.tools = [{ functionDeclarations: this.tools }];
    return cfg;
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
    if (audioBuffer.length === 0) throw new Error('[GeminiLive] Buffer audio vide');
    const cfg = this._liveConfig(options.voice ?? this.defaultVoice, true);
    try {
      return await this._openAndRunTurn(cfg, (s) => {
        const media = { mimeType: 'audio/pcm;rate=16000', data: audioBuffer.toString('base64') };
        s.sendRealtimeInput({ media });
        s.sendRealtimeInput({ audioStreamEnd: true });
      });
    } catch (error: unknown) {
      console.error('[GeminiLive] Erreur processAudio:', error);
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
    if (typeof text !== 'string' || !text.trim()) throw new Error('[GeminiLive] Texte vide');
    const cfg = this._liveConfig(options.voice ?? this.defaultVoice);
    try {
      const res = await this._openAndRunTurn(cfg, (s) => s.sendClientContent({ turns: [text] }));
      if (res.audioBuffer) {
        res.filePath = join(tmpdir(), `gemini_tts_${randomUUID()}.wav`);
        await safeWriteFile(res.filePath, this._createWavBuffer(res.audioParts));
      }
      return res;
    } catch (error: unknown) {
      console.error('[GeminiLive] Erreur TTS:', error);
      throw error;
    }
  }

  private async _openAndRunTurn(config: LiveConnectConfig, sendTurn: (s: Session) => void) {
    const [queue, cancelledIds] = [[] as LiveServerMessage[], new Set<string>()];
    const [aborts, deadlineMs] = [new Map<string, AbortController>(), Date.now() + this.timeoutMs];
    const state: LiveTurnState = { error: null, closed: false, wakeup: null };
    let [session, closedByClient]: [Session | undefined, boolean] = [undefined, false];
    const wake = (abort = false) => {
      if (abort) aborts.forEach((a) => a.abort());
      const cb = state.wakeup;
      state.wakeup = null;
      cb?.();
    };
    try {
      const connectP = this.ai.live.connect({
        model: this.model,
        config,
        callbacks: {
          onopen: () => console.log('[GeminiLive] Session ouverte'),
          onmessage: (m: LiveServerMessage) => {
            for (const id of m.toolCallCancellation?.ids ?? []) {
              cancelledIds.add(id);
              aborts.get(id)?.abort();
            }
            queue.push(m);
            wake();
          },
          onerror: (e: ErrorEvent) => {
            const msg = e?.message || 'Live API socket error';
            console.error('[GeminiLive] Erreur:', msg);
            state.error ??= new Error(`[GeminiLive] ${msg}`);
            wake(true);
          },
          onclose: () => {
            console.log('[GeminiLive] Session fermée');
            if (!closedByClient) {
              state.closed = true;
              wake(true);
            }
          },
        },
      });
      session = await raceWithDeadline(connectP, deadlineMs, (s) => s.close());
      sendTurn(session);
      const ctx0 = { queue, cancelledIds, aborts, deadlineMs, state };
      return await this._waitForResponse({ ...ctx0, session });
    } finally {
      wake(true);
      if (session) {
        closedByClient = true;
        session.close();
      }
    }
  }
  private async _runToolCall(fn: LiveToolCallHandler, call: FunctionCall, c: LiveTurnContext) {
    const { name, id } = call;
    if (!name || !id) return null;
    const dead = () => c.cancelledIds.has(id) || Boolean(c.state.error) || c.state.closed;
    if (dead()) return null;
    if (c.deadlineMs - Date.now() <= 0) throw new LiveTimeoutError();
    const ac = new AbortController();
    c.aborts.set(id, ac);
    let response: ToolRes | null;
    try {
      const p = awaitToolOrTurnEnd((async () => fn(call, ac.signal))(), ac.signal);
      const q = p.finally(() => c.aborts.delete(id));
      response = await raceWithDeadline(q, c.deadlineMs);
    } catch (err: unknown) {
      if (err instanceof LiveTimeoutError) throw err;
      response = { error: err instanceof Error ? err.message : String(err) };
    }
    return response && !dead() ? { name, id, response } : null;
  }
  private async _respondToToolCall(toolCall: LiveServerToolCall, c: LiveTurnContext) {
    const handler = this.onToolCall;
    const calls = (toolCall.functionCalls ?? []).filter((f) => !f.id || !c.cancelledIds.has(f.id));
    if (!handler || calls.length === 0) return;
    console.log('[GeminiLive] Tool call:', calls);
    const results: FunctionResponse[] = [];
    for (const call of calls) {
      const res = await this._runToolCall(handler, call, c);
      if (res) results.push(res);
    }
    const out = results.filter((r) => !r.id || !c.cancelledIds.has(r.id));
    const active = !c.state.error && !c.state.closed;
    if (out.length > 0 && active) c.session.sendToolResponse({ functionResponses: out });
  }
  private async _consumeTurnMessage(m: LiveServerMessage, audio: string[], c: LiveTurnContext) {
    const parts = m.serverContent?.modelTurn?.parts;
    const chunk = parts ? collectTurnParts(parts, audio) : '';
    if (m.toolCall && this.onToolCall) await this._respondToToolCall(m.toolCall, c);
    return { chunk, done: Boolean(m.serverContent?.turnComplete) };
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
  private async _waitForResponse(context: LiveTurnContext): Promise<GeminiLiveResponse> {
    const audioParts: string[] = [];
    let transcription = '';
    const emotion: string | null = null;
    let done = false;
    let iterations = 0;

    while (!done && iterations < MAX_TURN_MESSAGES) {
      iterations++;
      if (context.state.error) throw context.state.error;
      const message = context.queue.shift();
      if (!message) {
        const st = context.state;
        if (st.closed) throw new Error('[GeminiLive] Session fermée avant la fin du tour');
        const setW = (fn: (() => void) | null) => Object.assign(st, { wakeup: fn });
        const p = new Promise<void>((r) => setW(r));
        await raceWithDeadline(p, context.deadlineMs).finally(() => setW(null));
        continue;
      }
      const step = await this._consumeTurnMessage(message, audioParts, context);
      transcription += step.chunk;
      done = step.done;
    }

    if (!done) throw new Error('[GeminiLive] Limite maximale de messages Live API dépassée');
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
  options: GeminiLiveAdapterOptions = {},
): GeminiLiveProvider {
  const apiKey = normalizeGeminiApiKey(credentials?.familles_ia?.gemini);
  const model = requireModel(options.model, 'GeminiLiveProvider').trim();
  return new GeminiLiveProvider(apiKey, { ...options, model });
}

export default GeminiLiveProvider;
