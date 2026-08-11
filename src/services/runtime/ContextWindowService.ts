// services/runtime/ContextWindowService.ts
// ============================================================================
// HIVE-MIND Context Window Service
// Tracks LLM active model context limits, usage, and triggers IA Garbage Collector.
// ============================================================================

export const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  // Gemini
  'gemini-3.5-flash': 1048576,
  'gemini-3.1-pro-preview': 2097152,
  'gemini-3-pro-preview': 2097152,
  'gemini-3-flash-preview': 1048576,
  'gemini-2.5-flash': 1048576,
  'gemini-2.5-flash-lite': 1048576,
  'gemini-3.1-flash-lite-preview': 1048576,
  'gemini-3.1-flash-live-preview': 1048576,
  'gemma-4-31b-it': 131072,

  // OpenAI
  'gpt-5.2': 131072,
  'gpt-5-mini': 131072,

  // Mistral
  'mistral-large-latest': 131072,
  'codestral-latest': 32768,
  'mistral-small-latest': 32768,
  'open-mistral-nemo': 131072,

  // Kimi
  'kimi-for-coding': 262144,

  // Groq
  'llama-3.3-70b-versatile': 131072,
  'llama-3.1-8b-instant': 131072,
};

export interface ContextUsageInfo {
  limit: number;
  consumed: number;
  percentage: number;
  model: string;
}

export class ContextWindowService {
  private lastActiveModel: string = 'gemini-3.5-flash';
  private consumptionByChat: Map<string, number> = new Map();

  /**
   * Get the token limit for a specific model.
   */
  public getLimit(modelName?: string): number {
    const name = modelName || this.lastActiveModel;
    if (Object.hasOwn(MODEL_CONTEXT_LIMITS, name)) {
      const val = Reflect.get(MODEL_CONTEXT_LIMITS, name);
      if (typeof val === 'number') return val;
    }
    return 131072; // Default to 128k
  }

  /**
   * Set the last active model name.
   */
  public setActiveModel(modelName: string): void {
    if (modelName) {
      this.lastActiveModel = modelName;
    }
  }

  /**
   * Get the last active model name.
   */
  public getActiveModel(): string {
    return this.lastActiveModel;
  }

  /**
   * Estimate token count of an history array or string content.
   */
  public estimateTokens(content: unknown): number {
    if (!content) return 0;
    const str = typeof content === 'string' ? content : JSON.stringify(content);
    // Standard rule of thumb: 1 token ≈ 4 characters
    return Math.ceil(str.length / 4);
  }

  /**
   * Track and update token consumption for a chatId.
   */
  public updateConsumption(chatId: string, tokens: number): void {
    this.consumptionByChat.set(chatId, tokens);
  }

  /**
   * Get the current context usage details for a chatId.
   */
  public getUsage(chatId: string, currentHistory?: unknown[]): ContextUsageInfo {
    const model = this.lastActiveModel;
    const limit = this.getLimit(model);

    let consumed = this.consumptionByChat.get(chatId) || 0;
    if (currentHistory && currentHistory.length > 0) {
      consumed = this.estimateTokens(currentHistory);
      this.consumptionByChat.set(chatId, consumed);
    }

    const percentage = limit > 0 ? consumed / limit : 0;

    return {
      limit,
      consumed,
      percentage,
      model,
    };
  }

  /**
   * Checks if the context usage threshold has been reached (80%).
   */
  public isThresholdReached(chatId: string, currentHistory: unknown[]): boolean {
    const usage = this.getUsage(chatId, currentHistory);
    return usage.percentage >= 0.8;
  }
}
