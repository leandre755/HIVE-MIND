# Execution Plan: Unified Context Regulation Architecture (HIVE-MIND)

## 📋 Target Invariant & Pre-requisites

- **Target Invariant**: Single Source of Truth for context regulation based exclusively on LLM tokens, replacing fragmented character/byte limits with a deterministic, graduated emergency pipeline.
- **Pre-requisites**:
  - Full critical audit report (`AUDIT_CRITIQUE_INCOHERENCE.md`) - COMPLETED & VALIDATED
  - Target architecture specification & TypeScript interfaces (`UNIFIED_CONTEXT_MANAGER_SPEC.md`) - COMPLETED & VALIDATED

## 🛠️ Step-by-Step Sequence

### Step 1: Milestone 1 — Audit critique d'incohérence & Red-Teaming (R1)
- [x] **Action**: Survey 5 context regulation mechanisms (`ContextWindowService`, `ContextManager`, `_optimizeHistory`, `TieredContextLoader`, `_getLiveAudioTools`).
- [x] **Action**: Generate comprehensive audit report (`AUDIT_CRITIQUE_INCOHERENCE.md`) with code proofs, metric contradictions, and vulnerabilities.
- [x] **Verify**: Gate check (Reviewer 1 & 2 APPROVE, Auditor CLEAN).

### Step 2: Milestone 2 — Spécification d'architecture cible (R2)
- [x] **Action**: Generate target specification document (`UNIFIED_CONTEXT_MANAGER_SPEC.md`) containing TypeScript contracts, state machine lifecycle, token strategy, deterministic emergency pipeline, and layer separation diagram.
- [x] **Verify**: Gate check (Reviewer 1 & 2 APPROVE, Auditor CLEAN).

## ⚠️ Mitigations & Edge Cases

- **Risk**: Groq LLM window overflow when compacting large model history (e.g., 1M token Gemini Flash).
- **Mitigation**: Capacity check ($T_{input\_history} \le 0.75 \times C_{summary\_model}$), sliding window chunking by 60k tokens, and deterministic non-LLM fallback.
- **Risk**: Truncation of critical system prompt sections in Live Audio mode.
- **Mitigation**: Structural priority preservation protecting Security Authority, Blueprint, and Scratchpad blocks 100%.
