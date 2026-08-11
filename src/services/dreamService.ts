// services/dreamService.js
// Module de Rêve : Analyse des actions passées pour l'auto-apprentissage

import { writeFileSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { agentMemory } from './agentMemory.js';
import { supabase } from './supabase.js';

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const LESSONS_PATH = join(__dirname, '..', 'persona', 'lessons_learned.md');

export const dreamService = {
  /**
   * Analyse les actions des dernières 24h et met à jour les leçons apprises
   */
  async dream() {
    console.log('[DreamService] 💤 Phase de rêve (Auto-Reflection)...');

    const currentLessons = this.getLessons();
    const recentErrors = await this.getRecentErrors();

    const prompt = `<role>
You are HIVE-MIND's self-reflection module running during low-activity periods.
Your purpose: analyze recent failures and extract lessons to prevent repetition.
</role>

<recent_errors>
${recentErrors.map((err: string) => `- ${err}`).join('\n')}
</recent_errors>

<current_lessons>
${currentLessons}
</current_lessons>

<task>
Analyze error patterns to extract actionable lessons.
Focus on: recurring issues, wrong tool selections, parameter mistakes, technical limitations.
Create 3-5 CRITICAL, ACTIONABLE lessons to prevent repetition.
</task>

<output_format>
Format: Markdown bullet points ONLY. Do not write introductions, explanations, or conclusions. Just the bullet points.

Style: Concise, imperative sentences starting with a verb (e.g., "Avoid", "Always").
Length: Maximum 10 bullet points total.
Focus ONLY on specific, actionable lessons.

Few-shot examples:
- Avoid executing heavy NPM operations in parallel to prevent system memory overload.
- Always check list_directory output before reading a file to ensure it exists.
- Never hardcode dynamic API keys; read them from process.env.
</output_format>

Lessons:`;

    // 🛡️ CORRECTION: Retry avec backoff exponentiel
    let retries = 0;
    const maxRetries = 3;

    while (retries < maxRetries) {
      try {
        const { providerRouter } = await import('../providers/index.js');
        const response = await providerRouter.callServiceRecipe('DREAM_SERVICE', [
          { role: 'system', content: 'Tu es le module de réflexion interne du bot.' },
          { role: 'user', content: prompt },
        ]);

        if (response?.content) {
          const newLessons = `# Lessons Learned (Updated: ${new Date().toLocaleDateString()})

${response.content}`;
          writeFileSync(LESSONS_PATH, newLessons);
          console.log('[DreamService] ✅ Rêve terminé. Nouvelles leçons enregistrées.');

          // 🛡️ Sync Embeddings des outils (Audit #20)
          await this.syncToolEmbeddings().catch((e) =>
            console.warn('[DreamService] Embeddings sync failed:', e.message),
          );

          return; // Succès, on sort
        }
      } catch (error: unknown) {
        retries++;
        const errorMessage = extractErrorMessage(error);

        if (retries < maxRetries) {
          const delay = 5000 * Math.pow(2, retries); // Backoff: 5s, 10s, 20s
          console.warn(
            `[DreamService] ⚠️ Tentative ${retries}/${maxRetries} échouée, retry dans ${delay / 1000}s...`,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        } else {
          console.error('[DreamService] ❌ Échec après %d tentatives:', maxRetries, errorMessage);
        }
      }
    }
  },

  /**
   * Synchronise les embeddings des outils pour le RAG d'outils (Audit #20)
   */
  async syncToolEmbeddings() {
    if (!supabase) return;

    try {
      console.log("[DreamService] 🔄 Synchronisation des embeddings d'outils...");
      const { data: tools, error } = await supabase
        .from('bot_tools')
        .select('name, definition, embedding');

      if (error) throw error;
      if (!tools || tools.length === 0) return;

      const container = (
        globalThis as unknown as {
          container?: {
            get(name: string): unknown;
          };
        }
      ).container;
      const embeddings = container?.get('embeddings') as
        { embed(text: string): Promise<number[]> } | undefined;
      if (!embeddings) return;

      for (const tool of tools) {
        // Si pas d'embedding, on le génère
        if (!tool.embedding) {
          console.log(`[DreamService] 💎 Génération embedding pour outil: ${tool.name}`);
          const textToEmbed = `${tool.definition.name}: ${tool.definition.description}`;
          const vector = await embeddings.embed(textToEmbed);

          if (vector) {
            await supabase.from('bot_tools').update({ embedding: vector }).eq('name', tool.name);
          }
        }
      }
    } catch (e: unknown) {
      console.error('[DreamService] Erreur sync tool embeddings:', extractErrorMessage(e));
    }
  },

  /**
   * Charge les leçons pour les injecter dans le prompt
   */
  getLessons() {
    try {
      return readFileSync(LESSONS_PATH, 'utf-8');
    } catch {
      return '';
    }
  },

  /**
   * Récupère les erreurs récentes depuis l'AgentMemory
   */
  async getRecentErrors() {
    try {
      const lessons = await agentMemory.getGlobalLessonsLearned(10);
      return lessons.map((l: { tool: string; error: string | null }) => `[${l.tool}] ${l.error}`);
    } catch {
      return [];
    }
  },
};

export default dreamService;
