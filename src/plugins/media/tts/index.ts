// plugins/tts/index.js
// Text-to-Speech Plugin - Uses unified VoiceProvider

interface TtsMatch extends Array<string> {
  index: number;
  input: string;
}

interface TtsTextMatcher {
  pattern: RegExp;
  handler: string;
  description: string;
  extractArgs: (match: TtsMatch) => { text: string; provider: string };
}

interface TtsToolParameterProperty {
  type: string;
  description?: string;
  enum?: string[];
}

interface TtsToolParameters {
  type: string;
  properties: Record<string, TtsToolParameterProperty>;
  required: string[];
}

interface TtsToolFunction {
  name: string;
  description: string;
  parameters: TtsToolParameters;
}

interface TtsToolDefinition {
  type: string;
  function: TtsToolFunction;
}

interface TransportLike {
  sendMedia: (
    chatId: string,
    media: Buffer | string,
    options?: Record<string, unknown>,
  ) => Promise<void>;
  sendVoiceNote: (
    chatId: string,
    audio: Buffer | string,
    options?: Record<string, unknown>,
  ) => Promise<void>;
  setPresence: (chatId: string, presence: string) => Promise<void>;
}

interface MessageLike {
  quotedMsg?: {
    text?: string;
  };
}

interface ContainerLike {
  get: (name: string) => VoiceProviderLike | undefined;
}

interface VoiceProviderLike {
  textToSpeechGttsOnly: (
    text: string,
    options: Record<string, unknown>,
  ) => Promise<SynthesizeResultLike | null>;
  textToSpeechGeminiFirst: (
    text: string,
    options: Record<string, unknown>,
  ) => Promise<SynthesizeResultLike | null>;
}

interface SynthesizeResultLike {
  audioBuffer: Buffer;
  format?: string;
  filePath?: string;
  provider?: string;
}

interface TtsContext {
  transport?: TransportLike;
  chatId?: string;
  message?: MessageLike;
  container?: ContainerLike;
}

interface TtsArgs {
  text?: string;
  voice?: string;
  style_notes?: string;
  tone?: string;
  accent?: string;
  pace?: string;
  language?: string;
  speaker_1?: string;
  speaker_2?: string;
  provider?: 'auto' | 'gemini' | 'gtts';
  send_as?: 'voice_note' | 'audio';
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return String(error);
}

