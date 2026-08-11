interface CrawlfireContext {
  transport?: TransportLike;
  chatId?: string;
}

interface TransportLike {
  sendText: (chatId: string | undefined, text: string) => Promise<void>;
}

interface FirecrawlScrapeArgs {
  url: string;
}
interface FirecrawlCrawlArgs {
  url: string;
  limit?: number;
}
interface FirecrawlMapArgs {
  url: string;
}
interface FirecrawlSearchArgs {
  query: string;
  limit?: number;
}
interface FirecrawlExtractArgs {
  urls: string[];
  prompt: string;
}

type FirecrawlHeaders = Record<string, string>;

interface FirecrawlSuccessResponse {
  success: true;
  data?: unknown;
  markdown?: string;
  links?: Array<{ url: string; title?: string }>;
  error?: string;
  id?: string;
  status?: string;
}

interface FirecrawlErrorResponse {
  success: false;
  error?: string;
}

type FirecrawlApiResponse = FirecrawlSuccessResponse | FirecrawlErrorResponse;

interface CrawlPageData {
  metadata?: { title?: string; sourceURL?: string };
  markdown?: string;
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return String(error);
}

export default {
  name: 'crawlfire_web',
  description:
    'Advanced crawling and scraping plugin via Firecrawl (v2). Transforms websites into clean Markdown for LLMs.',
  version: '1.0.0',
  enabled: true,

  toolDefinitions: [
    {
      type: 'function',
      function: {
        name: 'firecrawl_scrape',
        description:
          'Scrapes a single URL to obtain its content in clean Markdown (max 25k chars). Ideal for reading an article, specific documentation, or the full content of a web page.',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'The exact URL to scrape' },
          },
          required: ['url'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'firecrawl_crawl',
        description:
          'Crawls an entire website from a base URL to bulk extract content from all linked sub-pages (concatenated up to 30k chars). Very useful for "ingesting" an entire help center or a small website.',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'Base URL of the site to crawl' },
            limit: {
              type: 'integer',
              description: 'Max number of sub-pages to crawl (default 10)',
            },
          },
          required: ['url'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'firecrawl_map',
        description:
          "Obtains the structural plan of a website as a list of existing URLs (limited to the first 100 links). Useful if you are looking for a specific page (e.g., contact, pricing) but don't know its exact URL.",
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'Base URL of the site to map' },
          },
          required: ['url'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'firecrawl_search',
        description:
          'Searches your query on the web (search engine style) and automatically scrapes top results as Markdown. Best tool for getting up to speed on recent news or a general topic.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Web search query (e.g., "AI news 2026")' },
            limit: { type: 'integer', description: 'Number of web results to scrape (default 3)' },
          },
          required: ['query'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'firecrawl_extract',
        description:
          'Scrapes one or more URLs and intelligently extracts only the precise data requested in the `prompt`, returned in a structured format (JSON).',
        parameters: {
          type: 'object',
          properties: {
            urls: {
              type: 'array',
              items: { type: 'string' },
              description: 'List of source URLs (supports wildcards like /*)',
            },
            prompt: {
              type: 'string',
              description:
                'Clear and explicit description of exact data to extract (e.g., "Extract price, area, and city")',
            },
          },
          required: ['urls', 'prompt'],
        },
      },
    },
  ],

  async execute(args: unknown, context: CrawlfireContext, toolName?: string) {
    const { transport, chatId } = context || {};

    if (!transport || !chatId) {
      return { success: false, message: 'Transport or chatId missing from context' };
    }

    const { container } = await import('../../../core/ServiceContainer.js');

    let apiKey = process.env.FIRECRAWL_API_KEY;
    try {
      if (container.has('config')) {
        const configService = container.get('config') as {
          get?: (key: string) => Record<string, unknown> | undefined;
          plugins?: Record<string, Record<string, string>>;
        };
        const pluginConfig =
          typeof configService.get === 'function'
            ? (configService.get('plugins') as Record<string, Record<string, string>> | undefined)
                ?.crawlfire_web
            : configService.plugins?.crawlfire_web;
        if (pluginConfig?.apiKey) apiKey = pluginConfig.apiKey;
      }
    } catch {
      // Silencieux
    }

    if (
      !apiKey ||
      apiKey.startsWith('YOUR_') ||
      apiKey === 'fc-YOUR-API-KEY' ||
      apiKey === 'fc-YOUR-API-KEY-HERE'
    ) {
      return {
        success: false,
        message:
          '⚠️ Firecrawl API key not configured. Please set FIRECRAWL_API_KEY in your environment variables.',
      };
    }

    const baseUrl = 'https://api.firecrawl.dev/v2';
    const headers: FirecrawlHeaders = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    };

    const ensureAbsoluteUrl = (u: unknown) => {
      if (typeof u === 'string' && u && !/^https?:\/\//i.test(u)) {
        throw new Error(
          `The URL "${u}" is invalid. You MUST provide an absolute URL starting with http:// or https:// (e.g. https://example.com${u.startsWith('/') ? u : '/' + u}).`,
        );
      }
    };

    try {
      switch (toolName) {
        case 'firecrawl_scrape': {
          const scrapeArgs = args as FirecrawlScrapeArgs;
          ensureAbsoluteUrl(scrapeArgs.url);
          return await this.handleScrape(scrapeArgs.url, headers, baseUrl);
        }
        case 'firecrawl_crawl': {
          const crawlArgs = args as FirecrawlCrawlArgs;
          ensureAbsoluteUrl(crawlArgs.url);
          return await this.handleCrawl(
            crawlArgs.url,
            crawlArgs.limit || 10,
            headers,
            baseUrl,
            transport,
            chatId,
          );
        }
        case 'firecrawl_map': {
          const mapArgs = args as FirecrawlMapArgs;
          ensureAbsoluteUrl(mapArgs.url);
          return await this.handleMap(mapArgs.url, headers, baseUrl);
        }
        case 'firecrawl_search': {
          const searchArgs = args as FirecrawlSearchArgs;
          return await this.handleSearch(searchArgs.query, searchArgs.limit || 3, headers, baseUrl);
        }
        case 'firecrawl_extract': {
          const extractArgs = args as FirecrawlExtractArgs;
          if (extractArgs.urls) extractArgs.urls.forEach(ensureAbsoluteUrl);
          return await this.handleExtract(
            extractArgs.urls,
            extractArgs.prompt,
            headers,
            baseUrl,
            transport,
            chatId,
          );
        }
        default:
          return { success: false, message: `Unknown Firecrawl tool: ${toolName}` };
      }
    } catch (error: unknown) {
      console.error('[CrawlFire] Error in %s:', toolName, extractErrorMessage(error));
      return { success: false, message: `❌ Firecrawl error: ${extractErrorMessage(error)}` };
    }
  },

  async apiFetch(url: string, options: RequestInit): Promise<FirecrawlApiResponse> {
    const res = await fetch(url, options);
    const contentType = res.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      throw new Error(
        `API error: non-JSON response (Status ${res.status}). Service potentially unavailable.`,
      );
    }
    return (await res.json()) as FirecrawlApiResponse;
  },

  async handleScrape(url: string, headers: FirecrawlHeaders, baseUrl: string) {
    console.log(`[CrawlFire] 📄 Scraping: ${url}`);
    const json = await this.apiFetch(`${baseUrl}/scrape`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ url, formats: ['markdown'] }),
    });
    if (!json.success) throw new Error(json.error || 'Scraping failed');

    const markdown = json.markdown || '';
    const truncated =
      markdown.length > 25000
        ? markdown.substring(0, 25000) + '\n\n[...Content truncated due to length...]'
        : markdown;

    return {
      success: true,
      llmOutput: truncated,
      userOutput: `🌐 *Web page reading finished*\n📍 ${url}\n_Analyzing content..._ 🧠`,
    };
  },

  async handleCrawl(
    url: string,
    limit: number,
    headers: FirecrawlHeaders,
    baseUrl: string,
    transport: TransportLike,
    chatId?: string,
  ) {
    console.log(`[CrawlFire] 🕸️ Crawling: ${url} (limit: ${limit})`);
    if (transport) await transport.sendText(chatId, `🕸️ Starting crawl on ${url}...`);

    const startJson = await this.apiFetch(`${baseUrl}/crawl`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ url, limit }),
    });
    if (!startJson.success) throw new Error(startJson.error || 'Crawl start failed');

    const jobId = startJson.id;
    return await this.pollJob(jobId, 'crawl', headers, baseUrl, transport, chatId);
  },

  async handleMap(url: string, headers: FirecrawlHeaders, baseUrl: string) {
    console.log(`[CrawlFire] 🗺️ Mapping: ${url}`);
    const json = await this.apiFetch(`${baseUrl}/map`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ url }),
    });
    if (!json.success) throw new Error(json.error || 'Mapping failed');

    const maxLinks = 100;
    const total = json.links?.length || 0;
    const linksDisp = total > maxLinks ? (json.links || []).slice(0, maxLinks) : json.links || [];

    const linksTxt = linksDisp.map((l) => `- ${l.url} (${l.title || 'untitled'})`).join('\n');
    let msg = `🗺️ Sitemap for ${url} (${total} links found):\n\n${linksTxt}`;
    if (total > maxLinks) {
      msg += `\n\n[... ${total - maxLinks} more links not shown due to length ...]`;
    }
    return { success: true, message: msg };
  },

  async handleSearch(query: string, limit: number, headers: FirecrawlHeaders, baseUrl: string) {
    console.log(`[CrawlFire] 🔍 Searching: ${query}`);
    const json = await this.apiFetch(`${baseUrl}/search`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query, limit, scrapeOptions: { formats: ['markdown'] } }),
    });
    if (!json.success) throw new Error(json.error || 'Search failed');

    if (!Array.isArray(json.data)) {
      return {
        success: true,
        message: `🔍 Search result for "${query}": No results found or invalid response format.`,
      };
    }

    const results = json.data
      .map((d: Record<string, unknown>) => {
        let md = (d.markdown as string) || 'No markdown content';
        if (md.length > 5000) md = md.substring(0, 5000) + '...';
        return `### ${d.title}\nURL: ${d.url}\n\n${md}\n---`;
      })
      .join('\n\n');
    return { success: true, message: `🔍 Firecrawl results for "${query}":\n\n${results}` };
  },

  async handleExtract(
    urls: string[],
    prompt: string,
    headers: FirecrawlHeaders,
    baseUrl: string,
    transport: TransportLike,
    chatId?: string,
  ) {
    console.log(`[CrawlFire] 🧪 Extracting from ${urls?.length} URLs`);
    if (transport) await transport.sendText(chatId, '🧪 Extracting structured data...');

    const json = await this.apiFetch(`${baseUrl}/extract`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ urls, prompt }),
    });
    if (!json.success) throw new Error(json.error || 'Extraction failed');

    if (json.data && json.status === 'completed') {
      return {
        success: true,
        message: `🧪 Extracted data:\n\n\`\`\`json\n${JSON.stringify(json.data, null, 2)}\n\`\`\``,
      };
    }

    return await this.pollJob(json.id, 'extract', headers, baseUrl, transport, chatId);
  },

  formatCrawlResponse(data: CrawlPageData[] | undefined, jobId: string) {
    const count = data?.length || 0;
    const combinedMarkdown =
      data
        ?.map(
          (d: CrawlPageData) =>
            `#### ${d.metadata?.title || d.metadata?.sourceURL}\n${d.markdown || ''}`,
        )
        .join('\n\n---\n\n') || '';
    const finalMarkdown =
      combinedMarkdown.length > 30000
        ? combinedMarkdown.substring(0, 30000) + '\n\n[...Content truncated due to length...]'
        : combinedMarkdown;
    return {
      success: true,
      message: `✅ Crawl finished (${count} pages found).\n\n${finalMarkdown}\n\n[Job ID: ${jobId}]`,
    };
  },

  async pollJob(
    jobId: string | undefined,
    type: string,
    headers: FirecrawlHeaders,
    baseUrl: string,
    transport: TransportLike,
    chatId?: string,
  ) {
    let attempts = 0;
    const maxAttempts = 30;

    while (attempts < maxAttempts) {
      attempts++;
      await new Promise((r) => setTimeout(r, 10000));

      console.log(`[CrawlFire] ⏳ Polling ${type} job ${jobId} (attempt ${attempts})`);
      const json = await this.apiFetch(`${baseUrl}/${type}/${jobId}`, { headers });

      if (!json.success) {
        throw new Error(`${type} job failed: ${json.error || 'Unknown error'}`);
      }

      if (json.status === 'completed') {
        if (type === 'crawl') {
          return this.formatCrawlResponse(json.data as CrawlPageData[] | undefined, jobId || '');
        }
        return {
          success: true,
          message: `✅ Extraction finished:\n\n\`\`\`json\n${JSON.stringify(json.data, null, 2)}\n\`\`\``,
        };
      }

      if (json.status === 'failed') {
        throw new Error(`${type} job failed: ${json.error || 'Unknown error'}`);
      }

      if (attempts % 6 === 0 && transport) {
        await transport.sendText(chatId, `⏳ Still in progress (${type})...`);
      }
    }

    return { success: false, message: `⌛ Operation ${type} is taking too long. Job ID: ${jobId}` };
  },
};
