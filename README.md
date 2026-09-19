<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://i.ibb.co/27t7qsBT/banner-readme-tall-condensed-drone-transparent.png">
    <source media="(prefers-color-scheme: light)" srcset="https://i.ibb.co/1JwwQ5ry/banner-readme-tall-condensed-bold-drone-light.png">
    <img alt="HIVE-MIND Banner" src="https://i.ibb.co/27t7qsBT/banner-readme-tall-condensed-drone-transparent.png" border="0" />
  </picture>
</p>

<h1 align="center">
  <img src="https://i.ibb.co/MykL5LDX/concept-d-drone.png" alt="concept-d-drone" width="92"
       style="vertical-align: middle; margin-right: 12px;" border="0" />
  HIVE-MIND
</h1>

<p align="center">
  🌐 <b><a href="README.md">English</a></b> | <b><a href="README.fr.md">Français</a></b>
</p>

<p align="center">
  <a href="#architecture">
    <img src="https://img.shields.io/badge/Architecture-→-00B4D8?style=flat-square" alt="Architecture" />
  </a>
  <a href="#live-demonstration">
    <img src="https://img.shields.io/badge/Demo-→-00B4D8?style=flat-square" alt="Demo" />
  </a>
  <a href="#capabilities">
    <img src="https://img.shields.io/badge/Capabilities-→-00B4D8?style=flat-square" alt="Capabilities" />
  </a>
  <a href="#how-it-works">
    <img src="https://img.shields.io/badge/Workflow-→-00B4D8?style=flat-square" alt="Workflow" />
  </a>
  <a href="#providers">
    <img src="https://img.shields.io/badge/Providers-→-00B4D8?style=flat-square" alt="Providers" />
  </a>
  <a href="#quick-start">
    <img src="https://img.shields.io/badge/Quick_Start-→-8B5CF6?style=flat-square" alt="Quick Start" />
  </a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Version-1.0.0-0D1117?style=flat-square&labelColor=0D1117&color=3FB950" alt="Version" />
  <img src="https://img.shields.io/badge/TypeScript-7.0.2-0D1117?style=flat-square&labelColor=0D1117&color=3178C6&logo=typescript&logoColor=white" alt="TypeScript 7.0.2" />
  <img src="https://img.shields.io/badge/Node.js-22+-0D1117?style=flat-square&labelColor=0D1117&color=3FB950&logo=node.js&logoColor=white" alt="Node 22+" />
  <img src="https://img.shields.io/badge/Rust-1.81+-0D1117?style=flat-square&labelColor=0D1117&color=DEA584&logo=rust&logoColor=white" alt="Rust 1.81+" />
  <img src="https://img.shields.io/badge/License-Apache--2.0-0D1117?style=flat-square&labelColor=0D1117&color=F0883E" alt="Apache 2.0" />
</p>

---

### The Philosophy: Why HIVE-MIND?

Modern LLM deployments look strong in demos yet fail in the wild — not because models lack capability, but because the harness around them is thin. A stateless prompt loop cannot remember, cannot budget, cannot coordinate, and cannot recover from a tool error without human help. The model is naked without the harness; a harness without a model is dead.

**HIVE-MIND** was engineered to invert that hierarchy. It treats the harness itself as the primary artifact — a research testbed where every seam is measurable. Five strict layers, twenty-six extractable subsystems, eight provider families and five channels are not features but instruments for asking: what scaffolding actually makes a model better at tasks it was never trained to do?

The mechanism is selective wiring, not context stuffing. A sandboxed PTC VM that saves 80–95% of tokens, a hash-anchored Myers reconciler that eliminates drift, an AST skeleton that cuts 90% of code context, a two-tier memory with Ebbinghaus forgetting, and a Smart Router that rotates quotas with zero 429s. **HIVE-MIND** exists to prove, instrument and iterate on that hypothesis in public, as an experimental harness.

---

## <picture><source media="(prefers-color-scheme: dark)" srcset="https://api.iconify.design/lucide:boxes.svg?color=%23f0f6fc"><source media="(prefers-color-scheme: light)" srcset="https://api.iconify.design/lucide:boxes.svg?color=%231f2328"><img src="https://api.iconify.design/lucide:boxes.svg?color=%231f2328" alt="" width="28" height="28" style="vertical-align: middle; margin-right: 8px;" /></picture> Architecture

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://gist.githubusercontent.com/personnal-agent/d1e41f637008a6b5146e444ff1a94a8b/raw/3_dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="https://gist.githubusercontent.com/personnal-agent/d1e41f637008a6b5146e444ff1a94a8b/raw/3.svg">
    <img alt="HIVE-MIND Architecture" src="https://gist.githubusercontent.com/personnal-agent/d1e41f637008a6b5146e444ff1a94a8b/raw/3_dark.svg" width="100%">
  </picture>