export default {
  name: 'text_to_speech',
  description: 'Gemini-first text-to-speech with GTTS fallback.',
  version: '2.0.0',
  enabled: true,

  textMatchers: [
    {
      pattern: /^\.tts\s+(\S.*)$/s,
      handler: 'text_to_speech',
      description: 'Convert text to speech via Gemini TTS first, then GTTS fallback',
      extractArgs: (match: TtsMatch) => ({ text: match[1].trim(), provider: 'auto' }),
    },
    {
      pattern: /^\.gtts\s+(\S.*)$/s,
      handler: 'text_to_speech',
      description: 'Convert text to speech with GTTS only',
      extractArgs: (match: TtsMatch) => ({ text: match[1].trim(), provider: 'gtts' }),
    },
  ] as TtsTextMatcher[],

  toolDefinition: {
    type: 'function',
    function: {
      name: 'text_to_speech',
      description:
        'Convert text directly to audio. Prefer Gemini 3.1 Flash TTS for expressive speech, voices, Director Chair notes, accents, pace, language/dialect, and inline audio tags. If Gemini quota/API fails, fallback is GTTS and Gemini-only controls are ignored instead of being passed to GTTS.',
      parameters: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description:
              'Text to vocalize. Gemini supports inline tags inside the text: [happy], [excited], [sad], [angry], [whispers], [laughs], [sigh], [slow], [fast], [short pause], [long pause], etc. Do not put two tags back-to-back without text or punctuation between them.',
          },
          voice: {
            type: 'string',
            enum: [
              'Aoede',
              'Zephyr',
              'Callirrhoe',
              'Autonoe',
              'Despina',
              'Erinome',
              'Leda',
              'Kore',
              'Vindemiatrix',
              'Charon',
              'Puck',
              'Fenrir',
              'Orus',
              'Enceladus',
              'Iapetus',
              'Umbriel',
              'Zubenelgenubi',
              'Achernar',
              'Algieba',
              'Algenib',
              'Rasalgethi',
              'Laomedeia',
              'Alnilam',
              'Schedar',
              'Gacrux',
              'Pulcherrima',
              'Achird',
              'Sadachbia',
              'Sadaltager',
              'Sulafar',
            ],
            description: 'Gemini prebuilt voice name. Ignored by GTTS fallback.',
          },
          style_notes: {
            type: 'string',
            description:
              'Gemini Director Chair high-level instruction, e.g. "deliver warmly and slowly", "professional narrator", "casual conversational". Ignored by GTTS fallback.',
          },
          tone: {
            type: 'string',
            description:
              'Gemini tone or emotion direction, e.g. warm, sarcastic, calm, dramatic, professional. Ignored by GTTS fallback.',
          },
          accent: {
            type: 'string',
            description:
              'Gemini accent direction, e.g. British accent, French accent, Southern US accent. Ignored by GTTS fallback.',
          },
          pace: {
            type: 'string',
            description:
              'Gemini pace direction, e.g. slow, fast, measured, energetic. Ignored by GTTS fallback.',
          },
          language: {
            type: 'string',
            description:
              'Language or dialect hint for Gemini; also used as GTTS language fallback when provider is GTTS (prefer ISO code like fr, en, ja for GTTS).',
          },
          speaker_1: {
            type: 'string',
            description:
              'Gemini multi-speaker guidance for speaker 1 when the text identifies speakers. Ignored by GTTS fallback.',
          },
          speaker_2: {
            type: 'string',
            description:
              'Gemini multi-speaker guidance for speaker 2 when the text identifies speakers. Ignored by GTTS fallback.',
          },
          provider: {
            type: 'string',
            enum: ['auto', 'gemini', 'gtts'],
            description:
              'auto/gemini: use Gemini first with GTTS fallback. gtts: force simple GTTS only.',
          },
          send_as: {
            type: 'string',
            enum: ['voice_note', 'audio'],
            description:
              'Send directly as "voice_note" (WhatsApp PTT) or "audio" (standard media audio). The plugin sends the file itself; no extra send_file tool is needed.',
          },
        },
        required: ['text'],
      },
    },
  } as TtsToolDefinition,

  async _generateAudioBuffer(vp: VoiceProviderLike, text: string, args: TtsArgs) {
    const {
      voice = 'Aoede',
      style_notes,
      tone,
      accent,
      pace,
      language = 'fr',
      speaker_1,
      speaker_2,
      provider = 'auto',
    } = args;

    if (provider === 'gtts') {
      return await vp.textToSpeechGttsOnly(text, { language });
    }

    return await vp.textToSpeechGeminiFirst(text, {
      model: 'gemini-3.1-flash-tts-preview',
      voice,
      style: style_notes,
      tone,
      accent,
      pace,
      language,
      speaker_1,
      speaker_2,
      fallback_language: language,
    });
  },

  async _sendAudioResult(
    transport: TransportLike,
    chatId: string,
    sendAs: string,
    result: SynthesizeResultLike,
    textLength: number,
  ) {
    if (sendAs === 'audio') {
      await transport.sendMedia(chatId, result.filePath || result.audioBuffer, {
        type: 'audio',
        mimetype: result.format === 'ogg' ? 'audio/ogg; codecs=opus' : undefined,
        caption:
          result.provider === 'gemini'
            ? 'HIVE-MIND Audio (Gemini 3.1 TTS)'
            : 'HIVE-MIND Audio (GTTS fallback)',
      });
    } else {
      await transport.setPresence(chatId, 'recording');

      const options = {
        duration: Math.min(textLength * 60, 30000),
        mimetype: result.format === 'ogg' ? 'audio/ogg; codecs=opus' : undefined,
      };
      await transport.sendVoiceNote(chatId, result.filePath || result.audioBuffer, options);

      await transport.setPresence(chatId, 'available');
    }
  },

  async execute(args: unknown, context: TtsContext, _toolName?: string) {
    const { transport, chatId, message, container } = context || {};
    const ttsArgs = (args ?? {}) as TtsArgs;
    const { send_as = 'voice_note' } = ttsArgs;

    if (!transport || !chatId) {
      return { success: false, message: 'Transport or chatId missing from context' };
    }

    let text = ttsArgs.text;
    if (!text && message?.quotedMsg?.text) {
      text = message.quotedMsg.text;
    }

    if (!text) {
      return { success: false, message: 'Please provide text to convert to audio.' };
    }
    text = String(text).trim();
    if (!text) {
      return { success: false, message: 'Please provide text to convert to audio.' };
    }

    try {
      const voiceProvider = container?.get('voiceProvider');
      if (!voiceProvider) throw new Error('VoiceProvider service not found.');

      const vp = voiceProvider as VoiceProviderLike;
      const result = await this._generateAudioBuffer(vp, text, ttsArgs);

      if (!result || !result.audioBuffer) {
        return {
          success: false,
          message: 'Could not generate audio. Please check if the Gemini TTS service is available.',
        };
      }

      await this._sendAudioResult(
        transport as TransportLike,
        chatId,
        send_as,
        result as SynthesizeResultLike,
        text.length,
      );

      return {
        success: true,
        message: `Audio generated via ${result.provider} (${send_as}).`,
      };
    } catch (error: unknown) {
      console.error('[TTS Plugin] Execution error:', error);
      return {
        success: false,
        message: `Failed to generate audio: ${extractErrorMessage(error)}`,
      };
    }
  },
};
