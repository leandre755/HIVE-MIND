import { workingMemory } from './workingMemory.js';
import { providerRouter } from '../providers/index.js';
import { tryParseJson } from '../utils/ResponseFormatEnforcer.js';

interface GroupPulseAnalysis {
  sentiment: string;
  conflict: boolean;
  unansweredQuestion: boolean;
  needsHelp: boolean;
  reason?: string;
  shouldIntervene: boolean;
  context?: Record<string, unknown>;
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return 'Unknown error';
}

export const socialCueWatcher = {
  async analyzeGroupPulse(chatId: string): Promise<GroupPulseAnalysis> {
    try {
      const context = await workingMemory.getContext(chatId);

      if (context.length < 5) {
        return {
          sentiment: 'neutral',
          conflict: false,
          unansweredQuestion: false,
          needsHelp: false,
          shouldIntervene: false,
        };
      }

      const conversationSnippet = context
        .slice(-15)
        .map((m) => m.content)
        .join('\n');

      const analysisPrompt = `Tu es un observateur social silencieux de HIVE-MIND.
Analyse cette conversation de groupe WhatsApp :

${conversationSnippet}

DÉTECTE:
1. Conflit ou tension (insultes, désaccord)
2. Question restée sans réponse claire
3. Quelqu'un qui demande de l'aide technique/conseil

<output_format>
Réponds en JSON strict :
{
  "conflict": true/false,
  "unansweredQuestion": true/false,
  "needsHelp": true/false,
  "sentiment": "positive"/"neutral"/"negative",
  "reason": "Explication courte"
}

Few-shot examples:
Example 1:
{
  "conflict": false,
  "unansweredQuestion": true,
  "needsHelp": false,
  "sentiment": "neutral",
  "reason": "The user asked about sticker creation tool availability but received no replies."
}

Example 2:
{
  "conflict": true,
  "unansweredQuestion": false,
  "needsHelp": false,
  "sentiment": "negative",
  "reason": "Users are arguing over python code formats with aggressive tone."
}
</output_format>`;

      const response = await providerRouter.chat(
        [
          {
            role: 'system',
            content: 'Tu es un analyseur de sentiment social de HIVE-MIND. Output JSON only.',
          },
          { role: 'user', content: analysisPrompt },
        ],
        {
          family: 'kimi',
          model: 'kimi-for-coding',
          temperature: 0.1,
        },
      );

      if (!response?.content) {
        return {
          sentiment: 'neutral',
          conflict: false,
          unansweredQuestion: false,
          needsHelp: false,
          shouldIntervene: false,
        };
      }

      let analysis: GroupPulseAnalysis;
      try {
        analysis = tryParseJson<GroupPulseAnalysis>(response.content);
      } catch {
        const firstBrace = response.content.indexOf('{');
        const lastBrace = response.content.lastIndexOf('}');
        if (firstBrace === -1 || lastBrace <= firstBrace) {
          return {
            sentiment: 'neutral',
            conflict: false,
            unansweredQuestion: false,
            needsHelp: false,
            shouldIntervene: false,
          };
        }
        analysis = tryParseJson<GroupPulseAnalysis>(
          response.content.slice(firstBrace, lastBrace + 1),
        );
      }

      analysis.shouldIntervene =
        analysis.conflict || analysis.unansweredQuestion || analysis.needsHelp;
      return analysis;
    } catch (error: unknown) {
      const errorMessage = extractErrorMessage(error);
      console.error('[SocialCueWatcher] Erreur analyzeGroupPulse:', errorMessage);
      return {
        sentiment: 'neutral',
        conflict: false,
        unansweredQuestion: false,
        needsHelp: false,
        shouldIntervene: false,
      };
    }
  },

  async scanGroup(chatId: string): Promise<GroupPulseAnalysis> {
    return this.analyzeGroupPulse(chatId);
  },

  shouldIntervene(analysis: GroupPulseAnalysis): boolean {
    if (analysis.conflict && analysis.sentiment === 'negative') {
      return true;
    }

    if (analysis.unansweredQuestion) {
      return true;
    }

    if (analysis.needsHelp) {
      return true;
    }

    return false;
  },

  async generateProactiveThought(
    chatId: string,
    analysis: GroupPulseAnalysis,
  ): Promise<string | null> {
    try {
      const context = await workingMemory.getContext(chatId);
      const recent = context
        .slice(-10)
        .map((m) => m.content)
        .join('\n');

      let instruction = '';
      if (analysis.conflict) {
        instruction = 'Calme la situation avec humour ou une remarque constructive. Sois bref.';
      } else if (analysis.unansweredQuestion) {
        instruction = 'Réponds à la question posée ou propose ton aide.';
      } else if (analysis.needsHelp) {
        instruction = 'Offre ton aide de manière proactive.';
      } else {
        return null;
      }

      const thoughtPrompt = `Conversation récente:
${recent}

CONTEXTE: ${analysis.reason}
MISSION: ${instruction}

Réponds comme si tu participais naturellement à la conversation (1-2 phrases max).`;

      const response = await providerRouter.chat(
        [
          { role: 'system', content: 'Tu es HIVE-MIND, un bot WhatsApp social et utile.' },
          { role: 'user', content: thoughtPrompt },
        ],
        {
          family: 'kimi',
          model: 'kimi-for-coding',
          temperature: 0.8,
        },
      );

      return response.content;
    } catch (error: unknown) {
      const errorMessage = extractErrorMessage(error);
      console.error('[SocialCueWatcher] Erreur generateProactiveThought:', errorMessage);
      return null;
    }
  },
};

export default socialCueWatcher;
