// services/agentic/ActionEvaluator.ts
// ============================================================================
// POST-ACTION EVALUATOR - Système d'évaluation et apprentissage continu
// ============================================================================
// Évalue chaque action exécutée et crée une boucle de feedback
// pour améliorer la sélection des outils et l'efficacité globale

import { supabase } from '../supabase.js';
import { providerRouter } from '../../providers/index.js';

interface ActionInput {
  id: string;
  tool: string;
  params: Record<string, unknown>;
  result: unknown;
  error: string | null;
  duration_ms: number;
  chatId: string;
  timestamp: string;
  retries?: number;
}

interface ObjectiveMetrics {
  success: boolean;
  execution_time: number;
  result_quality: number;
}

type FeedbackType = 'positive' | 'negative' | 'neutral' | null;

interface EvaluationResult {
  score: number;
  components: ObjectiveMetrics;
  feedback: FeedbackType;
  lesson: string | null;
}

interface ToolPerformanceRow {
  tool: string;
  avg_score: number;
  total_uses: number;
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return String(error);
}

/**
 * Évaluateur post-action pour l'amélioration continue
 */
export class ActionEvaluator {
  feedbackWindow: number;

  constructor() {
    this.feedbackWindow = 10000; // 10s pour détecter feedback user
  }

  async evaluate(action: ActionInput): Promise<EvaluationResult | null> {
    console.log(`[ActionEvaluator] 📊 Évaluation: ${action.tool}`);

    try {
      const objective: ObjectiveMetrics = {
        success: !action.error,
        execution_time: action.duration_ms || 0,
        result_quality: await this._assessResult(action),
      };

      const userFeedback = await this._detectFeedback(action.chatId, action.timestamp);

      const finalScore = this._computeScore(objective, userFeedback);

      const lesson = await this._extractLesson(action, finalScore);

      if (supabase) {
        const { error } = await supabase
          .from('action_scores')
          .insert({
            action_id: action.id,
            tool: action.tool,
            success: objective.success,
            execution_time_ms: objective.execution_time,
            result_quality: objective.result_quality,
            user_feedback: userFeedback,
            final_score: finalScore,
            learned: lesson,
          })
          .select()
          .single();

        if (error) throw error;
      }

      console.log(
        `[ActionEvaluator] ✅ Score: ${finalScore.toFixed(2)} (success=${objective.success}, feedback=${userFeedback || 'none'})`,
      );

      return {
        score: finalScore,
        components: objective,
        feedback: userFeedback,
        lesson,
      };
    } catch (error: unknown) {
      console.error('[ActionEvaluator] Erreur evaluation:', extractErrorMessage(error));
      return null;
    }
  }

  async _assessResult(action: ActionInput): Promise<number> {
    if (action.error) return 0;
    if (!action.result) return 0.5;

    try {
      const prompt = `<role>
You are the Quality Evaluator for HIVE-MIND tool executions.
Your scores directly influence tool selection optimization. Accurate scoring improves future performance.
</role>

<context>
This evaluation helps HIVE-MIND learn which tools perform well.
Low scores flag under-performing tools; high scores reinforce successful ones.
</context>

<tool_execution>
Tool: ${action.tool}
Input: ${JSON.stringify(action.params).substring(0, 200)}
Output: ${JSON.stringify(action.result).substring(0, 500)}
</tool_execution>

<evaluation_criteria>
Score from 0.0 to 1.0 based on weighted criteria:
1. Relevance to input (40% weight): Does output match what input requested?
2. Completeness (30% weight): Are all required elements present?
3. Correctness (30% weight): Is the output error-free and accurate?

Calibration examples:
- 0.0-0.2: Failed execution, wrong/irrelevant result
- 0.3-0.5: Partial success, missing key elements
- 0.6-0.7: Good result with minor issues
- 0.8-0.9: Very good, nearly complete and accurate
- 0.95-1.0: Excellent, perfect execution
</evaluation_criteria>

<output_format>
Respond with ONLY a decimal number between 0.0 and 1.0 (e.g., 0.75).
No explanation, no text, just the score.

Few-shot examples:
- Score: 0.85
- Score: 0.30
</output_format>

Score:`;

      const response = await providerRouter.callServiceRecipe('ACTION_EVALUATOR', [
        {
          role: 'system',
          content:
            'Tu es un évaluateur de qualité objectif. Tu réponds uniquement par un chiffre décimal.',
        },
        { role: 'user', content: prompt },
      ]);

      let score = 0.5;
      if (response?.content) {
        const text = String(response.content).trim();
        const floatText = text.replace(/[^0-9.]/g, '');
        const parsed = parseFloat(floatText);
        if (!isNaN(parsed)) score = parsed;
      }

      if (action.retries && action.retries > 0) {
        console.log(
          `[ActionEvaluator] 📉 Pénalité de retry appliquée (-0.2) pour ${action.retries} auto-corrections.`,
        );
        score -= 0.2;
      }

      return Math.max(0, Math.min(1, score));
    } catch (error: unknown) {
      console.warn('[ActionEvaluator] Erreur évaluation IA:', extractErrorMessage(error));
      const fallbackScore = action.result ? 0.7 : 0.3;
      const penalty = action.retries && action.retries > 0 ? -0.2 : 0;
      return Math.max(0, Math.min(1, fallbackScore + penalty));
    }
  }

