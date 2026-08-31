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

## 2. Technical Stack

- **Runtime & Language**: Node.js >= 22.0.0 (ESM native), TypeScript (Strict Mode).
- **Core Dependencies**: `@whiskeysockets/baileys` (WhatsApp), `@supabase/supabase-js` (PostgreSQL/Vector), `redis` (Upstash/Local), `@google/genai`, `@anthropic-ai/sdk`, `openai`, `groq-sdk`, `zod`, `pino` (Logging).
- **Filesystem & I/O Policy**: All filesystem operations MUST use the safe wrappers from `src/utils/safeFs.ts` (`safeReadFileSync`, `safeWriteFileSync`, `safeExistsSync`, `safeMkdirSync`, `safeUnlink`, `safeReaddir`, `safeAppendFile`). Raw `node:fs` calls are strictly banned.

---

## 3. Directory Map

- `src/bin/`: Application CLI and service entry points (`hive-mind.ts`).
- `src/cli/`: Auth session management and startup menu (`whatsappAuthHelper.ts`, `startupMenu.ts`, `authSessionManager.ts`).
- `src/config/`: Configuration schemas (Zod), pricing models, and key resolution.
- `src/constants/`, `src/types/`: Shared constants and type definitions.
- `src/core/`: ReAct loop (`BotCore` via `orchestrator.ts` / `index.ts`), IoC container (`ServiceContainer.ts`), transport layer (`src/core/transport/`: `baileys.ts`, `discord.ts`, `telegram.ts`, `cli.ts`, `TuiServerTransport.ts`, `tui/` WebSocket bridge), `FairnessQueue`, blueprints (`src/core/blueprint/`), concurrency, context, security, and event handlers.
- `src/persona/`: Persona definitions, cognitive rules, and system prompt templates.
- `src/plugins/`: Modular tool plugins (RAG-loaded, system tools, dynamic tools).
- `src/providers/`: Multi-provider architecture (Layer 0 execution, Layer 1 smart routing, protocol families, adapters).
- `src/scheduler/`: Task and message scheduling.
- `src/services/`: Memory management (Redis L1, Supabase L2, graph memory, quota, dream/consolidation services).
- `src/supabase/`: Supabase schema, migrations, and client utilities.
- `src/utils/`: Safe filesystem, cryptographic utilities, logging, TLS impersonation, and tool execution engines.
- `src/tests/`: Unit (`src/tests/unit/`), Integration (`src/tests/integration/`), and E2E suites (`src/tests/e2e/`).

---

## 4. TUI Decoupling (Current State)

The interactive terminal UI has been extracted from this repository (milestones M1–M3 of `PROJECT.md` complete):

- **HIVE-MIND Core (this repo)** is a headless daemon. `TuiServerTransport` runs a WebSocket server (default port 5001) via `src/core/transport/tui/HiveTransport.ts` and writes `tui-connection.json` (host, port, auth token). Zero React/Ink dependencies remain.
- **Standalone TUI** lives in its own repository (`HIVE-MIND-TUI`): React 19 + Ink 6, connects over WebSocket using `tui-connection.json`.
- Do not reintroduce React/Ink code or `src/tui/` paths into this repository.

---

## 5. Known Architecture Debt

See `docs/architecture_audit.md` (SonarCloud audit, local-only — `docs/` is personal and gitignored): oversized files (`src/core/index.ts`, `src/providers/index.ts`), cyclic dependencies, and SRP violations to avoid worsening when touching these areas.
