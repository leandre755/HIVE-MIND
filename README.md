<p align="center">
  <img src="assets/logo.jpeg" alt="HIVE-MIND Logo" width="180" style="border-radius: 12px;" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/HIVE--MIND-V3-0D1117?style=for-the-badge&labelColor=0D1117&color=58A6FF&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0id2hpdGUiPjxwYXRoIGQ9Ik0xMiAyQzYuNDggMiAyIDYuNDggMiAxMnM0LjQ4IDEwIDEwIDEwIDEwLTQuNDggMTAtMTBTMTcuNTIgMiAxMiAyem0wIDE4Yy00LjQyIDAtOC0zLjU4LTgtOHMzLjU4LTggOC04IDggMy41OCA4IDgtMy41OCA0LTggOHptLTItM2g0di0ySDEwdjJ6bTAtNGg0VjdoLTR2NnoiLz48L3N2Zz4=" alt="HIVE-MIND V3" />
</p>

<h1 align="center">HIVE-MIND</h1>

<p align="center">
  <strong>Autonomous AI Agent Framework</strong>
</p>

<p align="center">
  <a href="#-quick-start"><img src="https://img.shields.io/badge/Quick_Start-→-58A6FF?style=flat-square" alt="Quick Start" /></a>
  <a href="#-architecture"><img src="https://img.shields.io/badge/Architecture-→-58A6FF?style=flat-square" alt="Architecture" /></a>
  <a href="#-plugins"><img src="https://img.shields.io/badge/Plugins-→-58A6FF?style=flat-square" alt="Plugins" /></a>
  <a href="#-deployment"><img src="https://img.shields.io/badge/Deploy-→-58A6FF?style=flat-square" alt="Deploy" /></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Version-3.5.0-0D1117?style=flat-square&labelColor=0D1117&color=3FB950" alt="Version" />
  <img src="https://img.shields.io/badge/TypeScript-Strict-0D1117?style=flat-square&labelColor=0D1117&color=3178C6&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/License-MIT-0D1117?style=flat-square&labelColor=0D1117&color=F0883E" alt="License" />
  <img src="https://img.shields.io/badge/Node.js-18+-0D1117?style=flat-square&labelColor=0D1117&color=3FB950&logo=node.js&logoColor=white" alt="Node.js" />
</p>

---

## Overview

HIVE-MIND is a production-grade **Autonomous AI Agent Framework** built in strict TypeScript. It features a cognitive architecture driven by declarative blueprints, motivation drives, and a closed-loop security manifold.

The agent reasons, plans, executes multi-step tasks, orchestrates sub-agents, manages its own memory lifecycle, and proactively engages across multiple communication channels — all governed by strict budget, safety, and behavioral constraints.

**Key differentiators:**

