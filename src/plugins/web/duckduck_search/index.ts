// plugins/duckduck_search/index.ts

interface DuckDuckSearchArgs {
  query: string;
  num_results?: number;
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export default {
  name: 'duckduck_search',
  description: 'Performs web searches via DuckDuckGo (scraping) to obtain up-to-date information.',
  version: '2.0.0',
  enabled: true,

  toolDefinition: {
    type: 'function',
    function: {
      name: 'duckduck_search',
      description: 'Search the web via DuckDuckGo to verify facts, news, etc.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query',
          },
          num_results: {
            type: 'integer',
            description: 'Number of results (default: 3, max: 5)',
          },
        },
        required: ['query'],
      },
    },
  },

  async execute(args: unknown, _context: unknown, _toolName?: string) {
    const searchArgs = args as DuckDuckSearchArgs;
    const { query, num_results = 3 } = searchArgs;

    console.log(`[DuckDuckSearch] 🦆 DuckDuckGo Search: "${query}"`);

    return await this.searchDuckDuckGo(query, num_results);
  },

  /**
   * Search via DuckDuckGo HTML (scraping)
   */
  async searchDuckDuckGo(query: string, num_results: number) {
    try {
      const url = 'https://html.duckduckgo.com/html/';
      const body = new URLSearchParams({ q: query, b: '' }); // POST form data

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
          'Upgrade-Insecure-Requests': '1',
          Origin: 'https://html.duckduckgo.com',
          Referer: 'https://html.duckduckgo.com/',
        },
        body,
      });

      if (!response.ok) throw new Error(`DDG Status ${response.status}`);
      const html = await response.text();

      // Simple regex to extract Titles and Links from DDG HTML structure
      // <a class="result__a" href="...">Title</a>
      // <a class="result__snippet" ...>Snippet</a>

      const results: string[] = [];
      const resultRegex =
        /<div class="result__body">[\s\S]*?<a class="result__a" href="([^"]+)">([\s\S]*?)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;

      let match: RegExpExecArray | null;
      let count = 0;
      while ((match = resultRegex.exec(html)) !== null && count < num_results) {
        const [, link = '', rawTitle = '', rawSnippet = ''] = match;
        const title = rawTitle
          .split('<')
          .map((s) => s.slice(s.indexOf('>') + 1))
          .join('')
          .trim();
        const snippet = rawSnippet
          .split('<')
          .map((s) => s.slice(s.indexOf('>') + 1))
          .join('')
          .trim();

        results.push(`Title: ${title}\nLink: ${link}\nExcerpt: ${snippet}\n---`);
        count++;
      }

      if (results.length === 0) {
        return { success: false, message: 'No results found on DuckDuckGo.' };
      }

      return {
        success: true,
        message: `🦆 DuckDuckGo Results for "${query}":\n\n${results.join('\n')}`,
      };
    } catch (e: unknown) {
      const errorMessage = extractErrorMessage(e);
      console.error('[DuckDuckSearch] ❌ DuckDuckGo Error:', errorMessage);
      return {
        success: false,
        message: `Technical error during web search (${errorMessage}). Try to rephrase or ask me something else.`,
        gracefulDegradation: true,
      };
    }
  },
};