  async _detectFeedback(
    chatId: string,
    actionTimestamp: string,
  ): Promise<'positive' | 'negative' | 'neutral' | null> {
    try {
      await new Promise((resolve) => setTimeout(resolve, this.feedbackWindow));

      if (!supabase) return null;

      const { data: messages } = await supabase
        .from('memories')
        .select('content, created_at')
        .eq('chat_id', chatId)
        .eq('role', 'user')
        .gte('created_at', new Date(actionTimestamp).toISOString())
        .order('created_at', { ascending: true })
        .limit(3);

      if (!messages || messages.length === 0) return null;

      const reactions = messages.map((m: { content: string }) => m.content.toLowerCase());
      const text = reactions.join(' ');

      if (/(merci|super|génial|parfait|top|excellent|bravo|👍|❤️|✅)/.test(text)) {
        return 'positive';
      }

      if (/(nul|mauvais|erreur|faux|wtf|merde|non|stop|annule|❌|👎)/.test(text)) {
        return 'negative';
      }

      return 'neutral';
    } catch (error: unknown) {
      console.warn('[ActionEvaluator] Erreur détection feedback:', extractErrorMessage(error));
      return null;
    }
  }

  _computeScore(
    objective: ObjectiveMetrics,
    userFeedback: 'positive' | 'negative' | 'neutral' | null,
  ): number {
    let score = 0;

    score += objective.success ? 0.3 : 0;
    score += objective.result_quality * 0.4;

    if (userFeedback === 'positive') score += 0.3;
    else if (userFeedback === 'negative') score += 0;
    else score += 0.15;

    return Math.max(0, Math.min(1, score));
  }

  async _extractLesson(action: ActionInput, score: number): Promise<string | null> {
    if (score > 0.4 && score < 0.9) return null;

    if (score >= 0.9) {
      return `✅ ${action.tool} very effective for: ${JSON.stringify(action.params).substring(0, 100)}`;
    } else {
      return `❌ ${action.tool} failed: ${action.error || 'low quality result'}. Params: ${JSON.stringify(action.params).substring(0, 100)}`;
    }
  }

  async updateToolSelection(): Promise<void> {
    console.log('[ActionEvaluator] 🔄 Mise à jour priorités outils...');

    try {
      if (!supabase) return;

      const { data: stats } = await supabase
        .from('tool_performance')
        .select('*')
        .order('avg_score', { ascending: false });

      if (!stats) return;

      const underperformers = (stats as ToolPerformanceRow[]).filter((s) => s.avg_score < 0.5);

      for (const tool of underperformers) {
        console.warn(
          `[ActionEvaluator] ⚠️ Tool ${tool.tool} sous-performant (score=${tool.avg_score.toFixed(2)}, uses=${tool.total_uses})`,
        );
      }

      console.log(
        `[ActionEvaluator] ✅ Top tools: ${stats
          .slice(0, 5)
          .map((s: ToolPerformanceRow) => `${s.tool} (${s.avg_score.toFixed(2)})`)
          .join(', ')}`,
      );
    } catch (error: unknown) {
      console.error('[ActionEvaluator] Erreur updateToolSelection:', extractErrorMessage(error));
    }
  }

  async recordQuickSuccess(tool: string, actionId: string): Promise<void> {
    try {
      if (!supabase) return;

      await supabase.from('action_scores').insert({
        action_id: actionId,
        tool,
        success: true,
        execution_time_ms: 0,
        result_quality: 0.8,
        final_score: 0.8,
      });
    } catch (error: unknown) {
      console.warn('[ActionEvaluator] Erreur recordQuickSuccess:', extractErrorMessage(error));
    }
  }

  async getStats(): Promise<ToolPerformanceRow[]> {
    if (!supabase) return [];

    const { data } = await supabase
      .from('tool_performance')
      .select('*')
      .order('avg_score', { ascending: false });

    return (data ?? []) as ToolPerformanceRow[];
  }
}

// Export singleton
export const actionEvaluator = new ActionEvaluator();
export default actionEvaluator;
