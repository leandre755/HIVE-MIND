# Tiered Context Loader & ContextWindowService (SS-22) — Technical Reference

## Classes & API Specifications

### `TieredContextLoader`

Located in `src/core/context/TieredContextLoader.ts`.

```typescript
export class TieredContextLoader {
  loadContext(params: LoadContextParams): Promise<AssembledContext>;
  estimateTokens(payload: unknown): number;
}

export interface LoadContextParams {
  chatId: string;
  senderName: string;
  isGroup: boolean;
  activeModel: string;
  history: MessageTurn[];
  blueprint?: AgentBlueprint;
}

export interface AssembledContext {
  systemPrompt: string;
  turns: MessageTurn[];
  estimatedTotalTokens: number;
  strataBreakdown: {
    strata1Tokens: number;
    strata2Tokens: number;
    strata3Tokens: number;
    strata4Tokens: number;
    strata5Tokens: number;
  };
}
```

### `ContextWindowService`

Located in `src/services/runtime/ContextWindowService.ts`. Manages token limits per model and garbage collection triggers.

```typescript
export class ContextWindowService {
  getLimit(model?: string): number;
  setActiveModel(model: string): void;
  getActiveModel(): string;
  estimateTokens(content: unknown): number;
  updateConsumption(chatId: string, tokens: number): void;
  getUsage(chatId: string, history?: unknown[]): ContextUsage;
  isThresholdReached(chatId: string, history: unknown[]): boolean;
}

export interface ContextUsage {
  consumed: number;
  limit: number;
  percentage: number;
  model: string;
}
```

### Model Token Limits (Hardcoded & Dynamic)

| Model Name | Default Window Limit (Tokens) | GC Trigger Threshold (80%) |
| :--- | :--- | :--- |
| `gemini-3.5-flash` | 1,048,576 | 838,860 |
| `gemini-3.1-pro-preview` | 2,097,152 | 1,677,721 |
| `kimi-for-coding` | 262,144 | 209,715 |
| `codestral-latest` | 32,768 | 26,214 |
| *Unknown Fallback* | 131,072 | 104,857 |
