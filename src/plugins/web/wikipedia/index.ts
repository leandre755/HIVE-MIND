// Wikipedia search plugin

interface WikipediaContext {
  transport?: {
    downloadMedia?: (msg: unknown) => Promise<Buffer>;
    sendMessage?: (chatId: string, content: unknown) => Promise<void>;
  };
  chatId?: string;
  [key: string]: unknown;
}

interface WikipediaArgs {
  query: string;
  lang?: string;
}

interface TextMatch {
  1: string;
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export default {
  name: 'search_wikipedia',
  description: 'Searches for information on Wikipedia.',
  version: '1.0.0',
  enabled: true,

  // TEXT MATCHER: [wiki:query] pattern for textual fallback
  textMatchers: [
    {
      pattern: /\[wiki:([^\]]+)\]/i,
      handler: 'search_wikipedia',
      description: 'Wikipedia search via [wiki:subject]',
      extractArgs: (match: TextMatch) => ({ query: match[1].trim() }),
    },
  ],

  toolDefinition: {
    type: 'function',
    function: {
      name: 'search_wikipedia',
      description:
        'Search for information on Wikipedia. Use this function when the user asks for encyclopedic info.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The subject to search for',
          },
          lang: {
            type: 'string',
            description: 'Language code (en, fr, etc.). Default: en',
          },
        },
        required: ['query'],
      },
    },
  },

  async execute(args: unknown, _context: WikipediaContext, _toolName?: string) {
    const searchArgs = args as WikipediaArgs;
    const { query, lang = 'en' } = searchArgs;

    if (!query) {
      return {
        success: false,
        message: 'Tell me what you want to search for!',
      };
    }

    try {
      const apiUrl = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`;

      const response = await fetch(apiUrl, {
        headers: {
          'User-Agent':
            'HiveMindBot/1.0 (https://github.com/railway/hive-mind; contact@example.com)',
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          return {
            success: false,
            message: `No results found for "${query}" on Wikipedia.`,
          };
        }
        throw new Error(`Wikipedia API error: ${response.statusText}`);
      }

      const summary = await response.json();

      // Limit text to 500 characters
      const shortExtract =
        summary.extract.length > 500 ? summary.extract.substring(0, 500) + '...' : summary.extract;

      return {
        success: true,
        message: `📚 *${summary.title}*\n\n${shortExtract}\n\n🔗 ${summary.content_urls?.desktop?.page || ''}`,
        data: {
          title: summary.title,
          extract: summary.extract,
          url: summary.content_urls?.desktop?.page,
        },
      };
    } catch (error: unknown) {
      console.error('[Wikipedia Plugin] Error:', error);
      const errorMessage = extractErrorMessage(error);

      // Handle specific errors
      if (errorMessage.includes('page does not exist')) {
        return {
          success: false,
          message: `The article "${query}" does not exist on Wikipedia.`,
        };
      }

      return {
        success: false,
        message: `Search error: ${errorMessage}`,
      };
    }
  },
};
