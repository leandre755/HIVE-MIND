import { container } from '../../../core/container.js';

interface MessageRow {
  readonly sender: string;
  readonly content: string;
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return String(error);
}

export const journalGenerator = {
  /**
   * Génère un script audio basé sur l'activité récente
   * @param {string} chatId
   */
  async generateDailyScript(chatId: string) {
    console.log(`[DailyPulse] 🎙️ Génération du script pour ${chatId}...`);

    // 1. Récupérer l'historique (via WorkingMemory ou Supabase)
    // Pour l'instant, on tape dans la mémoire court terme Redis
    // Idéalement, il faudrait une méthode getHistory(chatId, limit) exposée proprement
    // On va simuler ou récupérer ce qu'on peut.
    // Note: workingMemory stocke le contexte, mais pas forcément l'historique brut accessible facilement
    // On va supposer qu'on a accès aux logs via Supabase pour avoir de la matière

    const { supabase } = await import('../../../services/supabase.js');
    let messages: MessageRow[] = [];

    if (supabase) {
      // Récupérer les 50 derniers messages du jour
      const { data } = await supabase
        .from('messages') // Si table messages existe (dépend de l'implém)
        // Sinon on improvise avec ce qu'on a ou on demande à l'IA d'inventer si pas d'historique
        // Pour ce MVP, on va utiliser le context actuel du bot s'il est chaud, ou un fallback
        .select('sender, content, created_at')
        .eq('chat_id', chatId)
        .order('created_at', { ascending: false })
        .limit(50);

      if (data) messages = data.reverse();
    }

    // Fallback si pas de DB messages : on utilise le contexte courant
    if (messages.length === 0) {
      // On ne peut pas inventer des nouvelles.
      // On va dire qu'il n'y a rien eu de spécial.
      return null;
    }

    // 2. Transformer les messages en texte brut pour le Prompt
    const transcript = messages.map((m: MessageRow) => `${m.sender}: ${m.content}`).join('\n');

    // 3. Prompt "Radio Host"
    const prompt = `
You are the WhatsApp group radio host. Your mission: summarize the last 24h in 45 seconds MAX.
Ton style : Ironique, vif, dynamique, un peu taquin mais bienveillant.
Tu DOIS citer les participants actifs.

Voici les logs du chat :
${transcript}

Génère un script PRÊT À ÊTRE PARLÉ (pas de balises, pas de titres).
Utilise de la ponctuation pour le rythme (... ! ?).
Si le chat est vide ou ennuyeux, moque-toi du silence.
`;

    // 4. Appel LLM (Gemini Flash est très bon pour ça et rapide)
    const providerRouter = container.get('providerRouter');
    const response = await providerRouter.chat([{ role: 'system', content: prompt }], {
      family: 'gemini',
      temperature: 0.7,
    });

    return response.content;
  },

  /**
   * Convertit le script en audio (TTS via Gemini Audio)
   * @param {string} script
   */
  async produceAudio(script: string) {
    try {
      const { createGeminiLiveProvider, HD_VOICES } =
        await import('../../../providers/geminiLive.js');
      const { readFileSync } = await import('fs');
      const { join } = await import('path');

      // Charger les credentials
      const credPath = join(process.cwd(), 'config', 'credentials.json');
      const credentials = JSON.parse(readFileSync(credPath, 'utf-8'));

      // Initialiser le provider
      // On choisit une voix "Radio Host" (ex: Zephyr ou Puck)
      const provider = createGeminiLiveProvider(credentials, {
        voice: HD_VOICES.PUCK, // Puck a un ton énergique/joueur parfait pour le Pulse
      });

      console.log('[DailyPulse] 🔊 Génération audio HD en cours...');

      // Générer l'audio
      const result = await provider.textToSpeech(script);

      if (result.filePath) {
        console.log(`[DailyPulse] ✅ Audio généré: ${result.filePath}`);
        return result.filePath;
      } else {
        throw new Error('Pas de fichier audio généré');
      }
    } catch (error: unknown) {
      console.error('[DailyPulse] ❌ Erreur Audio TTS:', extractErrorMessage(error));
      return null; // Fallback texte géré par l'appelant
    }
  },
};
