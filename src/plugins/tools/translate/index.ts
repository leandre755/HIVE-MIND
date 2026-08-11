// Text translation plugin

interface TranslateArgs {
  text?: string;
  source_lang?: string;
  target_lang: string;
}

interface TranslateMessageContent {
  quotedMsg?: {
    text?: string;
  };
}

interface TranslateContext {
  message?: TranslateMessageContent;
  [key: string]: unknown;
}

interface TranslateResult {
  from?: {
    language?: {
      iso?: string;
    };
  };
  text: string;
}

export default {
  name: 'translate_text',
  description: 'Translates text from one language to another.',
  version: '1.0.0',
  enabled: true,

  toolDefinition: {
    type: 'function',
    function: {
      name: 'translate_text',
      description:
        'Translate text from one language to another. Can translate a quoted message or provided text.',
      parameters: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: 'The text to translate',
          },
          source_lang: {
            type: 'string',
            description: 'Source language (e.g. fr, en, auto). Default: auto',
          },
          target_lang: {
            type: 'string',
            description: 'Target language (e.g. en, es, ja)',
          },
        },
        required: ['text', 'target_lang'],
      },
    },
  },

  async execute(args: unknown, context: TranslateContext, _toolName?: string) {
    const { text, source_lang = 'auto', target_lang } = args as TranslateArgs;
    const { message } = context || {};

    if (!message) {
      return {
        success: false,
        message: 'CONTEXT_ERROR: message is required for translation context.',
      };
    }

    // Si aucun texte n'est fourni, essayer le message cité
    let textToTranslate = text;
    if (!textToTranslate && message.quotedMsg?.text) {
      textToTranslate = message.quotedMsg.text;
    }

    if (!textToTranslate) {
      return {
        success: false,
        message: 'No text to translate. Provide text or reply to a message.',
      };
    }

    try {
      // Dynamic import to avoid loading issues
      const { translate } = await import('@vitalets/google-translate-api');

      const result = await translate(textToTranslate, {
        from: source_lang,
        to: target_lang,
      });

      const langNamesMap = new Map<string, string>([
        ['fr', '🇫🇷 French'],
        ['en', '🇬🇧 English'],
        ['es', '🇪🇸 Spanish'],
        ['de', '🇩🇪 German'],
        ['it', '🇮🇹 Italian'],
        ['pt', '🇵🇹 Portuguese'],
        ['ja', '🇯🇵 Japanese'],
        ['ko', '🇰🇷 Korean'],
        ['zh', '🇨🇳 Chinese'],
        ['ar', '🇸🇦 Arabic'],
        ['ru', '🇷🇺 Russian'],
      ]);

      const translateResult = result as TranslateResult;
      const fromIso = translateResult.from?.language?.iso ?? '';
      const sourceName = langNamesMap.get(fromIso) || fromIso || 'Auto';
      const targetName = langNamesMap.get(target_lang) || target_lang;

      return {
        success: true,
        message: `${sourceName} → ${targetName}\n\n${result.text}`,
        data: {
          original: textToTranslate,
          translated: result.text,
          from: translateResult.from?.language?.iso,
          to: target_lang,
        },
      };
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error('[Translate Plugin] Error:', errMsg);
      return {
        success: false,
        message: `Translation error: ${errMsg}`,
      };
    }
  },
};
