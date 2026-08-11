# Project: HIVE-MIND Unified Context Regulation Architecture

## Architecture
- Legacy context handling: Fragmented across 5 uncoordinated mechanisms (`ContextWindowService`, `ContextManager` Groq GC, `_optimizeHistory` 25k char truncator, `TieredContextLoader`, `_getLiveAudioTools`).
- Target architecture: `Unified Context Manager` (Single Source of Truth) with token-based budgeting, deterministic emergency slicing pipeline, immutable context snapshots, and strict layer separation.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | R1.1 Audit ContextWindowService vs _optimizeHistory | Proof of 134x metric discrepancy (Tokens vs 25k Chars) | M1 | Survey |
| 2 | R1.2 Audit Groq LLM Window Overflow in GC | Proof of 800k token history sent to 131k Groq LLM window | M1 | Survey |
| 3 | R1.3 Audit Audio Truncation & Silent Tool Popping | Proof of 85% SystemPrompt destruction and .pop() tool eviction in GeminiLiveProvider | M1 | Survey |
| 4 | R1.4 Audit Race Conditions & In-Place Mutations | Proof of array clears and shared reference mutation in BotCore | M1 | Survey |
| 5 | R1.5 Audit Static Query RAG in _getLiveAudioTools | Proof of dummy search query in vocal mode | M1 | Survey |
| 6 | R2.1 Unified Token Strategy & Budgeting | Single Source of Truth token accounting per model window | M2 | Target Spec |
| 7 | R2.2 Deterministic Emergency Slicing Pipeline | Graduated emergency pipeline (Soft Trim -> Summarize -> Hard Prune) | M2 | Target Spec |
| 8 | R2.3 TypeScript Interface Contracts | Clean TypeScript interfaces for Unified Context Regulation | M2 | Target Spec |
| 9 | R2.4 Architecture Diagram & Flow Chart | Data flow and layer separation diagrams | M2 | Target Spec |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | M1: Audit critique d'incohérence & Red-Teaming | Full audit report with file/signature/line code proofs | Survey | DONE |
| 2 | M2: Spécification d'architecture cible | Target spec with TS interfaces, lifecycle, token strategy & pipeline | M1 | DONE |

## Interface Contracts
### UnifiedContextManager ↔ BotCore / ServiceContainer
- `getUsage(chatId: string, model: string): ContextBudgetUsage`
- `regulateContext(chatId: string, history: Message[], options: RegulationOptions): Promise<RegulatedContextResult>`
- `getLiveAudioSetup(chatId: string, userIntent?: string): Promise<LiveAudioSetupConfig>`

## Code Layout
- Work artifacts: `.agents/orchestrator_r1/`
  - `AUDIT_CRITIQUE_INCOHERENCE.md`
  - `UNIFIED_CONTEXT_MANAGER_SPEC.md`
  - `progress.md`
  - `BRIEFING.md`
