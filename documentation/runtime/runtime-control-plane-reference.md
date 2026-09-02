# AI Runtime Control Plane (SS-21) — Technical Reference

## Class & Interfaces

The runtime control plane is primarily located in `src/services/runtime/RuntimeInfrastructure.ts` and `src/services/runtime/ConstraintManifold.ts`.

### `RuntimeSentinel`

The primary gatekeeper for tool execution.

```typescript
export class RuntimeSentinel {
  projectActionSpace(allTools: ToolDef[], blueprint?: AgentBlueprint): ToolDef[];
  
  evaluate(
    toolCall: ToolCallDef,
    context: SentinelContext,
    recentActions: RecentAction[],
    blueprint?: AgentBlueprint
  ): Promise<SentinelEvaluationResult>;
}
```

### Type Definitions

```typescript
export interface SentinelContext {
  senderName: string;
  authorityLevel: 'User' | 'Admin' | 'Global Admin' | 'SuperUser';
  isGroup: boolean;
  chatId: string;
}

export interface SentinelEvaluationResult {
  allowed: boolean;
  risk_level: 'low' | 'medium' | 'high' | 'critical';
  reason: string | null;
  intervention_prompt: string | null;
}

export interface RecentAction {
  tool_name?: string;
  tool?: string;
  result_summary?: string;
  error_message?: string;
  success: boolean;
}
```

### Critical Actions (`CRITICAL_ACTIONS`)

The following actions trigger mandatory fail-closed behavior when safety inference is disrupted:
- `gm_ban_user`
- `gm_remove_user`
- `gm_delete_message`
- `gm_demote_admin`
- `delete_group_data`

### Safe Actions (`SAFE_TOOLS`)

Whitelisted read-only tools that execute with zero safety inference overhead:
- `read_file`
- `list_directory`
- `read_file_range`
- `ast_grep`
- `google_ai_search`
- `update_scratchpad`

### `RuntimeInfrastructure` Cost & Budget Tracking

```typescript
export class RuntimeInfrastructure {
  recordUsage(model: string, inputTokens: number, outputTokens: number): UsageRecord;
  getLagrangeMultiplier(currentCost: number, maxBudget: number): number;
  isBudgetExceeded(sessionId: string): boolean;
}
```

## Error Codes & Events

| Event | Direction | Description |
| :--- | :--- | :--- |
| `BotEvents.SERVICE_START` | Emitted | Fired when VIGIL begins evaluating a tool call (`service: 'VIGIL'`). |
| `BotEvents.SERVICE_END` | Emitted | Fired when VIGIL evaluation terminates. |
| `BotEvents.SYSTEM_ERROR` | Emitted | Fired with `type: 'BUDGET_EXCEEDED'` when session budget limit is breached. |
