// services/graphMemory.js
// Service d'interface pour le Knowledge Graph (Entités et Relations)

import { supabase } from './supabase.js';
import { EmbeddingsService } from './ai/EmbeddingsService.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { resolveApiKey } from '../config/keyResolver.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

interface EntityData {
  name: string;
  type?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

interface UpsertEntityResult {
  id: string;
  chat_id: string;
  name: string;
  type: string;
  description: string;
  metadata: Record<string, unknown>;
  embedding: number[];
  updated_at: string;
}

interface RelationshipResult {
  id: string;
  chat_id: string;
  source_id: string;
  target_id: string;
  relation_type: string;
  strength: number;
}

interface NeighborResult {
  relation_type: string;
  strength: number;
  target: {
    id: string;
    name: string;
    type: string;
    description: string;
  } | null;
}

// Initialisation embeddings
let embeddings: EmbeddingsService | null = null;
try {
  const credentials = JSON.parse(
    readFileSync(join(__dirname, '..', 'config', 'credentials.json'), 'utf-8'),
  );

  const geminiKey = resolveApiKey(credentials.familles_ia?.gemini, 'gemini');
  const openaiKey = resolveApiKey(credentials.familles_ia?.openai, 'openai');

  embeddings = new EmbeddingsService({
    geminiKey: geminiKey || undefined,
    openaiKey: openaiKey || undefined,
  });
} catch (error: unknown) {
  console.error('[GraphMemory] Erreur init embeddings:', extractErrorMessage(error));
}

export const graphMemory = {
  async upsertEntity(chatId: string, entity: EntityData): Promise<UpsertEntityResult | null> {
    if (!supabase || !entity.name) return null;

    try {
      const textToEmbed = `${entity.name}: ${entity.description || ''}`;
      const vector = await embeddings?.embed(textToEmbed);

      const { data, error } = await supabase
        .from('entities')
        .upsert(
          {
            chat_id: chatId,
            name: entity.name,
            type: entity.type || 'Concept',
            description: entity.description,
            metadata: entity.metadata || {},
            embedding: vector,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'chat_id,name' },
        )
        .select()
        .single();

      if (error) throw error;
      return data as UpsertEntityResult;
    } catch (error: unknown) {
      console.error('[GraphMemory] Erreur upsertEntity:', extractErrorMessage(error));
      return null;
    }
  },

  async addRelationship(
    chatId: string,
    sourceName: string,
    targetName: string,
    relationType: string,
    strength: number = 1.0,
  ): Promise<RelationshipResult | null> {
    if (!supabase) return null;

    try {
      const { data: source } = await supabase
        .from('entities')
        .select('id')
        .eq('chat_id', chatId)
        .eq('name', sourceName)
        .single();

      const { data: target } = await supabase
        .from('entities')
        .select('id')
        .eq('chat_id', chatId)
        .eq('name', targetName)
        .single();

      if (!source || !target) {
        console.warn(
          `[GraphMemory] Relation impossible: Entité(s) non trouvée(s) (${sourceName} -> ${targetName})`,
        );
        return null;
      }

      const { data, error } = await supabase
        .from('relationships')
        .upsert(
          {
            chat_id: chatId,
            source_id: (source as { id: string }).id,
            target_id: (target as { id: string }).id,
            relation_type: relationType,
            strength,
          },
          { onConflict: 'source_id,target_id,relation_type' },
        )
        .select()
        .single();

      if (error) throw error;
      return data as RelationshipResult;
    } catch (error: unknown) {
      console.error('[GraphMemory] Erreur addRelationship:', extractErrorMessage(error));
      return null;
    }
  },

  async upsertEntitiesBatch(chatId: string, entities: EntityData[]): Promise<Map<string, string>> {
    const resultMap = new Map<string, string>();
    if (!supabase || !entities.length) return resultMap;

    try {
      const rows = await Promise.all(
        entities.map(async (ent) => {
          const textToEmbed = `${ent.name}: ${ent.description || ''}`;
          const vector = await embeddings?.embed(textToEmbed);
          return {
            chat_id: chatId,
            name: ent.name,
            type: ent.type || 'Concept',
            description: ent.description,
            metadata: ent.metadata || {},
            embedding: vector,
            updated_at: new Date().toISOString(),
          };
        }),
      );

      const { data, error } = await supabase
        .from('entities')
        .upsert(rows, { onConflict: 'chat_id,name' })
        .select('id, name');

      if (error) throw error;
      for (const item of data || []) {
        if (item.name && item.id) resultMap.set(item.name, item.id);
      }
    } catch (error: unknown) {
      console.error('[GraphMemory] Erreur upsertEntitiesBatch:', extractErrorMessage(error));
    }
    return resultMap;
  },

  async addRelationshipsBatch(
    chatId: string,
    relationships: Array<{ source: string; target: string; type: string; strength?: number }>,
  ): Promise<void> {
    if (!supabase || !relationships.length) return;

    try {
      const nameSet = new Set<string>();
      relationships.forEach((r) => {
        nameSet.add(r.source);
        nameSet.add(r.target);
      });

      const { data: entities, error: fetchErr } = await supabase
        .from('entities')
        .select('id, name')
        .eq('chat_id', chatId)
        .in('name', Array.from(nameSet));

      if (fetchErr) throw fetchErr;

      const nameToId = new Map<string, string>();
      (entities || []).forEach((e: { id: string; name: string }) => nameToId.set(e.name, e.id));

      const rows = relationships
        .filter((r) => nameToId.has(r.source) && nameToId.has(r.target))
        .map((r) => ({
          chat_id: chatId,
          source_id: nameToId.get(r.source)!,
          target_id: nameToId.get(r.target)!,
          relation_type: r.type,
          strength: r.strength ?? 1.0,
        }));

      if (rows.length > 0) {
        const { error: upsertErr } = await supabase
          .from('relationships')
          .upsert(rows, { onConflict: 'source_id,target_id,relation_type' });
        if (upsertErr) throw upsertErr;
      }
    } catch (error: unknown) {
      console.error('[GraphMemory] Erreur addRelationshipsBatch:', extractErrorMessage(error));
    }
  },

  async searchEntities(
    chatId: string,
    query: string,
    limit: number = 5,
  ): Promise<UpsertEntityResult[]> {
    if (!supabase) return [];

    try {
      const vector = await embeddings?.embed(query);
      if (!vector) return [];

      const { data, error } = await supabase.rpc('match_entities', {
        query_embedding: vector,
        match_context_id: chatId,
        match_threshold: 0.7,
        match_count: limit,
      });

      if (error) throw error;
      return (data as UpsertEntityResult[]) || [];
    } catch (error: unknown) {
      console.error('[GraphMemory] Erreur searchEntities:', extractErrorMessage(error));
      return [];
    }
  },

  async getNeighbors(entityId: string): Promise<NeighborResult[]> {
    if (!supabase) return [];

    try {
      const { data, error } = await supabase
        .from('relationships')
        .select(
          `
                    relation_type,
                    strength,
                    target:entities!target_id(id, name, type, description)
                `,
        )
        .eq('source_id', entityId);

      if (error) throw error;
      return (data as unknown as NeighborResult[]) || [];
    } catch (error: unknown) {
      console.error('[GraphMemory] Erreur getNeighbors:', extractErrorMessage(error));
      return [];
    }
  },
};

export default graphMemory;
