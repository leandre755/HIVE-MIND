// services/audio/geminiLiveProvider.ts
// Provider pour Gemini 2.5 Flash Native Audio (Live API)
// Support: Audio streaming, Function calling, Émotions préservées

import { WebSocket } from 'ws';
import { join } from 'path';
import { safeMkdir, safeWriteFile, safeUnlink } from '../../utils/safeFs.js';
import { convertOggToPcm } from './audioConverter.js';
import { envResolver } from '../envResolver.js';

/* ------------------------------------------------------------------ */
/*  Interfaces — Gemini Live API data structures                       */
/* ------------------------------------------------------------------ */

/** JSON Schema (subset used by Gemini tool parameters) */
interface JsonSchemaProperties {
  [key: string]: JsonSchemaNode;
}

interface JsonSchemaNode {
  type?: string;
  description?: string;
  properties?: JsonSchemaProperties;
  items?: JsonSchemaNode;
  required?: string[];
  enum?: string[];
  [key: string]: unknown;
}

/** Tool function as declared in OpenAI-compatible format */
interface ToolFunction {
  name: string;
  description: string;
  parameters?: JsonSchemaNode;
}

/** Tool wrapper sent during setup */
interface ToolDeclaration {
  name: string;
  description: string;
  parameters?: JsonSchemaNode;
}

/** Tool definition from the caller (OpenAI-compatible) */
interface ToolDefinition {
  function: ToolFunction;
}

/** Session config passed to connect() */
interface SessionConfig {
  voice?: string;
  systemPrompt?: string;
  tools?: ToolDefinition[];
}

/** Constructor config */
interface GeminiLiveConfig {
  apiKey?: string;
  model?: string;
  toolExecutor?: ToolExecutorFn | null;
}

type ToolExecutorFn = (
  name: string,
  args: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

/** Setup message sent to Gemini */
interface SetupMessage {
  setup: {
    model: string;
    generationConfig: {
      responseModalities: string[];
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: string;
          };
        };
      };
    };
    systemInstruction?: {
      parts: Array<{ text: string }>;
    };
    tools?: Array<{
      functionDeclarations: ToolDeclaration[];
    }>;
  };
}

/** Incoming server message (top-level) */
interface GeminiServerMessage {
  setupComplete?: Record<string, unknown>;
  serverContent?: ServerContent;
  toolCall?: ToolCall;
  toolCallCancellation?: Record<string, unknown>;
}

/** serverContent payload */
interface ServerContent {
  modelTurn?: {
    parts: ServerPart[];
  };
  turnComplete?: boolean;
  inputTranscription?: { text?: string };
  outputTranscription?: { text?: string };
}

/** Individual part inside modelTurn */
interface ServerPart {
  inlineData?: { mimeType?: string; data?: string };
  text?: string;
  functionCall?: FunctionCall;
}

/** Function call received from the model */
interface FunctionCall {
  id?: string;
  name: string;
  args?: Record<string, unknown>;
}

/** Tool call (batch format) */
interface ToolCall {
  functionCalls?: FunctionCall[];
}

/** Final response resolved by waitForResponse() */
interface GeminiLiveResponse {
  audioFile: string | null;
  transcribedText: string | null;
  toolCalls: FunctionCall[];
}

/** Options for processAudioWithTools() */
interface ProcessAudioOptions {
  audioBuffer: Buffer;
  systemPrompt?: string;
  tools?: ToolDefinition[];
  voice?: string;
}

/* ------------------------------------------------------------------ */
/*  Helper — extract a safe error message from unknown                  */
/* ------------------------------------------------------------------ */

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown error';
}

/* ------------------------------------------------------------------ */
/*  GeminiLiveProvider                                                  */
/* ------------------------------------------------------------------ */

export class GeminiLiveProvider {
  apiKey: string | null;
  model: string;
  ws: WebSocket | null;
  isConnected: boolean;
  pendingTools: Map<string, FunctionCall>;
  audioQueue: Buffer[];
  toolExecutor: ToolExecutorFn | null;
  responseResolver: ((response: GeminiLiveResponse) => void) | null;
  responseRejector: ((error: Error) => void) | null;
  transcribedText: string | null;
  private _resetActivityTimeout: (() => void) | null;

