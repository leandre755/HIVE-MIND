// services/memory.ts
// Service de mémoire sémantique (RAG) avec pgvector

import { supabase, db } from './supabase.js';

interface EmbeddingsService {
  embed(text: string, taskType: string): Promise<number[] | null>;
}

interface ContainerService {
  has(name: string): boolean;
  get(name: string): EmbeddingsService;
}

interface MemoryRow {
  id?: string;
  content: string;
  role: string;
  created_at?: string;
  chat_id?: string;
  context_id?: string;
  embedding?: number[];
  metadata?: Record<string, unknown>;
}

interface FactRow {
  key: string;
  value: string;
}

interface WorkspaceRow {
  id?: string;
  content: string;
  tags?: string[];
  access_count?: number;
  variance?: number;
  key?: string;
  updated_at?: string;
  context_id?: string;
}

interface FormattedMemory extends MemoryRow {
  formattedContent: string;
}

interface SummarizeResult {
  success: boolean;
  reason?: string;
  summarized?: number;
  summary?: string;
}

let embeddingsInstance: EmbeddingsService | null = null;
let containerInstance: ContainerService | null = null;

async function getEmbeddingsService(): Promise<EmbeddingsService | null> {
  if (embeddingsInstance) return embeddingsInstance;

  try {
    if (!containerInstance) {
      const serviceContainer = (globalThis as unknown as { container?: ContainerService })
        .container;
      if (serviceContainer) {
        containerInstance = serviceContainer;
      }
    }

    if (containerInstance?.has('embeddings')) {
      embeddingsInstance = containerInstance.get('embeddings');
      console.log('[Memory] ✅ EmbeddingsService chargé depuis container (singleton)');
    } else {
      console.warn('[Memory] EmbeddingsService non disponible dans container');
    }
  } catch (e: unknown) {
    console.error(
      '[Memory] Erreur chargement EmbeddingsService depuis container:',
      e instanceof Error ? e.message : String(e),
    );
  }

  return embeddingsInstance;
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export const semanticMemory = {
  async store(
    chatId: string,
    content: string,
    role: 'user' | 'assistant',
    options: { msgId?: string } = {},
  ): Promise<void> {
    if (!supabase || !content?.trim()) return;

    const emb = await getEmbeddingsService();
    if (!emb) {
      console.warn('[Memory] EmbeddingsService non disponible, message non vectorisé');
      return;
    }

    const vector = await emb.embed(content, 'RETRIEVAL_DOCUMENT');
    if (!vector) {
      console.warn('[Memory] Échec génération embedding, message non vectorisé.');
      return;
    }

    let tags: string[] = [];
    try {
      const { tagService } = await import('./tagService.js');
      tags = await tagService.generateTags(content);
    } catch (e: unknown) {
      console.warn('[Memory] Erreur tagging:', extractErrorMessage(e));
    }

    const metadata = {
      msgId: options.msgId,
      tags,
      storedAt: new Date().toISOString(),
    };

    let contextId = chatId;
    try {
      const { db: dbMod } = await import('./supabase.js');
      const resolved = await dbMod.resolveContextFromLegacyId(chatId);
      if (resolved) {
        contextId = resolved.context_id;
      }
    } catch (e: unknown) {
      console.warn('[Memory] Résolution context_id échouée:', extractErrorMessage(e));
    }

    const { error } = await supabase.from('memories').insert({
      context_id: contextId,
      content: content.substring(0, 2000),
      role,
      embedding: vector,
      metadata,
    });

    if (error) console.error('[Memory] Erreur store:', error);
  },

  async recall(chatId: string, query: string, limit = 5): Promise<FormattedMemory[]> {
    if (!supabase) return [];

    const emb = await getEmbeddingsService();
    if (!emb) {
      console.warn('[Memory] EmbeddingsService non disponible, fallback temporel');
      const { data } = await supabase
        .from('memories')
        .select('content, role, created_at')
        .eq('chat_id', chatId)
        .order('created_at', { ascending: false })
        .limit(limit);

      return this._formatWithAge((data || []) as MemoryRow[]);
    }

    const vector = await emb.embed(query, 'RETRIEVAL_QUERY');
    if (!vector) {
      console.warn('[Memory] Échec embedding requête, fallback temporel');
      const { data } = await supabase
        .from('memories')
        .select('content, role, created_at')
        .eq('chat_id', chatId)
        .order('created_at', { ascending: false })
        .limit(limit);

      return this._formatWithAge((data || []) as MemoryRow[]);
    }

    let contextId = chatId;
    try {
      const resolved = await db.resolveContextFromLegacyId(chatId);
      if (resolved) {
        contextId = resolved.context_id;
      }
    } catch (e: unknown) {
      console.warn('[Memory] Résolution context_id échouée, skip recall:', extractErrorMessage(e));
      return [];
    }

    const { data, error } = await supabase.rpc('match_memories', {
      query_embedding: vector,
      match_context_id: contextId,
      match_threshold: 0.7,
      match_count: limit,
    });

    if (error) {
      console.error('[Memory] Erreur recall:', error);
      return [];
    }

    let globalData: MemoryRow[] = [];
    try {
      const { data: gData, error: gError } = await supabase.rpc('match_memories', {
        query_embedding: vector,
        match_context_id: 'global',
        match_threshold: 0.65,
        match_count: limit,
      });

      if (!gError && gData) {
        globalData = gData;
      }
    } catch (e: unknown) {
      console.warn('[Memory] Erreur global recall:', extractErrorMessage(e));
    }

    const combined = [...((data || []) as MemoryRow[]), ...globalData];
    const unique = Array.from(new Map(combined.map((item) => [item.id, item])).values());

    return this._formatWithAge(unique.slice(0, limit + 2));
  },

  _formatWithAge(memories: MemoryRow[]): FormattedMemory[] {
    return memories.map((m) => {
      const age = this._formatAge(m.created_at);
      return {
        ...m,
        formattedContent: `[${age}] ${m.content}`,
      };
    });
  },

  _formatAge(createdAt: string | undefined): string {
    if (!createdAt) return 'Date inconnue';

    const now = Date.now();
    const then = new Date(createdAt).getTime();
    const diffMs = now - then;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return "Aujourd'hui";
    if (diffDays === 1) return 'Hier';
    if (diffDays < 7) return `Il y a ${diffDays} jours`;
    if (diffDays < 30) return `Il y a ${Math.floor(diffDays / 7)} semaines`;
    if (diffDays < 365) return `Il y a ${Math.floor(diffDays / 30)} mois`;
    return `Il y a ${Math.floor(diffDays / 365)} ans`;
  },

  async getRecentContext(chatId: string, limit = 10): Promise<string> {
    if (!supabase) return '';

    const { data } = await supabase
      .from('memories')
      .select('content, role')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (!data?.length) return '';

    return data
      .reverse()
      .map((m: { role: string; content: string }) => `[${m.role}]: ${m.content}`)
      .join('\n');
  },

  async summarize(chatId: string, keepLast = 50): Promise<SummarizeResult> {
    if (!supabase) return { success: false, reason: 'Supabase non disponible' };

    try {
      const { count } = await supabase
        .from('memories')
        .select('*', { count: 'exact', head: true })
        .eq('chat_id', chatId);

      if (!count || count <= keepLast) {
        return { success: true, reason: 'Pas assez de messages à résumer' };
      }

      const toSkip = count - keepLast;
      const { data: oldMessages } = await supabase
        .from('memories')
        .select('id, content, role, created_at')
        .eq('chat_id', chatId)
        .order('created_at', { ascending: true })
        .limit(Math.min(toSkip, 100));

      if (!oldMessages || oldMessages.length < 10) {
        return { success: true, reason: 'Pas assez de messages pour un résumé significatif' };
      }

      const conversationText = oldMessages
        .map((m: { role: string; content: string }) => `[${m.role}]: ${m.content}`)
        .join('\n');

      const { providerRouter } = await import('../providers/index.js');

      console.log(`[Memory] Résumé de ${oldMessages.length} messages pour ${chatId}...`);

      const response = await providerRouter.chat(
        [
          {
            role: 'system',
            content: `Tu es un assistant de mémorisation de HIVE-MIND.
Ta mission est de résumer cette conversation en points clés factuels uniquement.

<output_format>
Format: Liste à puces Markdown uniquement. Pas d'introduction, d'explication ou de salutation.
Chaque point doit être une déclaration à la troisième personne sur l'utilisateur ou la situation.

Few-shot examples:
- L'utilisateur s'appelle Alex et préfère coder en TypeScript strict.
- La base de données de production rencontre des lenteurs de RAG pgvector le soir.
- Un script de test de stickers a été exécuté avec succès par l'administrateur.
</output_format>`,
          },
          {
            role: 'user',
            content: conversationText,
          },
        ],
        { temperature: 0.3, family: 'gemini' },
      );

      if (!response?.content) {
        return { success: false, reason: 'Échec génération résumé IA' };
      }

      const timestamp = new Date().toISOString().split('T')[0];
      await this.store(chatId, response.content, 'assistant', { msgId: `résumé_${timestamp}` });

      const idsToDelete = oldMessages.map((m: { id: string }) => m.id);
      await supabase.from('memories').delete().in('id', idsToDelete);

      console.log(`[Memory] ✅ Résumé créé, ${idsToDelete.length} anciens messages supprimés`);

      return {
        success: true,
        summarized: idsToDelete.length,
        summary: response.content.substring(0, 200) + '...',
      };
    } catch (error: unknown) {
      console.error('[Memory] Erreur summarize:', extractErrorMessage(error));
      return { success: false, reason: extractErrorMessage(error) };
    }
  },

  async cleanup(chatId: string, keepLast = 50): Promise<void> {
    if (!supabase) return;

    const { data: toKeep } = await supabase
      .from('memories')
      .select('id')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: false })
      .limit(keepLast);

    if (!toKeep?.length) return;

    const keepIds = toKeep.map((m: { id: string }) => m.id);

    await supabase
      .from('memories')
      .delete()
      .eq('chat_id', chatId)
      .not('id', 'in', `(${keepIds.join(',')})`);
  },
};

