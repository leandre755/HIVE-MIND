import { graphMemory } from './graphMemory.js';
import { tryParseJson } from '../utils/ResponseFormatEnforcer.js';

interface KnowledgeEntity {
  name: string;
  type?: string;
  description?: string;
}

interface KnowledgeRelationship {
  source: string;
  target: string;
  type: string;
}

interface KnowledgeGraphData {
  entities?: KnowledgeEntity[];
  relationships?: KnowledgeRelationship[];
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export const knowledgeWeaver = {
  /**
   * Analyse un message ou une conversation pour extraire du savoir structuré
   * @param {string} chatId
   * @param {string} text
   */
  async weave(chatId: string, text: string) {
    if (!text || text.length < 10) return;

    try {
      console.log(`[KnowledgeWeaver] 🧶 Tissage en cours pour ${chatId}...`);

      const systemPrompt = `Tu es le "Knowledge Weaver" (Tisseur de Savoir) du bot HIVE-MIND.
Ta mission est d'extraire des entités et leurs relations depuis le texte fourni pour construire un Knowledge Graph.

TYPES D'ENTITÉS : Personne, Lieu, Organisation, Projet, Concept, Événement, Skill.
TYPES DE RELATIONS : connait, travaille_sur, habite_a, est_lie_a, participe_a, utilise, expert_en.

RÈGLES :
1. N'extrais que des informations FACTUELLES et explicites.
2. Si une entité existe déjà (ex: mentionnée avant), réutilise son nom exact.
3. Sois concis dans les descriptions.

<output_format>
RÉPONDS UNIQUEMENT EN JSON :
{
  "entities": [
    { "name": "Nom", "type": "Type", "description": "Brève description" }
  ],
  "relationships": [
    { "source": "NomSource", "target": "NomCible", "type": "TypeRelation" }
  ]
}

Few-shot example:
{
  "entities": [
    { "name": "Alex", "type": "Personne", "description": "Développeur TypeScript et créateur de HIVE-MIND" },
    { "name": "Railway", "type": "Organisation", "description": "Plateforme d'hébergement cloud" }
  ],
  "relationships": [
    { "source": "Alex", "target": "Railway", "type": "utilise" }
  ]
}
</output_format>`;

      const { providerRouter } = await import('../providers/index.js');
      const response = await providerRouter.chat(
        [
          { role: 'system', content: 'Tu es le Knowledge Weaver de HIVE-MIND. Output JSON only.' },
          { role: 'user', content: systemPrompt },
          { role: 'user', content: `Texte à analyser :\n"${text}"` },
        ],
        {
          family: 'kimi',
          model: 'kimi-for-coding', // Spécialiste extraction structurée
          temperature: 0.1,
        },
      );

      if (!response?.content) return;

      const data = tryParseJson<KnowledgeGraphData>(response.content);

      // 1. Enregistrer les entités en lot (batch)
      if (data.entities && data.entities.length > 0) {
        await graphMemory.upsertEntitiesBatch(chatId, data.entities);
      }

      // 2. Enregistrer les relations en lot (batch)
      if (data.relationships && data.relationships.length > 0) {
        await graphMemory.addRelationshipsBatch(chatId, data.relationships);
      }

      console.log(
        `[KnowledgeWeaver] ✅ Tissage terminé : ${data.entities?.length || 0} entités, ${data.relationships?.length || 0} relations.`,
      );
    } catch (error: unknown) {
      console.error('[KnowledgeWeaver] Erreur lors du tissage:', extractErrorMessage(error));
    }
  },
};

export default knowledgeWeaver;