</p>

HIVE-MIND is a **strict five-layer harness** with one-way dependency: each layer talks only to its immediate neighbours, no skips. The decomposition into 26 subsystems is formally audited in [`ARCHITECTURE.md`](ARCHITECTURE.md) with Martin instability metrics.

| Layer | Role | Core Components |
| :--- | :--- | :--- |
| **Transport** | Unified ingress / egress | WhatsApp (Baileys), Discord, Telegram, CLI, TUI WebSocket :5001 |
| **Orchestration** | ReAct loop, IoC, scheduling | BotCore, ServiceContainer, FairnessQueue, BlueprintManager, Planner, PTC VM |
| **Runtime** | Safety &amp; cost governance | VIGIL, Ralph, ConstraintManifold, ContextWindowService |
| **Cognitive** | Hierarchical memory | Redis L1 &lt;50ms, Supabase pgvector L2, MAPLE, HNSW |
| **Smart Router** | Model routing | Layer 1 SmartLayer (quota rotation, circuit breakers), Layer 0 ExecutionLayer (8 adapters) |

---

## <picture><source media="(prefers-color-scheme: dark)" srcset="https://api.iconify.design/lucide:sparkles.svg?color=%23f0f6fc"><source media="(prefers-color-scheme: light)" srcset="https://api.iconify.design/lucide:sparkles.svg?color=%231f2328"><img src="https://api.iconify.design/lucide:sparkles.svg?color=%231f2328" alt="" width="28" height="28" style="vertical-align: middle; margin-right: 8px;" /></picture> Live Demonstration

Soon.

---

## <picture><source media="(prefers-color-scheme: dark)" srcset="https://api.iconify.design/lucide:puzzle.svg?color=%23f0f6fc"><source media="(prefers-color-scheme: light)" srcset="https://api.iconify.design/lucide:puzzle.svg?color=%231f2328"><img src="https://api.iconify.design/lucide:puzzle.svg?color=%231f2328" alt="" width="28" height="28" style="vertical-align: middle; margin-right: 8px;" /></picture> Capabilities

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://gist.githubusercontent.com/personnal-agent/d1e41f637008a6b5146e444ff1a94a8b/raw/2_dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="https://gist.githubusercontent.com/personnal-agent/d1e41f637008a6b5146e444ff1a94a8b/raw/2.svg">
    <img alt="HIVE-MIND Capabilities" src="https://gist.githubusercontent.com/personnal-agent/d1e41f637008a6b5146e444ff1a94a8b/raw/2_dark.svg" width="100%">
  </picture>
</p>

Twenty-six subsystems, each **extractable, independently testable and documented** with its own Diátaxis page in [`documentation/`](documentation/).

<details>
<summary><b><picture><source media="(prefers-color-scheme: dark)" srcset="https://api.iconify.design/lucide:puzzle.svg?color=%23f0f6fc"><source media="(prefers-color-scheme: light)" srcset="https://api.iconify.design/lucide:puzzle.svg?color=%231f2328"><img src="https://api.iconify.design/lucide:puzzle.svg?color=%231f2328" alt="" width="18" style="vertical-align: middle; margin-right: 6px;" /></picture> Domain map — expand for SS-01 to SS-26</b></summary>

| Domain | Subsystems | Responsibility |
| :--- | :--- | :--- |
| **01 Core &amp; Concurrency** | SS-01 → SS-09 | ServiceContainer (I=0.00), FairnessQueue DRR, SwarmDispatcher, BlueprintManager, EventBus, Planner DAG, SubAgentEngine, PTC VM, PermissionManager |
| **02 Model Intelligence** | SS-10 → SS-14 | ExecutionLayer, ParamConverter pivot↔wire, SmartLayer, OAuth PKCE, Voice (Live/STT/TTS) |
| **03 Gateways &amp; IPC** | SS-15 → SS-17 | Universal TransportInterface, TuiServer WS IPC, CLI Auth Wizard |
| **04 Memory &amp; Cognition** | SS-18 → SS-20 | Multi-Tier Memory L1/L2, MAPLE Ebbinghaus, Local HNSW Media DB |
| **05 Runtime Safety** | SS-21 → SS-26 | VIGIL + Ralph, Tiered Context, Hash-Anchored Edit (FNV-1a Myers), AST Tree-Sitter, Plugin Pipeline, SafeFs |

