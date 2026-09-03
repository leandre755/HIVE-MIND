# HIVE-MIND — Architecture Blueprint

Detailed technical reference for the **HIVE-MIND** repository. Lean operational rules live in [`AGENTS.md`](AGENTS.md).

---

## 1. Layered Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           TRANSPORT LAYER                               │
│  WhatsApp (Baileys) · Discord · Telegram · CLI · TUI Server (WebSocket) │
│  Interface: TransportInterface  ·  Orchestrator: TransportManager       │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │ NormalizedMessage + sourceChannel
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          ORCHESTRATION CORE                             │
│  BotCore (ReAct loop, max 10 steps)  ·  ServiceContainer (IoC)          │
│  FairnessQueue (Round-Robin)         ·  BlueprintManager (Profiles)     │
│  Planner (Multi-step decomposition)  ·  Programmatic Tool Calling (PTC) │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │ Tool execution & LLM inference
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                       RUNTIME INFRASTRUCTURE                            │
│  Sentinel / VIGIL (Action validation)  ·  Ralph (Anti-slop / loop audit)│
│  ConstraintManifold (System invariants)·  ContextWindowService          │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │ Validated execution paths
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    COGNITIVE & PERSISTENCE LAYER                        │
│  Redis L1: WorkingMemory, UserPassport, Scratchpad, Actions History     │
│  Supabase L2: PostgreSQL + pgvector (Semantic Memory, match_tools RAG)  │
│  Learning Engine: MAPLE / Lessons Learned                               │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │ AI model inference
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      TWO-LAYER SMART ROUTER                             │
│  Layer 1 (SmartLayer): ServiceRegistry, Key Rotation, Tier Balancing    │
│  Layer 0 (ExecutionLayer): ModelRegistry, Protocol Families, Adapters   │
│  Adapters: Gemini, Claude, OpenAI, Groq, Codex, Cohere, Cloudflare, HF │
└─────────────────────────────────────────────────────────────────────────┘
```

---

---

## 2. Catalog of Autonomous Subsystems (SS-01 to SS-26)

The HIVE-MIND codebase has been audited and decoupled into **26 autonomous, extractable subsystems**, documented across the Diátaxis architecture corpus in [`documentation/00_index.md`](documentation/00_index.md). Each subsystem is modular, testable in isolation, and ready for standalone re-implementation (in Rust, Go, Python, or TypeScript).

### Domain 1: Core Orchestration & Concurrency

| ID | Subsystem | Key Files | Responsibility & Boundary |
| :--- | :--- | :--- | :--- |
| **SS-01** | `ServiceContainer` | `src/core/ServiceContainer.ts` | Inversion of Control (IoC) container using typed `ServiceIdentifier<T>`. Zero external dependencies ($C_e = 0, I = 0.00$). Manages singleton resolution and decoupling across all services. |
| **SS-02** | `FairnessQueue` | `src/core/FairnessQueue.ts` | Deficit Round-Robin (DRR) multi-tenant scheduling queue. Prevents starvation across concurrent user channels with priority VIP sub-queues. Zero dependencies ($C_e = 0, I = 0.00$). |
| **SS-03** | `SwarmDispatcher` | `src/core/concurrency/SwarmDispatcher.ts` | Hardware-adaptive concurrency governor. Regulates active task concurrency dynamically based on host CPU load and available memory (`node:os`). |
| **SS-04** | `BlueprintManager` | `src/core/blueprint/AgentBlueprint.ts`, `BlueprintManager.ts` | Declarative agent topology registry validated via Zod schemas. Manages step sequence definitions, personality masks, and tool allowlists. |
| **SS-05** | `EventBus` | `src/core/eventBus.ts` | Strongly-typed, decoupled asynchronous Pub/Sub signal bus (`node:events`). Mediates communication between transports, BotCore, and monitoring services. |
| **SS-06** | `ExplicitPlanner` | `src/services/agentic/Planner.ts` | Directed Acyclic Graph (DAG) task decomposition engine. Generates multi-step execution plans with explicit verification criteria and JSON repair validation. |
| **SS-07** | `SubAgentEngine` | `src/services/agentic/SubAgentEngine.ts` | Hierarchical multi-agent swarm orchestrator supporting `fork` (shared context) and `fresh` (isolated mission) sub-agent instantiations with dedicated iteration limits. |
| **SS-08** | `PTC VM Engine` | `src/services/ptc/ProgrammaticExecutor.ts`, `SafeScriptValidator.ts`, `ToolBridge.ts` | Programmatic Tool Calling (PTC) execution engine. Executes multi-tool scripts within a sandboxed Node.js `vm` context with AST static validation (Acorn) and strict timeout guards. |
| **SS-09** | `PermissionManager` | `src/core/security/PermissionManager.ts` | Human-In-The-Loop (HITL) security broker. Enforces a 3-tier action validation policy (`allow`, `ask`, `deny`) with interactive transport approval callbacks. |

### Domain 2: Model Intelligence & Smart Routing

| ID | Subsystem | Key Files | Responsibility & Boundary |
| :--- | :--- | :--- | :--- |
| **SS-10** | `Layer 0 Execution` | `src/providers/layer0/ExecutionLayer.ts`, `ModelRegistry.ts`, `protocols/` | Protocol-family execution engine. Translates pivot requests into wire-level HTTP calls across OpenAI, Anthropic, Gemini, Groq, Cohere, Cloudflare, and HuggingFace. |
| **SS-11** | `ParamConverter` | `src/providers/families/protocols/messageConverter.ts`, `GenerationParams.ts` | Universal bidirectional pivot $\leftrightarrow$ wire message normalizer. Handles prompt caching, multimodal media payloads, and tool invocation format adaptation. |
| **SS-12** | `Layer 1 SmartLayer`| `src/providers/layer1/SmartLayer.ts`, `ServiceRegistry.ts`, `ModelHealthRegistry.ts` | Dynamic multi-tier LLM router with sliding-window circuit breakers, fair quota rotation across provider API keys, and FinOps Lagrange cost regulation. |
| **SS-13** | `OAuth Adapters` | `src/providers/adapters/codex.ts`, `geminiCli.ts` | Headless CLI OAuth and token lifecycle adapters. Manages personal account token exchanges and PKCE authentication renewal. |
| **SS-14** | `Voice Subsystem` | `src/services/voice/`, `src/services/audio/geminiLiveProvider.ts`, `groqSTT.ts` | Audio processing pipeline providing bidirectional streaming audio (Gemini Live WebSocket), Whisper STT, and MiniMax / Google TTS synthesis. |

### Domain 3: Gateways, IPC & Transports

| ID | Subsystem | Key Files | Responsibility & Boundary |
| :--- | :--- | :--- | :--- |
| **SS-15** | `Universal Transport`| `src/core/transport/` (`baileys.ts`, `discord.ts`, `telegram.ts`, `cli.ts`) | Unified communication abstraction (`TransportInterface`). Normalizes ingress/egress messages across WhatsApp, Discord, Telegram, and CLI. |
| **SS-16** | `TuiServer IPC` | `src/core/transport/tui/HiveTransport.ts` | Loopback WebSocket IPC server for the standalone headless terminal UI. Negotiates local auth tokens (`tui-connection.json`) and streams live agent telemetry. |
| **SS-17** | `CLI Auth Wizard` | `src/cli/startupMenu.ts`, `whatsappAuthHelper.ts`, `authSessionManager.ts` | Interactive terminal UX for runtime configuration, credentials validation (network ping on tokens), and Baileys QR / pairing code handshakes. |

### Domain 4: Memory & Cognition

| ID | Subsystem | Key Files | Responsibility & Boundary |
| :--- | :--- | :--- | :--- |
| **SS-18** | `Multi-Tier Memory` | `src/services/workingMemory.ts`, `src/services/memory/SemanticMemory.ts` | Hybrid memory architecture: L1 ephemeral RAM working memory (Redis) paired with L2 persistent semantic memory (PostgreSQL / Supabase pgvector with RAG search). |
| **SS-19** | `MAPLE & Reflection`| `src/services/learning/LearningEngine.ts`, `dreamService.ts` | Continuous episodic learning engine. Analyzes failure trajectories, consolidates lessons learned, and extracts negative-constraint behavioral rules. |
| **SS-20** | `Local Multimodal DB`| `src/services/media/MediaIndexer.ts`, `src/services/media/MediaSearch.ts` | Offline multimodal embedding search and indexing utilizing local HNSW graphs and image hash signatures. |

### Domain 5: Runtime Safety & Developer Tools

| ID | Subsystem | Key Files | Responsibility & Boundary |
| :--- | :--- | :--- | :--- |
| **SS-21** | `AI Runtime Control`| `src/services/runtime/RuntimeInfrastructure.ts`, `ConstraintManifold.ts` | Closed-loop execution governor: VIGIL (pre-action invariant sentinel), Ralph (post-action anti-slop / loop auditor), and Lagrange cost multipliers ($\lambda$). |
| **SS-22** | `Tiered Context Loader`| `src/core/context/tieredContextLoader.ts`, `ContextWindowService.ts` | Dynamic prompt regulator. Assembles system instructions, persona masks, and memory layers with token budgeting and selective Ebbinghaus decay. |
| **SS-23** | `Hash-Anchored Edit`| `src/services/anchor/AnchorStateManager.ts`, `lineHashing.ts`, `hashDictionary.ts`| Deterministic code modification engine using FNV-1a uint32 line hashes and Myers diff reconciliation, eliminating line-number drift during AI edits. |
| **SS-24** | `AST Intelligence` | `src/services/ast/TreeSitterService.ts`, `src/plugins/tools/LSPTool.ts` | Structural code parser utilizing WebAssembly Tree-Sitter grammars. Extracts syntax skeletons and resolves symbols while reducing token consumption by ~90%. |
| **SS-25** | `Plugin Pipeline` | `src/plugins/`, `src/utils/toolExecution.ts`, `src/utils/toolValidator.ts` | Dynamic tool plugin manager with Zod manifest validation, runtime argument sanitization, error classification, and retry loops. |
| **SS-26** | `Hardening & SafeFs` | `src/utils/safeFs.ts`, `src/utils/pidLock.ts`, `src/utils/TlsImpersonator.ts` | Hermetic security utilities: directory traversal prevention (`resolveWithinRoot`), atomic PID locking, TLS impersonation, and process shutdown cleanup. |

---

## 3. Cross-Cutting Architectural Patterns

1. **Pattern 1: Inversion of Control & Declarative Registries**  
   Utilized in `ServiceContainer` (SS-01), `ProtocolFamilies` (SS-10), and `BlueprintManager` (SS-04). Replaces hardcoded dependencies with typed runtime tokens and declarative registries.
2. **Pattern 2: Hierarchical Caching & Ebbinghaus Selective Decay**  
   Implemented in `Multi-Tier Memory` (SS-18) and `Tiered Context Loader` (SS-22). Combines sub-50ms L1 Redis access with L2 pgvector persistence and continuous exponential forgetting:
   $$\text{Score} = 0.4 \cdot e^{-t/\tau} + 0.3 \cdot \min\left(\frac{\text{freq}}{10}, 1\right) + 0.3 \cdot \text{importance}$$
3. **Pattern 3: Sandboxed VM & Multi-Tier Execution Boundary**  
   Applied in `PTC VM Engine` (SS-08) and `PermissionManager` (SS-09). Executes complex multi-tool sequences inside an isolated Node `vm` context with Acorn AST validation, slashing token costs by 80%–95%.
4. **Pattern 4: Closed-Loop Runtime Observability & FinOps Governance**  
   Deployed in `AI Runtime Control` (SS-21) and `Layer 1 SmartLayer` (SS-12). Couples VIGIL pre-action safety, Ralph anti-slop verification, Lagrange budget regulation ($\lambda = (\text{cost}/\text{budget})^4$), and sliding-window circuit breakers.
5. **Pattern 5: Deterministic Line-Anchored Reconciliation**  
   Implemented in `Hash-Anchored Edit` (SS-23). Uses FNV-1a uint32 hashing per line to guarantee fault-tolerant, drift-free code patch applications.

---

## 4. Technical Stack & Invariants

- **Runtime & Language**: Node.js >= 22.0.0 (native ESM), TypeScript strict.
- **Core Dependencies**: `@whiskeysockets/baileys` (WhatsApp), `@supabase/supabase-js` (PostgreSQL/Vector), `redis` (L1 WorkingMemory), `@google/genai`, `@anthropic-ai/sdk`, `openai`, `groq-sdk`, `zod`, `pino` (Logging).
- **Filesystem Policy**: All filesystem operations MUST use safe wrappers from `src/utils/safeFs.ts` (`safeReadFileSync`, `safeWriteFileSync`, `safeExistsSync`, `safeMkdirSync`, `safeUnlink`, `safeReaddir`, `safeAppendFile`). Raw `node:fs` calls are banned.
- **Hardware Constraints**: Host operates on 2 CPU cores and limited RAM (~3GB available for active tasks). Validation commands and sub-agents execute sequentially.

---

## 5. Directory Map

- `src/bin/`: CLI and daemon entry points (`hive-mind.ts`).
- `src/cli/`: Interactive startup menu, pairing flow, and auth helpers (`startupMenu.ts`, `whatsappAuthHelper.ts`).
- `src/config/`: Configuration schemas (Zod), pricing policies, key resolution (`keyResolver.ts`).
- `src/core/`: ReAct orchestrator loop (`BotCore`), IoC container (`ServiceContainer.ts`), transport interfaces (`src/core/transport/`), `FairnessQueue`, blueprints (`src/core/blueprint/`), and concurrency managers.
- `src/persona/`: Persona profiles, system prompts, cognitive rules.
- `src/plugins/`: Modular tool plugins (system, dev tools, dynamic tools).
- `src/providers/`: Two-layer routing architecture (Layer 0 execution adapters, Layer 1 SmartLayer router, protocol families, `messageConverter.ts`).
- `src/scheduler/`: Task scheduling and database monitoring.
- `src/services/`: Memory management (L1 Redis, L2 Supabase, graph memory), agentic planner, sub-agent engine, PTC VM engine, and runtime safety infrastructure.
- `src/supabase/`: Database schemas, SQL migrations, and pgvector match functions.
- `src/utils/`: Safe filesystem wrappers (`safeFs.ts`), cryptography, logger, PID lock, and tool execution error handlers.
- `src/tests/`: Unit (`src/tests/unit/`), Integration (`src/tests/integration/`), and E2E suites (`src/tests/e2e/`).

---

## 6. TUI Decoupling (Headless Core)

The interactive terminal UI is extracted into a standalone sibling repository (`HIVE-MIND-TUI`):
- **Headless Core (this repository)**: Exposes a WebSocket IPC server via `TuiServerTransport` (`src/core/transport/tui/HiveTransport.ts`) on port 5001, authenticated by `tui-connection.json`. Zero React/Ink dependencies.
- **Standalone TUI**: Independent React 19 / Ink 6 process connecting over WebSocket.

---

## 7. Known Architecture Debt & Refactoring Roadmap

Refer to `docs/architecture_audit.md` (local-only) and [`documentation/00_index.md`](documentation/00_index.md):
1. **Phase 1 (Micro-Libraries, $I = 0.00$)**: Extract zero-dependency modules (`SS-23 Hash-Anchored Editor`, `SS-02 FairnessQueue`, `SS-11 MessageConverter`, `SS-26 SafeFs`).
2. **Phase 2 (Core Reliability)**: Decouple `SS-12 SmartLLM Router` and `SS-21 AI Runtime Control Plane` into independent packages.
3. **Phase 3 (Universal Harness)**: Package `SS-01 ServiceContainer`, `SS-06 ExplicitPlanner`, and `SS-08 PTC VM Engine` into an open-source autonomous agent harness.