export const factsMemory = {
  async remember(chatId: string, key: string, value: string): Promise<void> {
    if (!supabase) return;

    const { error } = await supabase.from('facts').upsert(
      {
        chat_id: chatId,
        key,
        value,
      },
      { onConflict: 'chat_id,key' },
    );

    if (error) console.error('[Facts] Erreur remember:', error);
  },

  async getAll(chatId: string): Promise<Record<string, string>> {
    if (!supabase) return {};

    const { data } = await supabase.from('facts').select('key, value').eq('chat_id', chatId);

    if (!data) return {};

    return data.reduce((acc: Record<string, string>, fact: FactRow) => {
      acc[fact.key] = fact.value;
      return acc;
    }, {});
  },

  async get(chatId: string, key: string): Promise<string | null> {
    if (!supabase) return null;

    const { data } = await supabase
      .from('facts')
      .select('value')
      .eq('chat_id', chatId)
      .eq('key', key)
      .single();

    return data?.value || null;
  },

  async forget(chatId: string, key: string): Promise<void> {
    if (!supabase) return;

    await supabase.from('facts').delete().eq('chat_id', chatId).eq('key', key);
  },

  async format(chatId: string): Promise<string> {
    const facts = await this.getAll(chatId);
    if (Object.keys(facts).length === 0) return '';

    return Object.entries(facts)
      .map(([key, value]) => `- ${key}: ${value}`)
      .join('\n');
  },
};