</details>

---

## <picture><source media="(prefers-color-scheme: dark)" srcset="https://api.iconify.design/lucide:workflow.svg?color=%23f0f6fc"><source media="(prefers-color-scheme: light)" srcset="https://api.iconify.design/lucide:workflow.svg?color=%231f2328"><img src="https://api.iconify.design/lucide:workflow.svg?color=%231f2328" alt="" width="28" height="28" style="vertical-align: middle; margin-right: 8px;" /></picture> How It Works

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://gist.githubusercontent.com/personnal-agent/d1e41f637008a6b5146e444ff1a94a8b/raw/1_dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="https://gist.githubusercontent.com/personnal-agent/d1e41f637008a6b5146e444ff1a94a8b/raw/1.svg">
    <img alt="HIVE-MIND Workflow" src="https://gist.githubusercontent.com/personnal-agent/d1e41f637008a6b5146e444ff1a94a8b/raw/1_dark.svg" width="100%">
  </picture>
</p>

From a normalized `NormalizedMessage` to a delivered answer, the harness executes a closed loop: queue fairly, hydrate selectively, route intelligently, think with tools, validate both pre- and post-action, then persist only what matters.

| Step | Harness Action | Key Code |
| :--- | :--- | :--- |
| 1 | Normalize ingress | `TransportInterface` → `NormalizedMessage` (`src/core/transport/`) |
| 2 | Schedule fairly | `FairnessQueue.ts` DRR + VIP sub-queues |
| 3 | Hydrate context | `tieredContextLoader.ts` + `ContextWindowService.ts` with Ebbinghaus `0.4·e^{-t/τ}` |
| 4 | Route model | `SmartLayer.ts` → `ExecutionLayer.ts` (8 adapters, zero-429) |
| 5 | ReAct loop ×10 | `BotCore.ts` + `SubAgentEngine.ts` (fork/fresh) |
| 6 | Execute tools | `PTC ProgrammaticExecutor.ts` in `vm` + Acorn validation |
| 7 | Guard | `VIGIL` pre-action + `Ralph` post-audit + `λ=(cost/budget)^4` |
| 8 | Persist | `workingMemory.ts` (Redis) + `SemanticMemory.ts` (pgvector HNSW) |
| 9 | Deliver | `Transport.sendResponse()` to source channel |

---

## <picture><source media="(prefers-color-scheme: dark)" srcset="https://api.iconify.design/lucide:cpu.svg?color=%23f0f6fc"><source media="(prefers-color-scheme: light)" srcset="https://api.iconify.design/lucide:cpu.svg?color=%231f2328"><img src="https://api.iconify.design/lucide:cpu.svg?color=%231f2328" alt="" width="28" height="28" style="vertical-align: middle; margin-right: 8px;" /></picture> Providers

The two-layer Smart Router coordinates **8 native adapter families** and **22+ dynamic endpoints** via a decoupled pivot. Layer 1 executes resilient stateful dispatch (6-window circuit breakers, P50 latency scoring, zero-429 rotation, SSE stream lock); Layer 0 manages stateless wire transformation (`ProtocolFamily` $\times$ `HeaderFamily`, reasoning budgets, typed errors).

