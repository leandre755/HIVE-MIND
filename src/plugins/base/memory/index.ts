// plugins/memory/index.js
// Persistent fact memorization plugin (Option C)
// Allows the AI to memorize, recall, and list information about users

const extractErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  return String(error);
};

// Helper de services chargés dynamiquement
const getServices = async () => {
  const [{ factsMemory, workspaceMemory, semanticMemory }, { workingMemory }] = await Promise.all([
    import('../../../services/memory.js'),
    import('../../../services/workingMemory.js'),
  ]);
  return { factsMemory, workspaceMemory, semanticMemory, workingMemory };
};

interface MemoryContext {
  chatId?: string;
  sender?: string;
  [key: string]: unknown;
}

interface RememberFactArgs {
  key: string;
  value: string;
}
interface RecallFactArgs {
  key: string;
}
interface ForgetFactArgs {
  key: string;
}
interface WorkspaceWriteArgs {
  key: string;
  content: string;
  tags?: string[];
}
interface WorkspaceReadArgs {
  key: string;
}
interface WorkspaceSearchArgs {
  query: string;
  tags?: string[];
}
interface WorkspaceDeleteArgs {
  key: string;
}
interface UpdateScratchpadArgs {
  text: string;
}
interface SearchLongTermMemoryArgs {
  query: string;
}
interface WorkspaceSearchResult {
  key: string;
  similarity: number;
  content: string;
}
interface SemanticMemoryResult {
  formattedContent?: string;
  content: string;
  role?: string;
}