- 🧠 **Cognitive Memory Architecture** — Proactive motivation drives, user preference profiling, memory decay & consolidation
- 📐 **Blueprint-Driven Governance** — Declarative agent blueprints, constraint manifold tool pruning, Zod-validated schemas
- 🛡️ **Runtime Infrastructure** — Input/output safety validation, completeness checking, budget throttling
- 🌐 **Omni-Channel** — WhatsApp · Discord · Telegram · CLI with unified identity
- 🔀 **Smart Router V2** — Multi-key rotation across 10+ AI providers with zero-429 quota management
- 🐝 **Swarm Architecture** — Dynamic sub-agent orchestration with ephemeral blueprints
- ⚡ **Programmatic Tool Calling (PTC)** — AST-validated JS execution in a sandboxed VM
- 🎙️ **Native Audio** — Voice-to-voice via Gemini Live, TTS via Gemini/Minimax

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#-architecture)
- [Core Systems](#-core-systems)
- [Supported Providers](#-supported-providers)
- [Plugins](#-plugins)
- [Quick Start](#-quick-start)
- [Configuration](#-configuration)
- [Project Structure](#-project-structure)
- [Scripts & Commands](#-scripts--commands)
- [Testing](#-testing)
- [Deployment](#-deployment)
- [Security](#-security)
- [Contributing](#-contributing)
- [License](#-license)

---

## 🏗 Architecture

HIVE-MIND follows a strict **layered architecture** with one-way dependency flow, governed by a declarative blueprint system and a cognitive layer:

```
┌─────────────────────────────────────────────────────────────────────┐
│                        TRANSPORT LAYER                              │
│   WhatsApp (Baileys)  ·  Discord  ·  Telegram  ·  CLI (Ink TUI)    │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       ORCHESTRATION CORE                            │
│  ┌──────────┐  ┌───────────────┐  ┌────────────┐  ┌─────────────┐  │
│  │ ReAct    │  │ Smart Router  │  │ Permission │  │ Fairness    │  │
│  │ Engine   │  │ V2 (Zero-429) │  │ Manager    │  │ Queue       │  │
│  └──────────┘  └───────────────┘  └────────────┘  └─────────────┘  │
│  ┌──────────┐  ┌───────────────┐  ┌────────────────────────────┐   │
│  │ Context  │  │ Blueprint     │  │ Service Container (DI)     │   │
│  │ Loader   │  │ Manager       │  │                            │   │
│  └──────────┘  └───────────────┘  └────────────────────────────┘   │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     RUNTIME INFRASTRUCTURE                          │
│  ┌──────────────┐  ┌───────────────┐  ┌────────────────────────┐   │
│  │ Safety       │  │ Task Checker  │  │ Budget Throttle        │   │
│  │ Guard        │  │               │  │                        │   │
│  └──────────────┘  └───────────────┘  └────────────────────────┘   │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         COGNITIVE LAYER                             │
│  ┌──────────┐  ┌───────────┐  ┌──────────┐  ┌──────────────────┐   │
│  │ Memory   │  │ Learning  │  │ Driver   │  │ Consciousness    │   │
│  │          │  │ Engine    │  │ System   │  │ (WakeSystem)     │   │
│  └──────────┘  └───────────┘  └──────────┘  └──────────────────┘   │
│  ┌──────────┐  ┌───────────┐  ┌──────────┐  ┌──────────────────┐   │
│  │ Agentic  │  │ PTC &     │  │ Browser  │  │ Voice & Audio    │   │
│  │ Swarm    │  │ Sandbox   │  │ Agent    │  │ Pipeline         │   │
│  └──────────┘  └───────────┘  └──────────┘  └──────────────────┘   │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     INFRASTRUCTURE LAYER                            │
│     Supabase (PostgreSQL + pgvector)  ·  Redis (Upstash)            │
│     AI Providers (Gemini, Groq, OpenRouter, ...)  ·  Playwright     │
└─────────────────────────────────────────────────────────────────────┘
```

### Design Principles

| Principle                  | Implementation                                                             |
| -------------------------- | -------------------------------------------------------------------------- |
| **SOLID**                  | Service Container with dependency injection, single-responsibility modules |
| **Strict Typing**          | TypeScript strict mode, Zod validation on external payloads and blueprints |
| **Immutability**           | Spread-only state updates, read-only properties                            |
| **Fail-Closed Security**   | Safety guard rejects by default, tool pruning filters forbidden tools      |
| **Event-Driven**           | Core EventBus + Redis EventInbox for decoupled inter-module communication  |
| **Declarative Governance** | Agent behavior defined by JSON blueprints, not hardcoded logic             |

---

## 🧠 Core Systems

### ReAct Engine

The central reasoning loop follows the **ReAct** pattern (Reasoning + Acting):

1. **Perceive** — Multi-channel input analysis with context hydration (Thought Stream)
2. **Think** — Internal reasoning via `<thought>` blocks with chain-of-thought protocol
3. **Act** — Tool execution with Constraint Manifold pruning, PTC batching, or Swarm delegation
4. **Observe** — Result analysis with automatic error recovery, retry, and task completion verification

### Blueprint-Driven Governance

Agent behavior is defined by **Blueprints** (`config/blueprints/*.json`) validated with Zod:

```json
{
  "metadata": { "id": "hive_main", "name": "HIVE-MIND Core", "version": "1.0.0" },
  "mind": {
    "drives": ["Maintain system health", "Engage user proactively", "Learn from interactions"]
  },
  "action_space": {
    "allowed_tools": ["google_ai_search", "code_execution", "read_file", "..."]
  },
  "constraints": {
    "read_only_fs": false,
    "max_budget_usd": 1.0,
    "max_iterations": 15
  }
}
```

- **Constraint Manifold** — `projectActionSpace()` physically removes unauthorized tools from the LLM's action space before each API call, achieving `P(forbidden_action) = 0`
- **Ephemeral Blueprints** — Sub-agents receive dynamically generated blueprints in RAM, validated by the same Zod schema, and garbage-collected after completion

### Runtime Infrastructure

Unified control plane replacing the legacy CostTracker, MoralCompass, and MultiAgent services:

| Module                | Role              | Mechanism                                                                                             |
| --------------------- | ----------------- | ----------------------------------------------------------------------------------------------------- |
| **Safety Guard**      | Safety evaluation | Blueprint whitelist → Read-only FS check → LLM safety review (3-layer cascade)                        |
| **Task Checker**      | Anti-laziness     | Detects premature closure ("I've finished" without evidence) → forces kickback with correction prompt |
| **Budget Throttling** | Budget control    | Dynamic budget throttling, physical `max_tokens` reduction                                            |

### Cognitive Layer

#### Memory Stack

| Layer                     | Backend             | Purpose                                       | Latency |
| ------------------------- | ------------------- | --------------------------------------------- | ------- |
| **L0 — Working Memory**   | In-process          | Current conversation turn                     | ~0ms    |
| **L1 — Context Cache**    | Redis               | Passport, Scratchpad, Action History (5 msgs) | ~2ms    |
| **L2 — Semantic Memory**  | Supabase pgvector   | Long-term recall via RAG embeddings + boost   | ~50ms   |
| **L3 — Persistent Store** | Supabase PostgreSQL | User profiles, goals, graph relations, facts  | ~30ms   |

**Memory Boost:** Every RAG recall triggers an asynchronous database RPC that strengthens the retrieved memory's score, implementing a "use it or lose it" principle.

#### Memory Decay System

Exponential forgetting based on `exp(-ageHours / τ)`:

- **Recency** — Older memories decay faster
- **Frequency** — Frequently recalled memories resist decay
- **Importance** — Keyword-based semantic importance scoring
- **Consolidation** — When ≥ 5 memories are archived, a background gist synthesis creates a dense summary and stores it back

#### User Profile Learning Engine

Asynchronous extraction of structured knowledge from conversations:

- `fact:` — Static facts about the user ("Developer", "Lives in Paris")
- `pref:` — Behavioral preferences ("Prefers concise answers", "Uses Python")
- `goal:` — Active objectives ("Deploy web app by Friday")

Injected into the Thought Stream as `<user_model>` XML blocks.

#### DriverSystem (Proactive Motivation)

Blueprint-defined "drives" (motivations) that trigger autonomous behavior during idle periods:

1. Scheduler fires `consciousPulse` on cron
2. DriverSystem loads blueprint drives and selects one via round-robin
3. A `spontaneous_thought` event is pushed to the Redis EventInbox
4. The ReAct engine processes the thought and takes proactive action

Redis `driver_lock` with 1h TTL prevents spam.

### Smart Router V2 (Zero-429)

Intelligent multi-provider routing with proactive quota management:

- **Multi-Key Rotation** — Up to 7 API keys per provider with granular Redis-tracked quotas
- **Tiered Fallback** — S → A → B → C tier cascade across providers
- **Zero-429 Strategy** — Proactive key rotation before rate limits hit
- **Inner Retry Loop** — On 429, transparently pivots to the next key for the same model
- **Real-Time Metrics** — Per-key usage tracking with L0 in-memory cache (2s TTL)

### Agentic Swarm

Dynamic multi-agent orchestration for complex tasks:

- **Planner** — Decomposes goals into executable sub-tasks with tool validation
- **SubAgentEngine** — Spawns specialized agents with isolated ReAct loops and tool whitelists
- **SpawnSubAgentTool** — LLM-facing tool that constructs ephemeral blueprints at runtime

### Programmatic Tool Calling (PTC)

Instead of sequential tool calls (N round-trips), the LLM generates JavaScript that calls multiple tools in a single execution:

```
Traditional:  LLM → Tool₁ → LLM → Tool₂ → LLM → Tool₃  (6 steps)
PTC:          LLM → JS{Tool₁ + Tool₂ + Tool₃}            (2 steps)
```

Security enforced via **SafeScript** AST validation:

- Static analysis with `acorn` parser
- Blocked patterns: `process.exit`, `require`, `eval`, `__proto__`
- Sandboxed execution in Node.js `vm` with timeout
- Model classification: Tier S (full PTC) → Tier C (disabled)

### Consciousness Layer (WakeSystem)

Background autonomous loop that enables proactive behavior:

- **Watchdog Scheduler** — Fires `consciousPulse`, `memoryDecay`, `dbMonitoring` on cron
- **EventInbox** — Redis-backed async event queue with `read_event_inbox` / `clear_event_inbox` tools
- **MailboxWatcher** — Polls the EventInbox and triggers the ReAct engine on new events
- **ActionMemory** — Tracks long-running tasks with zombie detection (`getStalledActions`) and heartbeat (`pulseAction`)
- **WakeSystem** — `HIVE.sleepAndWake(delayMs, prompt)` bridge for deferred autonomous actions

### Context Engineering (Thought Stream)

The `TieredContextLoader` hydrates the `system.md` template into a structured XML prompt:

```xml
<system_prompt>
  <core_identity>...</core_identity>
  <motivation_drives>- Maintain system health\n- Engage user...</motivation_drives>
  <user_model>
    <facts>Developer | Lives in Paris</facts>
    <preferences>Concise answers | Python</preferences>
    <active_goals>Deploy web app</active_goals>
  </user_model>
  <execution_harness>
    <scratchpad>Current task state...</scratchpad>
    <ongoing_goal>Scan network</ongoing_goal>
  </execution_harness>
  <economic_constraint>
    <max_budget_usd>1.0</max_budget_usd>
    <max_iterations>15</max_iterations>
  </economic_constraint>
  <current_consciousness_state>...</current_consciousness_state>
  <execution_engine>...</execution_engine>
</system_prompt>
```

Dynamic blueprint resolution per group: each WhatsApp group can have its own `blueprintId` in the database, overriding the default `hive_main`.

---

## 🤖 Supported Providers

### LLM Providers

| Provider        | Key Models                                         | PTC Tier | Use Case                                            |
| --------------- | -------------------------------------------------- | -------- | --------------------------------------------------- |
| **Google**      | Gemini 3.5 Flash, 3.1 Pro, Gemma 4 31B             | S        | **Primary** — reasoning, coding, vision, multimodal |
| **Anthropic**   | Claude 4.5 Opus, Sonnet                            | S        | Complex reasoning                                   |
| **OpenAI**      | GPT-5.2, GPT-5 Mini                                | S        | General purpose                                     |
| **Mistral**     | Mistral Large, Codestral                           | A        | European alternative, coding                        |
| **Kimi**        | Kimi K2.6 (via NVIDIA NIM)                         | S        | Coding specialist                                   |
| **Groq**        | LLaMA 3.3 70B, GPT-OSS 120B, Qwen3 32B, Whisper v3 | A-B      | Fast inference, STT                                 |
| **GitHub**      | DeepSeek R1/V3, LLaMA 3.3, Phi-4                   | A-C      | Free-tier models                                    |
| **NVIDIA**      | Kimi K2.6, GLM 5.1, Minimax M2.7                   | S-C      | NIM inference                                       |
| **OpenRouter**  | Minimax M2.5, GLM 4.5 Air (free)                   | S-B      | Gateway fallback                                    |
| **HuggingFace** | LLaMA 3 8B, Kimi K2                                | B-C      | Experimental                                        |
| **Moonshot**    | Moonshot v1 (8k/32k/128k)                          | C        | Budget fallback                                     |

### Audio & Media

| Capability         | Provider              | Details                                                 |
| ------------------ | --------------------- | ------------------------------------------------------- |
| **Voice-to-Voice** | Gemini Live           | Native bidirectional audio streaming via WebSocket      |
| **Text-to-Speech** | Gemini TTS / Minimax  | Director's Chair persona voices (Kore, Erina-clone)     |
| **Speech-to-Text** | Groq Whisper v3 Turbo | Ultra-fast transcription                                |
| **Web Search**     | SerpApi               | Google AI Search (Standard, Chat, News)                 |
| **Browser Agent**  | Playwright            | Headless Chromium with viewport & full-page screenshots |

---

## 🔌 Plugins

HIVE-MIND uses a modular plugin architecture with auto-discovery. Every plugin returns a standardized `{ success: boolean, message: string }` signature.

### Base (Core Agent Tools)

| Plugin            | Description                                                                         |
| ----------------- | ----------------------------------------------------------------------------------- |
| `memory`          | `remember_fact`, `recall_fact`, `search_long_term_memory`, `update_scratchpad`      |
| `goals`           | `create_goal`, `list_goals`, `complete_goal`, `cancel_goal` — autonomous scheduling |
| `sys_interaction` | `send_message`, `send_file`, `send_contact`, `create_poll` — omni-channel           |
| `system`          | `get_my_capabilities`, `get_time`, `get_bot_info`                                   |
| `admin`           | User management, plugin control, system administration                              |
| `dev_tools`       | `spawn_sub_agent`, `execute_bash_command`, `run_scratchpad`, AST tools              |
| `mcp_tools`       | MCP client bridge for external tool servers                                         |

### System

| Plugin          | Description                                                      |
| --------------- | ---------------------------------------------------------------- |
| `event_manager` | `read_event_inbox`, `clear_event_inbox` — async event processing |

### Web & Research

| Plugin             | Description                                      |
| ------------------ | ------------------------------------------------ |
| `google_ai_search` | Google AI Search via SerpApi with multiple modes |
| `deep_research`    | Multi-source deep research with synthesis        |
| `crawlfire_web`    | Web page crawling and content extraction         |
| `duckduck_search`  | DuckDuckGo search fallback                       |
| `wikipedia`        | Wikipedia knowledge lookup                       |

### Tools & Utilities

| Plugin            | Description                                              |
| ----------------- | -------------------------------------------------------- |
| `shopping`        | Product search and comparison                            |
| `send_email`      | Email composition and dispatch via n8n webhook           |
| `send_sticker`    | Mood-based sticker selection from `storage_hm/stickers/` |
| `translate`       | Multi-language translation                               |
| `daily_pulse`     | Daily briefing and news aggregation                      |
| `visual_reporter` | PDF report generation with PDFKit                        |

### WhatsApp-Specific

| Plugin          | Description                                          |
| --------------- | ---------------------------------------------------- |
| `sticker`       | Sticker creation from images                         |
| `group_manager` | Group administration (ban, promote, keyword filters) |

### Media

| Plugin | Description                                                            |
| ------ | ---------------------------------------------------------------------- |
| `tts`  | Text-to-speech audio generation (Gemini TTS / Minimax / gTTS fallback) |

---

## 🚀 Quick Start

### Prerequisites

| Component   | Minimum                     | Recommended     |
| ----------- | --------------------------- | --------------- |
| **Node.js** | 18.x LTS                    | 20.x LTS        |
| **OS**      | Windows 10+ / Linux / macOS | Debian / Ubuntu |
| **RAM**     | 512 MB                      | 1 GB+           |

### Required Services (Free Tiers Available)

| Service              | Purpose                                | Sign Up                                            |
| -------------------- | -------------------------------------- | -------------------------------------------------- |
| **Supabase**         | Database & Vector memory               | [supabase.com](https://supabase.com)               |
| **Redis (Upstash)**  | Cache & Ephemeral context              | [upstash.com](https://upstash.com)                 |
| **Google AI Studio** | Primary AI provider (Gemini 3.5 Flash) | [aistudio.google.com](https://aistudio.google.com) |

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/leandre755/HIVE-MIND.git
cd HIVE-MIND

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Edit .env with your API keys and service credentials

# 4. Deploy database schema
# Execute supabase/supabase_setup.sql in your Supabase SQL editor

# 5. Start the agent
npm run dev
```

> **WhatsApp:** On first launch, scan the QR code displayed in the terminal with your WhatsApp app to link the session.

### CLI Mode (No WhatsApp Required)

```bash
npm run cli
```

Launches an interactive terminal interface (Ink TUI) for local development and testing without any messaging platform.

---

## ⚙ Configuration

### Environment Variables

Copy `.env.example` to `.env` and configure the following sections:

#### Database (Required)

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-service-role-key
REDIS_URL=redis://default:password@host:port
```

#### AI Providers (Smart Router V2)

HIVE-MIND supports **multi-key rotation** — up to 7 keys per provider for zero-downtime:

```env
# Primary key
GEMINI_KEY=your-gemini-api-key

# Rotation keys (optional, improves quota resilience)
GEMINI_KEY_1=your-first-key
GEMINI_KEY_2=your-second-key
# ... up to GEMINI_KEY_7
```

Same pattern applies to: `GROQ_KEY`, `MISTRAL_KEY`, `MOONSHOT_KEY`, `MINIMAX_KEY`, `HF_KEY`, `NVIDIA_KEY`, `OPENROUTER_KEY`.

> **Note:** Legacy `VOTRE_CLE_*` environment variable names are no longer supported. Use the strict `PROVIDER_KEY` / `PROVIDER_KEY_N` format.

#### Behavioral Settings

```env
TZ=Europe/Paris                    # Timezone for scheduler
DEBUG=false                        # Verbose logging
SEND_DELIVERY_RECEIPTS=true        # WhatsApp blue ticks
PTC_ENABLED=true                   # Programmatic Tool Calling
PTC_TIMEOUT_MS=30000               # PTC execution timeout
```

#### Browser Agent

```env
AGENT_BROWSER_IDLE_TIMEOUT_MS=300000    # Auto-shutdown after 5min idle
# AGENT_BROWSER_BLOCKED_DOMAINS=malware.com,phishing.net
```

### Runtime Configuration

| File                                     | Purpose                                                     |
| ---------------------------------------- | ----------------------------------------------------------- |
| `config/config.json`                     | Backlog protection, voice transcription mode                |
| `config/models_config.json`              | Model families, tiers, PTC capabilities                     |
| `config/pricing.json`                    | Per-model cost tracking                                     |
| `config/scheduler.json`                  | Cron jobs (`consciousPulse`, `memoryDecay`, `dbMonitoring`) |
| `config/blueprints/hive_main.json`       | Primary agent blueprint (drives, tools, constraints)        |
| `config/blueprints/deep_researcher.json` | Deep research sub-agent blueprint                           |

---

## 📂 Project Structure

```
HIVE-MIND/
├── bin/                    # CLI entrypoint (hive-mind.ts)
├── core/                   # Orchestration layer
│   ├── index.ts            # Main ReAct engine & message loop (~2200 lines)
│   ├── orchestrator.ts     # High-level orchestration
│   ├── ServiceContainer.ts # Dependency injection container
│   ├── FairnessQueue.ts    # Per-user message queuing
│   ├── blueprint/          # Declarative blueprints (Zod schema, BlueprintManager)
│   ├── context/            # TieredContextLoader (Thought Stream hydration)
│   ├── handlers/           # schedulerHandler (consciousPulse, memoryDecay)
│   ├── security/           # PermissionManager (RBAC)
│   ├── transport/          # Omni-channel adapters
│   │   ├── baileys.ts      # WhatsApp (Baileys)
│   │   ├── discord.ts      # Discord
│   │   ├── telegram.ts     # Telegram
│   │   ├── cli.ts          # Terminal CLI
│   │   └── ink/            # Ink TUI components
│   └── types/              # Core type definitions
├── services/               # Domain services
│   ├── runtime/            # RuntimeInfrastructure (Safety, Verification, Budget)
│   ├── mindos/             # Motivation DriverSystem (proactive motivations)
│   ├── memory/             # SemanticMemory, MemoryDecay, ActionMemory
│   ├── learning/           # LearningEngine (User preference extraction)
│   ├── events/             # EventInboxService, MailboxWatcher
│   ├── agentic/            # SubAgentEngine, Planner
│   ├── ptc/                # PTC Executor, SafeScript, WakeSystem, HIVE bridge
│   ├── browser/            # Playwright-based browser agent (BrowserService)
│   ├── voice/              # TTS providers (Minimax, Gemini TTS, gTTS)
│   ├── audio/              # Audio conversion & Gemini Live WebSocket
│   ├── ast/                # TreeSitter service (AST-native code tools)
│   ├── anchor/             # Hash-Anchored edit system (Hash-anchored protocol)
│   ├── monitoring/         # Database health monitoring
│   ├── state/              # StateManager, IdentityMap (UUID-based)
│   ├── memory.ts           # Supabase memory operations
│   ├── workingMemory.ts    # Redis working memory (L1)
│   ├── redisClient.ts      # Redis connection management
│   ├── supabase.ts         # Supabase client & queries
│   ├── quotaManager.ts     # Smart Router V2 quota tracking
│   └── ...                 # User, group, admin, feedback, goals services
├── plugins/                # Modular plugin system
│   ├── loader.ts           # Auto-discovery & registration (CORE_TOOLS injection)
│   ├── base/               # Core plugins (memory, admin, goals, dev_tools, system, mcp)
│   ├── system/             # System plugins (event_manager)
│   ├── tools/              # Utility plugins (shopping, email, sticker, translate, ...)
│   ├── web/                # Web & research plugins (google, duckduck, crawlfire, wiki)
│   ├── media/              # Media plugins (tts)
│   └── whatsapp/           # WhatsApp-specific plugins (sticker, group_manager)
├── providers/              # AI provider adapters
│   ├── index.ts            # Smart Router V2 (provider selection, budget throttle)
│   └── adapters/           # 15 provider implementations
│       ├── gemini.ts       # Google Gemini
│       ├── geminiLive.ts   # Gemini Live audio streaming
│       ├── geminiTTS.ts    # Gemini TTS
│       ├── groq.ts         # Groq
│       ├── anthropic.ts    # Anthropic Claude
│       ├── openai.ts       # OpenAI
│       ├── mistral.ts      # Mistral AI
│       ├── nvidia.ts       # NVIDIA NIM
│       ├── kimi.ts         # Kimi
│       ├── moonshot.ts     # Moonshot
│       ├── openrouter.ts   # OpenRouter gateway
│       ├── github.ts       # GitHub Models
│       ├── huggingface.ts  # HuggingFace
│       ├── minimaxTTS.ts   # Minimax TTS
│       └── gttsTTS.ts      # Google TTS (gTTS) fallback
├── config/                 # Configuration files
│   └── blueprints/         # AgenticFormat blueprints (hive_main, deep_researcher)
├── persona/                # Agent personality & system prompt template (system.md)
├── scripts/                # Utility & diagnostic scripts
│   ├── test_cli_e2e.ts     # Local CLI E2E test runner
│   └── test_wa_e2e.ts      # Production WhatsApp E2E test runner
├── supabase/               # Database schema (SQL)
├── tests/                  # Test suites
│   ├── unit/               # Unit tests
│   └── integration/        # Integration tests
├── types/                  # Global TypeScript declarations
├── utils/                  # Shared utilities (responseSanitizer, helpers)
├── Sandbox1/               # PTC sandboxed execution environment
└── storage_hm/             # Persistent agent data (screenshots, stickers, files)
```

---

## 📜 Scripts & Commands

| Script               | Command                    | Description                               |
| -------------------- | -------------------------- | ----------------------------------------- |
| **Start**            | `npm start`                | Production launch                         |
| **Dev**              | `npm run dev`              | Development with hot-reload (tsx --watch) |
| **CLI**              | `npm run cli`              | Local CLI mode (no WhatsApp)              |
| **Build**            | `npm run build`            | TypeScript type-check (noEmit)            |
| **Lint**             | `npm run lint`             | ESLint static analysis                    |
| **Lint Fix**         | `npm run lint:fix`         | Auto-fix lint issues                      |
| **Test**             | `npm test`                 | Run all test suites                       |
| **Test Unit**        | `npm run test:unit`        | Unit tests only                           |
| **Test Integration** | `npm run test:integration` | Integration tests only                    |
| **Test E2E**         | `npm run test:e2e`         | End-to-end tests only                     |
| **Repair Session**   | `npm run repair`           | Repair corrupted WhatsApp session         |
| **Audit Group**      | `npm run audit:group`      | Audit WhatsApp group metadata             |
| **Fix Usernames**    | `npm run fix:usernames`    | Backfill missing user display names       |

---

## 🧪 Testing

HIVE-MIND follows a **TDD workflow** with a two-tier E2E strategy:

### Test Tiers

```bash
# Run all tests
npm test

# Run specific tier
npm run test:unit
npm run test:integration

# Local CLI E2E (real Supabase, Redis, AI)
npx tsx scripts/test_cli_e2e.ts

# Production WhatsApp E2E (against live Railway deployment)
npx tsx scripts/test_wa_e2e.ts --account user
```

### Test Stack

| Tool           | Version                     | Purpose                  |
| -------------- | --------------------------- | ------------------------ |
| **Jest**       | 30.x                        | Test runner & assertions |
| **ts-jest**    | 29.x                        | TypeScript transformer   |
| **VM Modules** | `--experimental-vm-modules` | ESM support in tests     |

### E2E Strategy

| Level             | Script                    | Environment           | Purpose                                         |
| ----------------- | ------------------------- | --------------------- | ----------------------------------------------- |
| **Local CLI**     | `scripts/test_cli_e2e.ts` | Local (real services) | Validate features before pushing                |
| **Production WA** | `scripts/test_wa_e2e.ts`  | Live Railway          | Validate production (voice, media, permissions) |

---

## 🚢 Deployment

### Railway (Recommended)

HIVE-MIND is pre-configured for [Railway](https://railway.app) deployment via `nixpacks.toml`:

```toml
[phases.setup]
nixPkgs = ["...", "chromium", "playwright-driver"]

[phases.install]
cmds = ["npm install"]

[phases.build]
cmds = ["npm run build"]
```

**Steps:**

1. Push to your GitHub repository
2. Connect the repo to a Railway project
3. Set all environment variables from `.env.example` in the Railway dashboard
4. Deploy — Railway auto-detects Nixpacks and builds

### Environment Requirements

| Service      | Required | Notes                                      |
| ------------ | -------- | ------------------------------------------ |
| **Supabase** | ✅       | Deploy `supabase/supabase_setup.sql` first |
| **Redis**    | ✅       | Upstash recommended for serverless         |
| **Chromium** | ⚠️       | Required only if Browser Agent is used     |

### Health Monitoring

```bash
# Stream live production logs
railway logs --tail

# Last 5 minutes
railway logs --tail --since 5m
```

---

## 🛡 Security

### Defense-in-Depth Architecture (6 Layers)

| Layer               | Component                     | Strategy                                                                                   |
| ------------------- | ----------------------------- | ------------------------------------------------------------------------------------------ |
| **L1 — Input**      | Permission Manager            | RBAC with Super-Admin, Admin, User roles                                                   |
| **L2 — Governance** | Constraint Manifold           | Blueprint `allowed_tools` whitelist prunes the action space before API calls               |
| **L3 — Safety**     | Safety Guard                  | 3-layer cascade: blueprint check → destructive tool guard → LLM safety review              |
| **L4 — Execution**  | SafeScript (AST) + VM Sandbox | Static acorn analysis blocking dangerous patterns, isolated execution with timeout         |
| **L5 — Budget**     | Budget Control                | Dynamic budget throttling, physical `max_tokens` reduction, kill switch on budget exceeded |
| **L6 — Behavior**   | Task Checker                  | Completeness verification ensuring the agent completes tasks before closing                |

### Permission Model

```
Global Owner  →  Full system control (HITL approvals routed here)
Super Admin   →  Plugin management, user administration
Admin         →  Group management, moderation
User          →  Standard interaction
```

### Key Security Features

- **Human-in-the-Loop (HITL)** — Dangerous operations require explicit owner approval (dual-logic: Admin Hub + In-Band escalation)
- **Universal Read / Restricted Write** — Agent can read system files but writes are sandboxed to `Sandbox1/` and `storage_hm/`
- **Constraint Manifold** — Tools not in the blueprint's `allowed_tools` are physically removed from the LLM's action space (`P(action) = 0`)
- **AST Validation** — Every PTC script is parsed and analyzed before execution
- **Automatic Cooldown** — Rate limiting and backlog protection prevent abuse
- **2-Layer Response Defense** — Detects missing `<thought>` tags, leaked tool calls, and raw code dominance; forces retry or strips before sending

> ⚠️ **Important:** Configure your Super-Admin users in the Supabase `users` table before deploying to production. Unconfigured instances default to open access.

---

## 🤝 Contributing

### Development Workflow

1. **Read Context** — Check `.GCC/main.md` for current project state
2. **Design First** — Create or update `docs/design_docs/` before coding
3. **Write Tests** — Tests must compile and fail (red) before implementation
4. **Implement** — Write the minimum code to pass tests (green)
5. **Verify** — Run `npx tsx scripts/test_cli_e2e.ts` for full validation

### Code Standards

- TypeScript strict mode — no `any` (use `unknown`), explicit return types
- Functions: max 20 lines, max 2 parameters (use objects beyond)
- Naming: intent-revealing, no abbreviations, booleans use verbs (`isLoading`)
- Error handling: `Result<T, Error>` pattern or explicit throws — never silent `null`
- Comments explain **why**, not **how**
- Zero TODO comments in source — future work tracked in `.GCC/afaire.md`

### Branch Strategy

- `main` — Production (auto-deploys to Railway)
- Feature branches merged via PR with review

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).

---

<p align="center">
  <sub>Built by <a href="https://github.com/leandre755">Christ-Leandre</a> — HIVE-MIND V3.5</sub>
</p>
