# Tiered Context Loader & Prompt Engineering (SS-22) — Explanation

## Overview & Purpose

The **Tiered Context Loader (SS-22)** is HIVE-MIND's deterministic prompt engineering and memory assembly engine (`src/core/context/TieredContextLoader.ts` and `src/services/runtime/ContextWindowService.ts`). 

LLM performance degrades significantly when the context window is overfilled with redundant history or unranked memories. SS-22 structures the prompt into **5 heated context strata**, assembling the optimal working context in under 50ms from Redis L1 and Supabase L2.

```
┌─────────────────────────────────────────────────────────────┐
│ Strata 1: System Invariants & Persona Blueprint (Frozen)    │
├─────────────────────────────────────────────────────────────┤
│ Strata 2: User Passport & Behavioral Constraints (Warm L1)  │
├─────────────────────────────────────────────────────────────┤
│ Strata 3: Semantic Memories (Ebbinghaus Decay Filtered)     │
├─────────────────────────────────────────────────────────────┤
│ Strata 4: Scratchpad Working State & Ephemeral Notes        │
├─────────────────────────────────────────────────────────────┤
│ Strata 5: Sliding Recent Turn Window (Compact History)      │
└─────────────────────────────────────────────────────────────┘
```

## The 5 Heated Context Strata

1. **Strata 1 — System Core & Persona**: Includes the immutable safety boundaries, operational rules, tool execution contracts, and current persona definition.
2. **Strata 2 — User Passport**: Loaded from Redis L1 (`UserPassport`). Contains verified user authority level, language preferences, and accumulated interaction rules.
3. **Strata 3 — Semantic Memory**: Vector retrieved via Supabase pgvector and filtered by the continuous exponential forgetting score:
   $$\text{Score} = 0.4 \cdot e^{-t/\tau} + 0.3 \cdot \min\left(\frac{\text{freq}}{10}, 1\right) + 0.3 \cdot \text{importance}$$
4. **Strata 4 — Scratchpad State**: The agent's private scratchpad for the current thread (`WorkingMemory`). Allows tracking multi-step reasoning without polluting the conversation transcript.
5. **Strata 5 — Sliding Conversation Window**: Recent user and assistant turns. When total prompt size nears model token limits (monitored by `ContextWindowService`), `_optimizeHistory` mechanically truncates oversized tool outputs (>2000 chars) while preserving the first two and last two turns.

## Related Documentation
- [Tiered Context Loader Reference](./tiered-context-loader-reference.md)
- [How-To: Context Window Management](./tiered-context-loader-howto.md)
- [Multi-Tier Memory Explanation](../memory/hybrid-memory-explanation.md)