  constructor(config: GeminiLiveConfig = {}) {
    this.apiKey =
      config.apiKey ||
      envResolver.resolveProviderKey('gemini') ||
      process.env.GEMINI_API_KEY ||
      null;
    this.model = config.model || 'gemini-3.1-flash-live-preview';
    this.ws = null;
    this.isConnected = false;
    this.pendingTools = new Map();
    this.audioQueue = [];
    this.toolExecutor = config.toolExecutor || null;
    this.responseResolver = null;
    this.responseRejector = null;
    this.transcribedText = null;
    this._resetActivityTimeout = null;
  }

  /**
   * Connexion au Live API
   * Attend la confirmation setupComplete avant de résoudre la promesse
   */
  async connect(sessionConfig: SessionConfig = {}): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.apiKey) {
        reject(new Error('Gemini Live API key missing: expected GEMINI_KEY or GEMINI_KEY_N'));
        return;
      }

      const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${this.apiKey}`;

      console.log('[GeminiLive] 🔌 Connexion au Live API...');
      this.ws = new WebSocket(url);

      // Reset state for new session
      this.audioQueue = [];
      this.transcribedText = null;
      this.pendingTools.clear();

      let setupReceived = false;

      this.ws.on('open', () => {
        console.log('[GeminiLive] ✅ WebSocket connecté');
        this.isConnected = true;
        this._sendSetup(sessionConfig);
      });

      this.ws.on('message', (data: Buffer) => {
        try {
          const raw = data.toString();
          const message: GeminiServerMessage = JSON.parse(raw) as GeminiServerMessage;

          // Debug: log every server message key for diagnostics
          const keys = Object.keys(message);
          console.log('[GeminiLive] 📨 Server message keys:', keys.join(', '));

          // Intercept setupComplete to resolve connect()
          if (message.setupComplete && !setupReceived) {
            setupReceived = true;
            console.log('[GeminiLive] ✓ Setup confirmed — session prête');
            resolve();
            return;
          }

          // All other messages go through the normal handler
          this._handleMessage(message);
        } catch (error: unknown) {
          console.error('[GeminiLive] Erreur parsing message:', extractErrorMessage(error));
        }
      });

      this.ws.on('error', (error: Error) => {
        console.error('[GeminiLive] ❌ WebSocket error:', error.message);
        this.isConnected = false;
        reject(error);
      });

      this.ws.on('close', (code: number, reason: Buffer) => {
        const reasonStr = reason?.toString() || 'unknown';
        console.log(`[GeminiLive] 🔌 WebSocket fermé (code=${code}, reason=${reasonStr})`);
        this.isConnected = false;

        // Rejeter la promesse de réponse en cours si le WS se ferme inopinément
        if (this.responseRejector) {
          this.responseRejector(new Error(`WebSocket closed unexpectedly (code=${code})`));
          this.responseResolver = null;
          this.responseRejector = null;
        }

        // Rejeter connect si pas encore setup
        if (!setupReceived) {
          reject(new Error(`WebSocket closed before setup (code=${code})`));
        }
      });

      // Timeout de connexion + setup
      setTimeout(() => {
        if (!setupReceived) {
          reject(new Error('Setup timeout (15s)'));
          this.disconnect().catch(() => {
            /* intentionally empty — best-effort cleanup */
          });
        }
      }, 15000);
    });
  }

  /**
   * Sanitise un schéma de paramètres pour l'API Gemini Live.
   * Gemini ne supporte pas `additionalProperties` — le serveur crash (1011) si présent.
   */
  _sanitizeParameters(params: JsonSchemaNode | undefined): JsonSchemaNode | undefined {
    if (!params || typeof params !== 'object') return params;

    const cleaned: JsonSchemaNode = {};
    for (const [key, value] of Object.entries(params)) {
      if (key === 'additionalProperties') continue;
      if (key === 'properties' && typeof value === 'object' && value !== null) {
        const cleanedProps: JsonSchemaProperties = {};
        for (const [propName, propVal] of Object.entries(value as JsonSchemaProperties)) {
          Reflect.set(cleanedProps, propName, this._sanitizeParameters(propVal) as JsonSchemaNode);
        }
        Reflect.set(cleaned, key, cleanedProps);
      } else if (key === 'items' && typeof value === 'object') {
        Reflect.set(cleaned, key, this._sanitizeParameters(value as JsonSchemaNode));
      } else {
        Reflect.set(cleaned, key, value);
      }
    }
    return cleaned;
  }

  /**
   * Envoyer la configuration de session (camelCase requis par l'API Gemini)
   */
  _sendSetup(config: SessionConfig): void {
    // Gemini Live API crashes (1011) when setup payload exceeds ~10KB.
    const MAX_SETUP_PAYLOAD_BYTES = 8000;
    const MAX_DESC_LENGTH = 300;

    // Official API format: wrapper key is 'setup'
    const configMessage: SetupMessage = {
      setup: {
        model: `models/${this.model}`,
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: config.voice || 'Aoede',
              },
            },
          },
        },
      },
    };

    console.log(`[GeminiLive] 📋 Setup: model=${this.model}`);

    // System instruction — truncate for Live mode to save payload budget
    if (config.systemPrompt) {
      const MAX_PROMPT_LENGTH = 2000;
      const prompt =
        config.systemPrompt.length > MAX_PROMPT_LENGTH
          ? config.systemPrompt.substring(0, MAX_PROMPT_LENGTH) + '\n[...truncated for Live API]'
          : config.systemPrompt;
      configMessage.setup.systemInstruction = {
        parts: [{ text: prompt }],
      };
    }

    // Tools (function declarations) — sanitised for Live API compatibility
    let sanitisedDeclarations: ToolDeclaration[] = [];
    if (config.tools && config.tools.length > 0) {
      sanitisedDeclarations = config.tools.map((tool: ToolDefinition) => {
        const desc = tool.function.description || '';
        return {
          name: tool.function.name,
          description:
            desc.length > MAX_DESC_LENGTH ? desc.substring(0, MAX_DESC_LENGTH) + '…' : desc,
          parameters: this._sanitizeParameters(tool.function.parameters),
        };
      });

      configMessage.setup.tools = [
        {
          functionDeclarations: sanitisedDeclarations,
        },
      ];
    }

    // Payload size guard: progressively drop tools until under the limit
    let payload = JSON.stringify(configMessage);
    while (payload.length > MAX_SETUP_PAYLOAD_BYTES && sanitisedDeclarations.length > 0) {
      const dropped = sanitisedDeclarations.pop();
      console.warn(
        `[GeminiLive] ⚠️ Payload ${payload.length}B > ${MAX_SETUP_PAYLOAD_BYTES}B — dropping tool: ${dropped?.name}`,
      );
      configMessage.setup.tools =
        sanitisedDeclarations.length > 0
          ? [{ functionDeclarations: sanitisedDeclarations }]
          : undefined;
      payload = JSON.stringify(configMessage);
    }

    console.log(
      `[GeminiLive] ⚙️ Session configurée (tools: ${sanitisedDeclarations.length}, payload: ${payload.length} bytes)`,
    );
    this._send(configMessage);
  }

  /**
   * Envoyer de l'audio au modèle
   * Accepte un buffer OGG/Opus (WhatsApp) OU un buffer PCM brut.
   * La conversion OGG→PCM est gérée automatiquement.
   *
   * Utilise `realtimeInput.mediaChunks` (format requis par le Live API).
   * Puis signale `turnComplete` via `clientContent`.
   */
  async sendAudio(audioBuffer: Buffer): Promise<void> {
    if (!this.isConnected) {
      throw new Error('WebSocket not connected');
    }

    let pcmBuffer: Buffer;

    // Détecter le format : OGG commence par "OggS" (0x4F676753)
    const isOgg =
      audioBuffer.length >= 4 &&
      audioBuffer[0] === 0x4f &&
      audioBuffer[1] === 0x67 &&
      audioBuffer[2] === 0x67 &&
      audioBuffer[3] === 0x53;

    if (isOgg) {
      console.log('[GeminiLive] 🔄 Conversion OGG→PCM...');
      const tempDir = join(process.cwd(), 'temp', 'stt');
      await safeMkdir(tempDir, { recursive: true });
      const tempOgg = join(tempDir, `live_input_${Date.now()}.ogg`);
      await safeWriteFile(tempOgg, audioBuffer);

      try {
        pcmBuffer = (await convertOggToPcm(tempOgg)) as Buffer;
      } finally {
        await safeUnlink(tempOgg).catch(() => {});
      }
    } else {
      pcmBuffer = audioBuffer;
    }

    // Append 2 seconds of silence (64000 bytes) to force VAD (Voice Activity Detection) to trigger turn completion naturally
    const silence = Buffer.alloc(64000);
    pcmBuffer = Buffer.concat([pcmBuffer, silence]);

    // Send audio in chunks of 4096 bytes (256ms of 16kHz 16-bit PCM)
    const chunkSize = 4096;
    for (let i = 0; i < pcmBuffer.length; i += chunkSize) {
      const chunk = pcmBuffer.subarray(i, Math.min(i + chunkSize, pcmBuffer.length));
      this._send({
        realtimeInput: {
          audio: {
            data: chunk.toString('base64'),
            mimeType: 'audio/pcm;rate=16000',
          },
        },
      });
      // Petit délai artificiel
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }

    console.log(
      `[GeminiLive] 🎤 Audio envoyé en chunks avec silence VAD (${pcmBuffer.length} bytes PCM)`,
    );
  }

  /**
   * Attendre la réponse du modèle
   */
  async waitForResponse(timeoutMs = 120000): Promise<GeminiLiveResponse> {
    return new Promise((resolve, reject) => {
      let timeout: NodeJS.Timeout;

      const resetTimeout = (): void => {
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(() => {
          this.responseResolver = null;
          this.responseRejector = null;
          this._resetActivityTimeout = null;
          reject(new Error(`Response timeout (${timeoutMs}ms without activity)`));
        }, timeoutMs);
      };

      this._resetActivityTimeout = resetTimeout;
      resetTimeout();

      this.responseResolver = (response: GeminiLiveResponse): void => {
        clearTimeout(timeout);
        this.responseResolver = null;
        this.responseRejector = null;
        this._resetActivityTimeout = null;
        resolve(response);
      };

      this.responseRejector = (error: Error): void => {
        clearTimeout(timeout);
        this.responseResolver = null;
        this.responseRejector = null;
        this._resetActivityTimeout = null;
        reject(error);
      };
    });
  }

  /**
   * Gérer les messages du serveur (après setup)
   */
  _handleMessage(message: GeminiServerMessage): void {
    if (this._resetActivityTimeout) {
      this._resetActivityTimeout();
    }

    // Server content (réponse du modèle)
    if (message.serverContent) {
      this._handleServerContent(message.serverContent);
    }

    // Tool call
    if (message.toolCall) {
      console.log('[GeminiLive] 🛠️ Tool call detected');
      this._handleToolCall(message.toolCall);
    }

    // Tool call cancellation
    if (message.toolCallCancellation) {
      console.log('[GeminiLive] ⚠️ Tool call cancelled by server');
    }
  }

  /**
   * Gérer le contenu serveur (audio + text)
   */
  async _handleServerContent(content: ServerContent): Promise<void> {
    console.log('[GeminiLive] 🔍 Raw serverContent:', JSON.stringify(content, null, 2));
    const parts = content.modelTurn?.parts || [];

    for (const part of parts) {
      // Audio reçu (PCM 24kHz du serveur)
      if (part.inlineData && part.inlineData.mimeType?.startsWith('audio/')) {
        this.audioQueue.push(Buffer.from(part.inlineData.data || '', 'base64'));
      }

      // Texte (transcription de la réponse audio - fallback)
      if (part.text) {
        console.log('[GeminiLive] 📝 Texte:', part.text.substring(0, 80), '...');
        this.transcribedText = (this.transcribedText || '') + part.text;
      }

      // Function call inline
      if (part.functionCall) {
        await this._handleFunctionCall(part.functionCall);
      }
    }

    // Receiving Text Transcriptions (New API format)
    if (content.inputTranscription) {
      console.log('[GeminiLive] 👤 User Transcription:', content.inputTranscription.text);
    }
    if (content.outputTranscription) {
      console.log('[GeminiLive] 🤖 Gemini Transcription:', content.outputTranscription.text);
      this.transcribedText =
        (this.transcribedText || '') + (content.outputTranscription.text || '');
    }

    // Si turn complete, résoudre la promesse
    if (content.turnComplete) {
      console.log(
        `[GeminiLive] ✅ Turn complete (${this.audioQueue.length} audio chunks, text: ${this.transcribedText ? 'yes' : 'no'})`,
      );

      const audioFile = await this._combineAudioChunks();

      if (this.responseResolver) {
        this.responseResolver({
          audioFile,
          transcribedText: this.transcribedText,
          toolCalls: Array.from(this.pendingTools.values()),
        });
      }
    }
  }

  /**
   * Gérer un function call
   */
  async _handleFunctionCall(functionCall: FunctionCall): Promise<void> {
    console.log('[GeminiLive] 🛠️ Function call:', functionCall.name);

    if (!this.toolExecutor) {
      console.error('[GeminiLive] ❌ No tool executor defined');
      return;
    }

    try {
      const result = await this.toolExecutor(functionCall.name, functionCall.args || {});

      const response = {
        toolResponse: {
          functionResponses: [
            {
              id: functionCall.id || `tool_${Date.now()}`,
              name: functionCall.name,
              response: result,
            },
          ],
        },
      };

      this._send(response);
      console.log('[GeminiLive] ✓ Tool result sent');
    } catch (error: unknown) {
      const errorMessage = extractErrorMessage(error);
      console.error('[GeminiLive] ❌ Tool execution error:', errorMessage);

      // Envoyer une réponse d'erreur pour débloquer le modèle
      const errorResponse = {
        toolResponse: {
          functionResponses: [
            {
              id: functionCall.id || `tool_${Date.now()}`,
              name: functionCall.name,
              response: { error: errorMessage },
            },
          ],
        },
      };
      this._send(errorResponse);
    }
  }

  /**
   * Gérer un toolCall (format alternatif du serveur)
   */
  async _handleToolCall(toolCall: ToolCall): Promise<void> {
    const calls = toolCall.functionCalls || [];
    for (const fc of calls) {
      await this._handleFunctionCall(fc);
    }
  }

  /**
   * Combiner les chunks audio PCM en un fichier
   */
  async _combineAudioChunks(): Promise<string | null> {
    if (this.audioQueue.length === 0) {
      console.log('[GeminiLive] ⚠️ No audio received');
      return null;
    }

    const totalBuffer = Buffer.concat(this.audioQueue);
    this.audioQueue = [];

    const tempDir = join(process.cwd(), 'temp', 'stt');
    await safeMkdir(tempDir, { recursive: true });
    const tempPath = join(tempDir, `gemini_live_${Date.now()}.pcm`);
    await safeWriteFile(tempPath, totalBuffer);

    console.log(`[GeminiLive] 💾 Audio saved: ${tempPath} (${totalBuffer.length} bytes)`);
    return tempPath;
  }

  /**
   * Envoyer un message JSON au serveur
   */
  _send(message: Record<string, unknown> | SetupMessage): void {
    if (this.ws && this.isConnected) {
      this.ws.send(JSON.stringify(message));
    }
  }

  /**
   * Fermer la connexion proprement
   */
  async disconnect(): Promise<void> {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.isConnected = false;
      console.log('[GeminiLive] 👋 Disconnected');
    }
  }

  /**
   * Process audio avec tools (méthode principale — point d'entrée depuis le Core)
   */
  async processAudioWithTools(options: ProcessAudioOptions): Promise<GeminiLiveResponse> {
    const { audioBuffer, systemPrompt, tools, voice } = options;

    try {
      // 1. Connexion + setup (attend setupComplete)
      await this.connect({ systemPrompt, tools, voice });

      // 2. Envoyer l'audio (conversion OGG→PCM automatique)
      await this.sendAudio(audioBuffer);

      // 3. Attendre la réponse (timeout 30s, rejeté aussi si WS ferme)
      const response = await this.waitForResponse();

      // 4. Fermer proprement
      await this.disconnect();

      return response;
    } catch (error: unknown) {
      console.error('[GeminiLive] ❌ Process error:', extractErrorMessage(error));
      await this.disconnect();
      throw error;
    }
  }
}

export default GeminiLiveProvider;
