// services/consolidationService.js
// Service de consolidation de la mémoire (Redis -> Supabase)

import { workingMemory } from './workingMemory.js';

interface ConsolidationMessage {
  role: string;
  content: string;
}

const consolidationLocks = new Set<string>();

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export const consolidationService = {
  /**
   * Consolide la mémoire à court terme d'un chat précis
   * @param {string} chatId
   */
  async consolidate(chatId: string) {
    if (consolidationLocks.has(chatId)) {
      console.log(`[Consolidation] ⏳ Consolidation déjà en cours pour ${chatId}, sautée.`);
      return;
    }
    consolidationLocks.add(chatId);

    try {
      // 1. Récupérer le contexte Redis
      const context = await workingMemory.getContext(chatId);

      // On ne consolide que s'il y a plus de 5 messages (seuil de consolidation)
      if (!context || context.length < 5) {
        return;
      }

      console.log(
        `[Consolidation] 🔄 Début de la synthèse pour ${chatId} (${context.length} msgs)...`,
      );

      // 2. Formater le texte pour l'IA
      const conversationText = context
        .map(
          (m: ConsolidationMessage) =>
            `[${m.role === 'user' ? 'Utilisateur' : 'Bot'}]: ${m.content}`,
        )
        .join('\n');

      // 3. Appel IA pour une synthèse de haute qualité
      const systemPrompt = `Tu es le "Cognitive Auditor" du système HIVE-MIND.
Ta mission est de synthétiser les interactions récentes pour en extraire l'essence stratégique.

CONSIGNES :
1. Produis un résumé dense et factuel des points clés.
2. Identifie les engagements pris, les préférences de l'utilisateur et les informations techniques partagées.
3. Ignore le "bruit" (salutations, remerciements, small talk).

Format : Un paragraphe court et percutant.`;

      const { providerRouter } = await import('../providers/index.js');
      const response = await providerRouter.chat(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: conversationText },
        ],
        { family: 'groq', model: 'llama-3.3-70b-versatile', temperature: 0.3 },
      );

      const synthesis = response?.content;

      if (synthesis) {
        const { semanticMemory } = await import('./memory.js');
        const { knowledgeWeaver } = await import('./knowledgeWeaver.js');
        // 4. Stocker la synthèse dans la mémoire sémantique
        await semanticMemory.store(chatId, `[SYNTHÈSE CONSOLIDÉE] : ${synthesis}`, 'assistant');

        // 5. Lancer le Tisseur de Savoir sur le texte brut pour le Graphe
        // On passe le texte original pour ne rien perdre du détail des entités
        await knowledgeWeaver.weave(chatId, conversationText);

        // 6. Nettoyer Redis (On ne garde que les 2 derniers messages pour la continuité immédiate)
        // Note: lTrim est déjà géré par addMessage, mais ici on veut forcer un nettoyage après consolidation
        // Pour l'instant on laisse Redis expirer ou se faire trimmer naturellement pour éviter des ruptures de dialogue.

        console.log(`[Consolidation] ✅ Succès pour ${chatId}`);
      }
    } catch (error: unknown) {
      console.error('[Consolidation] Erreur :', extractErrorMessage(error));
    } finally {
      consolidationLocks.delete(chatId);
    }
  },

  /**
   * Consolide la mémoire de TOUS les chats actifs récemment
   * Appelé par le Scheduler
   */
  async consolidateAll() {
    try {
      // Dans un système réel, on récupèrerait la liste des IDs de chats actifs depuis Redis
      // Pour HIVE-MIND, on peut utiliser workingMemory.getInactiveGroups() ou une liste globale.
      // Ici, on va supposer que l'orchestrateur ou le scheduler connaît les cibles.
      console.log('[Consolidation] 🌍 Début de la consolidation globale...');
      // ... Logique de boucle sur les chats ...
    } catch (error: unknown) {
      console.error('[Consolidation Global] Erreur :', extractErrorMessage(error));
    }
  },
};

export default consolidationService;