export default {
  name: 'memory',
  description: 'Persistent memory management - memorize, recall, and list facts about users',
  version: '1.0.0',
  enabled: true,

  // Multiple definitions for function calling
  toolDefinitions: [
    {
      type: 'function',
      function: {
        name: 'remember_fact',
        description:
          'Memorizes an important fact about the user for future recall. Use this when the user asks you to remember something or shares significant personal info.',
        parameters: {
          type: 'object',
          properties: {
            key: {
              type: 'string',
              description:
                'Fact category (e.g., "name", "city", "job", "birthday", "music_preference")',
            },
            value: {
              type: 'string',
              description: 'The value to memorize (e.g., "John", "Paris", "Developer", "March 15")',
            },
          },
          required: ['key', 'value'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'recall_fact',
        description:
          'Recalls a specific memorized fact about the user. Use this when the user asks if you remember something.',
        parameters: {
          type: 'object',
          properties: {
            key: {
              type: 'string',
              description: 'Fact category to recall (e.g., "name", "city", "job")',
            },
          },
          required: ['key'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'list_facts',
        description:
          'Lists all known facts about the user. Use this when the user asks what you know about them.',
        parameters: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'forget_fact',
        description:
          'Forgets a specific fact about the user. Use this when the user asks to forget or remove an information.',
        parameters: {
          type: 'object',
          properties: {
            key: {
              type: 'string',
              description: 'Fact category to forget',
            },
          },
          required: ['key'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'db_document_save',
        description:
          'Saves a document to your INTERNAL DATABASE (Supabase Epistemic Memory). ⚠️ WARNING: This does NOT create any file on disk. This is NOT equivalent to mkdir, writeFile, or echo. For creating physical files (.md, .txt, .html, etc.) on disk, use execute_bash_command (echo/cat/tee) or code_execution. This tool stores structured knowledge in a key-value database for long-term recall only.',
        parameters: {
          type: 'object',
          properties: {
            key: {
              type: 'string',
              description:
                'Unique identifier for the document (e.g., "migration_plan", "user_profile")',
            },
            content: {
              type: 'string',
              description: 'Complete content of the document (text or JSON)',
            },
            tags: {
              type: 'array',
              items: { type: 'string' },
              description: 'Optional tags for filtering (e.g., ["plan", "urgent"])',
            },
          },
          required: ['key', 'content'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'db_document_read',
        description:
          'Reads the complete content of a specific document from your internal database (Epistemic Memory). This reads from the Supabase database, NOT from the filesystem.',
        parameters: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'Unique identifier of the document to read' },
          },
          required: ['key'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'db_document_search',
        description:
          'Semantically searches through all your database documents (Epistemic Memory) to find similar concepts. This searches the Supabase database, NOT the filesystem.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'The question or concept to search for' },
            tags: {
              type: 'array',
              items: { type: 'string' },
              description: 'Filter by specific tags (optional)',
            },
          },
          required: ['query'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'db_document_delete',
        description: 'Deletes an obsolete document from your internal database (Epistemic Memory).',
        parameters: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'Unique identifier of the document to delete' },
          },
          required: ['key'],
        },
      },
    },
    // === V3 DYNAMIC CONTEXT TOOLS ===
    {
      type: 'function',
      function: {
        name: 'update_scratchpad',
        description:
          'Overwrites your L1 working memory (GCC Scratchpad visible in your prompt at every turn). Use for short-term state tracking between turns: ongoing task status, waiting conditions, key decisions. For long-term documents, use db_document_save instead. Max 500 chars.',
        parameters: {
          type: 'object',
          properties: {
            text: {
              type: 'string',
              description: 'New scratchpad content. This REPLACES the current content entirely.',
            },
          },
          required: ['text'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'search_long_term_memory',
        description:
          'Searches the RAG vector database for past conversations, stored knowledge, and deep context. Use this when the user refers to past events NOT present in your L1 dynamic context (Passport, Scratchpad, Action History). This is a Pull-based retrieval — only call when needed.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Semantic search query describing what you are looking for',
            },
          },
          required: ['query'],
        },
      },
    },
  ],

  /**
   * Executes memory tool
   * @param {unknown} args - Tool arguments
   * @param {MemoryContext} context - Context (transport, message, chatId, sender)
   * @param {string} toolName - Called tool name
   */
  async execute(args: unknown, context: MemoryContext, toolName?: string) {
    // Defensive destructuring of context
    const { chatId, sender } = context || {};

    if (!chatId) {
      return {
        success: false,
        message: 'CONTEXT_ERROR: chatId is required for memory operations.',
      };
    }

    // Use sender or chatId for personal facts
    const factsChatId = sender || chatId;

    switch (toolName) {
      case 'remember_fact': {
        const rememberArgs = args as RememberFactArgs;
        return await this._rememberFact(
          factsChatId as string,
          rememberArgs.key,
          rememberArgs.value,
        );
      }
      case 'recall_fact': {
        const recallArgs = args as RecallFactArgs;
        return await this._recallFact(factsChatId as string, recallArgs.key);
      }
      case 'list_facts':
        return await this._listFacts(factsChatId as string);
      case 'forget_fact': {
        const forgetArgs = args as ForgetFactArgs;
        return await this._forgetFact(factsChatId as string, forgetArgs.key);
      }
      case 'db_document_save': {
        const writeArgs = args as WorkspaceWriteArgs;
        return await this._workspaceWrite(
          factsChatId as string,
          writeArgs.key,
          writeArgs.content,
          writeArgs.tags,
        );
      }
      case 'db_document_read': {
        const readArgs = args as WorkspaceReadArgs;
        return await this._workspaceRead(factsChatId as string, readArgs.key);
      }
      case 'db_document_search': {
        const searchArgs = args as WorkspaceSearchArgs;
        return await this._workspaceSearch(
          factsChatId as string,
          searchArgs.query,
          searchArgs.tags,
        );
      }
      case 'db_document_delete': {
        const deleteArgs = args as WorkspaceDeleteArgs;
        return await this._workspaceDelete(factsChatId as string, deleteArgs.key);
      }
      case 'update_scratchpad': {
        const updateArgs = args as UpdateScratchpadArgs;
        return await this._updateScratchpad(chatId as string, updateArgs.text);
      }
      case 'search_long_term_memory': {
        const ltmArgs = args as SearchLongTermMemoryArgs;
        return await this._searchLongTermMemory(chatId as string, ltmArgs.query);
      }

      default:
        return { success: false, message: `Unknown tool: ${toolName}` };
    }
  },

  /**
   * Memorizes a fact
   */
  async _rememberFact(chatId: string, key: string, value: string) {
    try {
      const { factsMemory } = await getServices();
      // Normalize the key (lowercase, underscores)
      const normalizedKey = key.toLowerCase().replace(/\s+/g, '_');

      await factsMemory.remember(chatId, normalizedKey, value);

      return {
        success: true,
        message: `FACT_MEMORIZED: I've noted "${normalizedKey}" = "${value}". I will remember it! 📝`,
      };
    } catch (error: unknown) {
      console.error('[Memory Plugin] Error remember:', error);
      return {
        success: false,
        message: `Memorization error: ${extractErrorMessage(error)}`,
      };
    }
  },

  /**
   * Recalls a fact
   */
  async _recallFact(chatId: string, key: string) {
    try {
      const { factsMemory } = await getServices();
      const normalizedKey = key.toLowerCase().replace(/\s+/g, '_');
      const value = await factsMemory.get(chatId, normalizedKey);

      if (value) {
        return {
          success: true,
          message: `FACT_FOUND: ${normalizedKey} = "${value}"`,
        };
      } else {
        return {
          success: false,
          message: `FACT_UNKNOWN: I have no information on "${key}" for this user.`,
        };
      }
    } catch (error: unknown) {
      console.error('[Memory Plugin] Error recall:', error);
      return {
        success: false,
        message: `Recall error: ${extractErrorMessage(error)}`,
      };
    }
  },

  /**
   * Lists all facts
   */
  async _listFacts(chatId: string) {
    try {
      const { factsMemory } = await getServices();
      const facts = await factsMemory.getAll(chatId);
      const entries = Object.entries(facts);

      if (entries.length === 0) {
        return {
          success: true,
          message: "NO_FACTS: I haven't memorized any information for this user yet.",
        };
      }

      const formatted = entries.map(([key, value]) => `• ${key}: ${value}`).join('\n');

      return {
        success: true,
        message: `KNOWN_FACTS (${entries.length}):\n${formatted}`,
      };
    } catch (error: unknown) {
      console.error('[Memory Plugin] Error list:', error);
      return {
        success: false,
        message: `Listing error: ${extractErrorMessage(error)}`,
      };
    }
  },

  /**
   * Forgets a fact
   */
  async _forgetFact(chatId: string, key: string) {
    try {
      const { factsMemory } = await getServices();
      const normalizedKey = key.toLowerCase().replace(/\s+/g, '_');

      // Vérifier si le fait existe
      const existing = await factsMemory.get(chatId, normalizedKey);
      if (!existing) {
        return {
          success: false,
          message: `FACT_NOT_FOUND: I had no information on "${key}" to forget.`,
        };
      }

      await factsMemory.forget(chatId, normalizedKey);

      return {
        success: true,
        message: `FACT_FORGOTTEN: I've forgotten "${normalizedKey}". This information has been removed. 🗑️`,
      };
    } catch (error: unknown) {
      console.error('[Memory Plugin] Error forget:', error);
      return {
        success: false,
        message: `Forget error: ${extractErrorMessage(error)}`,
      };
    }
  },

  /**
   * Workspace Write
   */
  async _workspaceWrite(chatId: string, key: string, content: string, tags?: string[]) {
    try {
      if (!key) {
        return {
          success: false,
          message:
            'WORKSPACE_ERROR: Le paramètre "key" (identifiant unique du document) est obligatoire.',
        };
      }
      if (!content) {
        return {
          success: false,
          message: 'WORKSPACE_ERROR: Le paramètre "content" est obligatoire.',
        };
      }
      const { workspaceMemory } = await getServices();
      const success = await workspaceMemory.write(chatId, key, content, tags || []);
      if (success) {
        return {
          success: true,
          message: `WORKSPACE_WRITTEN: Document "${key}" saved successfully.`,
        };
      }
      return { success: false, message: `Error saving document "${key}".` };
    } catch (error: unknown) {
      return { success: false, message: `Internal error: ${extractErrorMessage(error)}` };
    }
  },

  /**
   * Workspace Read
   */
  async _workspaceRead(chatId: string, key: string) {
    try {
      const { workspaceMemory } = await getServices();
      const doc = await workspaceMemory.read(chatId, key);
      if (doc) {
        return {
          success: true,
          message: `WORKSPACE_DOC [${key}]:\n${doc.content}\n\nTags: ${(doc.tags || []).join(', ')}`,
        };
      }
      return { success: false, message: `WORKSPACE_NOT_FOUND: Document "${key}" does not exist.` };
    } catch (error: unknown) {
      return { success: false, message: `Internal error: ${extractErrorMessage(error)}` };
    }
  },

  /**
   * Workspace Search
   */
  async _workspaceSearch(chatId: string, query: string, tags?: string[]) {
    try {
      const { workspaceMemory } = await getServices();
      const results = await workspaceMemory.search(chatId, query, tags || []);
      if (results && results.length > 0) {
        const formatted = results
          .map(
            (r) =>
              `- [${r.key}] (Score: ${Math.round((r as unknown as WorkspaceSearchResult).similarity * 100)}%): ${r.content.substring(0, 200)}...`,
          )
          .join('\n');
        return { success: true, message: `WORKSPACE_SEARCH_RESULTS:\n${formatted}` };
      }
      return { success: true, message: `WORKSPACE_NO_MATCH: No documents found for "${query}".` };
    } catch (error: unknown) {
      return { success: false, message: `Internal error: ${extractErrorMessage(error)}` };
    }
  },

  /**
   * Workspace Delete
   */
  async _workspaceDelete(chatId: string, key: string) {
    try {
      const { workspaceMemory } = await getServices();
      const success = await workspaceMemory.delete(chatId, key);
      if (success) {
        return { success: true, message: `WORKSPACE_DELETED: Document "${key}" deleted.` };
      }
      return { success: false, message: `Error deleting "${key}".` };
    } catch (error: unknown) {
      return { success: false, message: `Internal error: ${extractErrorMessage(error)}` };
    }
  },

  // === V3 DYNAMIC CONTEXT TOOLS ===

  /**
   * Updates the L1 Redis scratchpad (GCC). Content will appear in the
   * agent's <scratchpad> block at the next turn.
   */
  async _updateScratchpad(chatId: string, text: string) {
    try {
      const { workingMemory } = await getServices();
      if (!text || typeof text !== 'string') {
        return {
          success: false,
          message: 'SCRATCHPAD_ERROR: text parameter is required (string).',
        };
      }

      await workingMemory.setScratchpad(chatId, text);

      return {
        success: true,
        message: `SCRATCHPAD_UPDATED: Your working memory has been updated (${Math.min(text.length, 500)} chars). It will be visible in your <scratchpad> at the next turn.`,
      };
    } catch (error: unknown) {
      return { success: false, message: `SCRATCHPAD_ERROR: ${extractErrorMessage(error)}` };
    }
  },

  /**
   * Pull-based RAG search. The agent calls this when it needs deep context
   * that is NOT present in its L1 hot cache.
   */
  async _searchLongTermMemory(chatId: string, query: string) {
    try {
      const { semanticMemory } = await getServices();
      if (!query || typeof query !== 'string') {
        return { success: false, message: 'LTM_ERROR: query parameter is required (string).' };
      }

      const results = await semanticMemory.recall(chatId, query, 5);

      if (!results || results.length === 0) {
        return {
          success: true,
          message: 'LTM_NO_RESULTS: No relevant memories found for this query.',
        };
      }

      const formatted = results
        .map((r: SemanticMemoryResult, i: number) => {
          const content = r.formattedContent || r.content;
          return `${i + 1}. [${r.role || 'unknown'}] ${content.substring(0, 300)}`;
        })
        .join('\n');

      return {
        success: true,
        message: `LTM_RESULTS (${results.length} memories):\n${formatted}`,
      };
    } catch (error: unknown) {
      return { success: false, message: `LTM_ERROR: ${extractErrorMessage(error)}` };
    }
  },
};