export const workspaceMemory = {
  async write(chatId: string, key: string, content: string, tags: string[] = []): Promise<boolean> {
    if (!supabase) return false;
    if (!key) {
      console.error('[Workspace] Erreur write: key est vide ou non défini');
      return false;
    }

    let contextId = chatId;
    try {
      const { db: dbMod } = await import('./supabase.js');
      const resolved = await dbMod.resolveContextFromLegacyId(chatId);
      if (resolved) contextId = resolved.context_id;
    } catch (e: unknown) {
      console.warn('[Workspace] Résolution context_id échouée:', extractErrorMessage(e));
    }

    const emb = await getEmbeddingsService();
    let vector: number[] | null = null;
    if (emb) {
      vector = await emb.embed(content, 'RETRIEVAL_DOCUMENT');
    }

    const { error } = await supabase.from('agent_workspace').upsert(
      {
        context_id: contextId,
        key,
        content,
        tags,
        embedding: vector,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'context_id,key' },
    );

    if (error) {
      console.error('[Workspace] Erreur write:', error.message);
      return false;
    }
    return true;
  },

  async read(chatId: string, key: string): Promise<WorkspaceRow | null> {
    if (!supabase) return null;

    let contextId = chatId;
    try {
      const { db: dbMod } = await import('./supabase.js');
      const resolved = await dbMod.resolveContextFromLegacyId(chatId);
      if (resolved) contextId = resolved.context_id;
    } catch {
      /* fallback to raw chatId */
    }

    const { data, error } = await supabase
      .from('agent_workspace')
      .select('id, content, tags, access_count, variance')
      .eq('context_id', contextId)
      .eq('key', key)
      .single();

    if (error || !data) return null;
    try {
      await supabase.rpc('increment_workspace_access', { match_id: data.id });
    } catch {
      await supabase
        .from('agent_workspace')
        .update({
          access_count: (data.access_count || 0) + 1,
          last_accessed: new Date().toISOString(),
        })
        .eq('context_id', contextId)
        .eq('key', key);
    }

    return data as WorkspaceRow;
  },

  async search(chatId: string, query: string, tags: string[] = []): Promise<WorkspaceRow[]> {
    if (!supabase) return [];

    let contextId = chatId;
    try {
      const { db: dbMod } = await import('./supabase.js');
      const resolved = await dbMod.resolveContextFromLegacyId(chatId);
      if (resolved) contextId = resolved.context_id;
    } catch {
      /* fallback to raw chatId */
    }

    const emb = await getEmbeddingsService();
    if (!emb) return [];

    const vector = await emb.embed(query, 'RETRIEVAL_QUERY');
    if (!vector) return [];

    const { data: rpcData, error } = await supabase.rpc('match_workspace', {
      query_embedding: vector,
      match_threshold: 0.6,
      match_count: 5,
      match_context_id: contextId,
    });

    if (error) {
      console.error('[Workspace] Erreur search:', error.message);
      return [];
    }

    let result = rpcData as WorkspaceRow[] | null;
    if (tags && tags.length > 0 && result) {
      result = result.filter((item: WorkspaceRow) => tags.some((tag) => item.tags?.includes(tag)));
    }

    return result || [];
  },

  async delete(chatId: string, key: string): Promise<boolean> {
    if (!supabase) return false;

    let contextId = chatId;
    try {
      const { db: dbMod } = await import('./supabase.js');
      const resolved = await dbMod.resolveContextFromLegacyId(chatId);
      if (resolved) contextId = resolved.context_id;
    } catch {
      /* fallback to raw chatId */
    }

    const { error } = await supabase
      .from('agent_workspace')
      .delete()
      .eq('context_id', contextId)
      .eq('key', key);

    if (error) {
      console.error('[Workspace] Erreur delete:', error.message);
      return false;
    }

    await supabase
      .from('reminders')
      .delete()
      .eq('context_id', contextId)
      .like('message', `[WS: ${key}]%`)
      .eq('sent', false);

    return true;
  },

  async getKeys(chatId: string): Promise<WorkspaceRow[]> {
    if (!supabase) return [];

    let contextId = chatId;
    try {
      const { db: dbMod } = await import('./supabase.js');
      const resolved = await dbMod.resolveContextFromLegacyId(chatId);
      if (resolved) contextId = resolved.context_id;
    } catch {
      /* fallback to raw chatId */
    }

    const { data, error } = await supabase
      .from('agent_workspace')
      .select('key, tags, updated_at')
      .eq('context_id', contextId)
      .order('updated_at', { ascending: false });

    if (error) return [];
    return (data || []) as WorkspaceRow[];
  },
};

export default { semanticMemory, factsMemory, workspaceMemory };
