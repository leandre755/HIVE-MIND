import { enforceFormat } from '../utils/ResponseFormatEnforcer.js';

const ALLOWED_TAGS = new Set([
  'preference',
  'fact',
  'opinion',
  'task',
  'emotion',
  'technical',
  'social',
]);

export const tagService = {
  /**
   * Génère des tags pour un contenu donné
   * @param {string} content
   * @returns {Promise<string[]>}
   */
  async generateTags(content: string): Promise<string[]> {
    if (!content || content.length < 10) return [];

    try {
      const systemPrompt = `Tu es le "Categorizer" de HIVE-MIND.
Ta mission est d'assigner des tags à un souvenir.

<allowed_tags>
preference, fact, opinion, task, emotion, technical, social
</allowed_tags>

<output_format>
Return a JSON array of strings containing only tags from the allowed list (maximum 3 tags). No introduction, no markdown blocks, no text outside the JSON array.

Few-shot examples:
- ["fact", "preference"]
- ["technical", "task", "opinion"]
</output_format>`;

      const { providerRouter } = await import('../providers/index.js');
      const result = await enforceFormat<string[]>(
        async (retryPromptModifier) => {
          const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `Texte : "${content}"` },
          ];
          if (retryPromptModifier) {
            messages.push({ role: 'user', content: retryPromptModifier });
          }
          const response = await providerRouter.chat(messages, {
            family: 'groq',
            model: 'llama-3.1-8b-instant',
            temperature: 0,
            maxTokens: 50,
          });
          return response?.content || '';
        },
        {
          validate: (parsed) => {
            if (!Array.isArray(parsed)) return 'Response must be a JSON array of strings';
            if (parsed.length > 3) return 'You must output a maximum of 3 tags';
            for (const tag of parsed) {
              if (!ALLOWED_TAGS.has(tag)) {
                return `Tag "${tag}" is not in the allowed list: ${Array.from(ALLOWED_TAGS).join(', ')}`;
              }
            }
            return true;
          },
          maxRetries: 2,
        },
      );

      if (result.success && result.data) {
        return result.data;
      }

      console.warn('[TagService] Échec du formatage des tags, repli vide:', result.error);
      return [];
    } catch (error: unknown) {
      console.error(
        '[TagService] Erreur tagging:',
        error instanceof Error ? error.message : String(error),
      );
      return [];
    }
  },
};

export default tagService;