| Provider / Family | Implementation | Wire Protocol | Key Capabilities | Technical Features |
| :--- | :--- | :--- | :--- | :--- |
| **OpenAI** | Native (`openai.ts`) | `openai-compatible` (`/v1/chat/completions`) | Chat, Tool Calling, Vision, Reasoning Effort | Native `max_completion_tokens` and `reasoning_effort` handling, embeddings |
| **Google Gemini** | Native (`gemini.ts`) | `gemini-native` (`generateContent`) | Multimodal (Text, Image, Audio), Thinking Budget | Multipart structure, `thought_signature` preservation, `systemInstruction` |
| **Anthropic Claude** | Native (`anthropic.ts`) | `anthropic-compatible` (`/v1/messages`) | Extended Thinking, Tool Calling, Prompt Caching | Root `system` extraction, `input_schema` map, thinking budget bounds check |
| **Groq Cloud** | Native (`groq.ts`) | `openai-compatible` (`/openai/v1`) | Ultra-fast LPU, Tool Calling, Server Tools | Groq Compound `executed_tools`, `usage_breakdown`, header versioning |
| **Cohere** | Native (`cohere.ts`) | `cohere-v2` (`/v2/chat`) | Structured Content, Tool Calling | Top-level `system` separation, typed content chunks, usage normalization |
| **Cloudflare AI** | Native (`cloudflare.ts`) | `cloudflare-v1` (`/ai/v1/chat/completions`) | Serverless Inference &amp; Tool Calling | Composite key `account_id:api_token`, `{ result }` unwrapping, array errors |
| **Hugging Face** | Native (`huggingface.ts`) | `openai-compatible` (`router.huggingface.co`) | Open-Source Hub Models | Official SDK routing wrapper, autonomous credentials init, 429 handler |
| **Modal** | Native (`modal.ts`) | `openai-compatible` (`{appUrl}/v1`) | Custom GPU Serverless Containers | Dynamic base URL from model ID, 120s extended timeout for cold starts |
| **OAuth Specializations** | Headless (`codex.ts`, `antigravity.ts`) | Direct SSE / Cloud Code REST API | OAuth2 PKCE / Local OAuth Session | Token refresh (&lt;300s), Clearcut telemetry simulation, TLS impersonation |
| **Dynamic Providers** | Generic (`GenericAdapter.ts`) | `openai-compatible` / `standard-token` | 22+ Ecosystem Providers (Mistral, NIM, etc.) | Tool ID 9-char sanitization, `reasoning_content` relay, passthrough options |

---

## <picture><source media="(prefers-color-scheme: dark)" srcset="https://api.iconify.design/lucide:radio.svg?color=%23f0f6fc"><source media="(prefers-color-scheme: light)" srcset="https://api.iconify.design/lucide:radio.svg?color=%231f2328"><img src="https://api.iconify.design/lucide:radio.svg?color=%231f2328" alt="" width="28" height="28" style="vertical-align: middle; margin-right: 8px;" /></picture> Channels &amp; Transports

| Channel | Status | Transport File | Notes |
| :--- | :--- | :--- | :--- |
| **WhatsApp** | ![Active](https://img.shields.io/badge/Active-3FB950?style=flat-square) | `baileys.ts` | Multi-device, media, stickers, voice |
| **Discord** | ![Active](https://img.shields.io/badge/Active-3FB950?style=flat-square) | `discord.ts` | Guilds, DMs |
| **Telegram** | ![Active](https://img.shields.io/badge/Active-3FB950?style=flat-square) | `telegram.ts` | Groups, inline bots |
| **CLI** | ![Active](https://img.shields.io/badge/Active-3FB950?style=flat-square) | `cli.ts` | Full interactive UX |
| **TUI Server** | ![Active](https://img.shields.io/badge/Active-3FB950?style=flat-square) | `TuiServerTransport.ts` | Loopback WS :5001 (default, auto-increments if busy; see `tui-connection.json`) |

---

## <picture><source media="(prefers-color-scheme: dark)" srcset="https://api.iconify.design/lucide:rocket.svg?color=%23f0f6fc"><source media="(prefers-color-scheme: light)" srcset="https://api.iconify.design/lucide:rocket.svg?color=%231f2328"><img src="https://api.iconify.design/lucide:rocket.svg?color=%231f2328" alt="" width="28" height="28" style="vertical-align: middle; margin-right: 8px;" /></picture> Quick Start

> **Note** — HIVE-MIND is an **experimental research harness**, not a product. Interfaces are unstable and may change without notice.

<details>
<summary><b><picture><source media="(prefers-color-scheme: dark)" srcset="https://api.iconify.design/lucide:rocket.svg?color=%23f0f6fc"><source media="(prefers-color-scheme: light)" srcset="https://api.iconify.design/lucide:rocket.svg?color=%231f2328"><img src="https://api.iconify.design/lucide:rocket.svg?color=%231f2328" alt="" width="18" style="vertical-align: middle; margin-right: 6px;" /></picture> 1 — Clone &amp; Install (Node 22+ required)</b></summary>

```bash
# Clone the harness
git clone https://github.com/leandre755/HIVE-MIND.git
cd HIVE-MIND

# Install dependencies
npm install
```

</details>

<details>
<summary><b><picture><source media="(prefers-color-scheme: dark)" srcset="https://api.iconify.design/lucide:key.svg?color=%23f0f6fc"><source media="(prefers-color-scheme: light)" srcset="https://api.iconify.design/lucide:key.svg?color=%231f2328"><img src="https://api.iconify.design/lucide:key.svg?color=%231f2328" alt="" width="18" style="vertical-align: middle; margin-right: 6px;" /></picture> 2 — Configure Environment</b></summary>

```bash
# Copy the template and fill at least one LLM key + Supabase + Redis
cp .env.example .env
nano .env
```

</details>

<details>
<summary><b><picture><source media="(prefers-color-scheme: dark)" srcset="https://api.iconify.design/lucide:terminal.svg?color=%23f0f6fc"><source media="(prefers-color-scheme: light)" srcset="https://api.iconify.design/lucide:terminal.svg?color=%231f2328"><img src="https://api.iconify.design/lucide:terminal.svg?color=%231f2328" alt="" width="18" style="vertical-align: middle; margin-right: 6px;" /></picture> 3 — Launch the Harness</b></summary>

```bash
# Interactive startup menu — channel auth + provider selection
npm start

# Watch mode — auto-restart on source change
npm run dev
```

</details>

<details>
<summary><b><picture><source media="(prefers-color-scheme: dark)" srcset="https://api.iconify.design/lucide:check-circle-2.svg?color=%23f0f6fc"><source media="(prefers-color-scheme: light)" srcset="https://api.iconify.design/lucide:check-circle-2.svg?color=%231f2328"><img src="https://api.iconify.design/lucide:check-circle-2.svg?color=%231f2328" alt="" width="18" style="vertical-align: middle; margin-right: 6px;" /></picture> 4 — Verify (build + lint + tests)</b></summary>

```bash
# 77 suites — 834 unit tests
npm run test:unit

# Full local verification gate
npm run build && npm run lint:fast && npm run test:unit
```

</details>

---

## <picture><source media="(prefers-color-scheme: dark)" srcset="https://api.iconify.design/lucide:folder-tree.svg?color=%23f0f6fc"><source media="(prefers-color-scheme: light)" srcset="https://api.iconify.design/lucide:folder-tree.svg?color=%231f2328"><img src="https://api.iconify.design/lucide:folder-tree.svg?color=%231f2328" alt="" width="28" height="28" style="vertical-align: middle; margin-right: 8px;" /></picture> Project Structure

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://i.ibb.co/gLrbpqN0/Image-Codex-19-sept-2026-21-05-01.png">
    <source media="(prefers-color-scheme: light)" srcset="https://i.ibb.co/m5J3YmfB/Image-Codex-19-sept-2026-21-08-21.png">
    <img alt="Project Structure" src="https://i.ibb.co/gLrbpqN0/Image-Codex-19-sept-2026-21-05-01.png" width="100%" style="border-radius: 10px;" />
  </picture>
</p>

---

## <picture><source media="(prefers-color-scheme: dark)" srcset="https://api.iconify.design/lucide:shield-check.svg?color=%23f0f6fc"><source media="(prefers-color-scheme: light)" srcset="https://api.iconify.design/lucide:shield-check.svg?color=%231f2328"><img src="https://api.iconify.design/lucide:shield-check.svg?color=%231f2328" alt="" width="28" height="28" style="vertical-align: middle; margin-right: 8px;" /></picture> Validation

| Command | Purpose | Gate |
| :--- | :--- | :--- |
| `npm run build` | TypeScript 7.0.2 `tsc --noEmit` | 0 errors on 334 files |
| `npm run lint:fast` | Oxlint, 96 rules, 4 threads | 0 warnings |
| `npm run lint:arch` | dependency-cruiser boundaries | 0 violations |
| `npm run test:unit` | Jest, 77 suites | 834 / 834 passing |
| `npm run test:integration` | 5 suites | 34 / 34 passing |
| `npm audit` | High/Moderate CVEs + GPL-2.0 deny | 0 vulnerabilities |

---

## <picture><source media="(prefers-color-scheme: dark)" srcset="https://api.iconify.design/lucide:lock.svg?color=%23f0f6fc"><source media="(prefers-color-scheme: light)" srcset="https://api.iconify.design/lucide:lock.svg?color=%231f2328"><img src="https://api.iconify.design/lucide:lock.svg?color=%231f2328" alt="" width="28" height="28" style="vertical-align: middle; margin-right: 8px;" /></picture> Security

See [`SECURITY.md`](SECURITY.md).
