<!-- markdownlint-disable-file MD041 --> <!-- markdownlint-disable-file MD041 --> <!-- markdownlint-disable-file MD041 --> <!-- BLOCK 1: Static Landscape Hero (1280x640, 16:9, border-radius 8px) -->
<p align="center">
  <img src="https://files.catbox.moe/b3i12u.png" alt="HIVE-MIND — The Omni-Source Harness for LLM Agents"
       width="100%" style="border-radius: 8px;" />
</p>

<!-- BLOCK 2: Title + Transparent Logo (512x512 No-BG) -->
<h1 align="center">
  <img src="https://files.catbox.moe/uq7jny.png" alt="HIVE-MIND Logo" width="92"
       style="vertical-align: middle; margin-right: 12px; border-radius: 8px;" />
  HIVE-MIND
</h1>

<!-- BLOCK 3: Language Switcher -->
<p align="center">
  🌐 <b><a href="README.md">English</a></b> | <b><a href="README.fr.md">Français</a></b>
</p>

<!-- BLOCK 4: Navigation Badges (primary #F59E0B, flat-square, arrow →) -->
<p align="center">
  <a href="#architecture">
    <img src="https://img.shields.io/badge/Architecture-→-F59E0B?style=flat-square" alt="Architecture" />
  </a>
  <a href="#capabilities">
    <img src="https://img.shields.io/badge/Capabilities-→-F59E0B?style=flat-square" alt="Capabilities" />
  </a>
  <a href="#how-it-works">
    <img src="https://img.shields.io/badge/Workflow-→-F59E0B?style=flat-square" alt="Workflow" />
  </a>
  <a href="#providers">
    <img src="https://img.shields.io/badge/Providers-→-F59E0B?style=flat-square" alt="Providers" />
  </a>
  <a href="#quick-start">
    <img src="https://img.shields.io/badge/Quick_Start-→-F97316?style=flat-square" alt="Quick Start" />
  </a>
  <a href="#live-demonstration">
    <img src="https://img.shields.io/badge/Demo-→-F97316?style=flat-square" alt="Demo" />
  </a>
</p>

<!-- BLOCK 5: Metadata Badges (labelColor #0D1117) -->
<p align="center">
  <img src="https://img.shields.io/badge/Version-1.0.0-0D1117?style=flat-square&labelColor=0D1117&color=3FB950" alt="Version" />
  <img src="https://img.shields.io/badge/TypeScript-Strict-0D1117?style=flat-square&labelColor=0D1117&color=3178C6&logo=typescript&logoColor=white" alt="TypeScript Strict" />
  <img src="https://img.shields.io/badge/Node.js-22+-0D1117?style=flat-square&labelColor=0D1117&color=3FB950&logo=node.js&logoColor=white" alt="Node 22+" />
  <img src="https://img.shields.io/badge/License-Apache--2.0-0D1117?style=flat-square&labelColor=0D1117&color=F0883E" alt="Apache 2.0" />
  <img src="https://img.shields.io/badge/Harness-Experimental-0D1117?style=flat-square&labelColor=0D1117&color=F59E0B" alt="Experimental Harness" />
</p>

---

### The Philosophy: Why HIVE-MIND?

Modern LLM deployments look strong in demos yet fail in the wild — not because models lack capability, but because the harness around them is thin. A stateless prompt loop cannot remember, cannot budget, cannot coordinate, and cannot recover from a tool error without human help. The model is naked without the harness; a harness without a model is dead.

**HIVE-MIND** was engineered to invert that hierarchy. It treats the harness itself as the primary artifact — a research testbed where every seam is measurable. Five strict layers, twenty-six extractable subsystems, eight provider families and five channels are not features but instruments for asking: what scaffolding actually makes a model better at tasks it was never trained to do?

The mechanism is selective wiring, not context stuffing. A sandboxed PTC VM that saves 80–95% of tokens, a hash-anchored Myers reconciler that eliminates drift, an AST skeleton that cuts 90% of code context, a two-tier memory with Ebbinghaus forgetting, and a Smart Router that rotates quotas with zero 429s. **HIVE-MIND** exists to prove, instrument and iterate on that hypothesis in public, as an experimental harness.

---

## <img src="https://cdn.jsdelivr.net/gh/withxat/fluentui-emoji-unicode@webp/assets/1f3d7_3d.webp" alt="" width="28" height="28" style="vertical-align: middle; margin-right: 8px;" /> Architecture

HIVE-MIND is a **strict five-layer harness** with one-way dependency: each layer talks only to its immediate neighbours, no skips. The decomposition into 26 subsystems is formally audited in [`ARCHITECTURE.md`](ARCHITECTURE.md) with Martin instability metrics.

<p align="center">
  <img src="https://files.catbox.moe/zhthbm.svg" alt="HIVE-MIND Five-Layer Harness"
       width="100%" style="border-radius: 12px;" />
</p>

| Layer | Role | Core Components |
| :--- | :--- | :--- |
| **Transport** | Unified ingress / egress | WhatsApp (Baileys), Discord, Telegram, CLI, TUI WebSocket :5001 |
| **Orchestration** | ReAct loop, IoC, scheduling | BotCore, ServiceContainer, FairnessQueue, BlueprintManager, Planner, PTC VM |
| **Runtime** | Safety & cost governance | VIGIL, Ralph, ConstraintManifold, ContextWindowService |
| **Cognitive** | Hierarchical memory | Redis L1 <50ms, Supabase pgvector L2, MAPLE, HNSW |
| **Smart Router** | Model routing | Layer 1 SmartLayer (quota rotation, circuit breakers), Layer 0 ExecutionLayer (8 adapters) |

---

## <img src="https://cdn.jsdelivr.net/gh/withxat/fluentui-emoji-unicode@webp/assets/1f9e9_3d.webp" alt="" width="28" height="28" style="vertical-align: middle; margin-right: 8px;" /> Capabilities

Twenty-six subsystems, each **extractable, independently testable and documented** with its own Diátaxis page in [`documentation/`](documentation/). The board below is editorial — amber on `#0D1117`, 12px radius, balanced 16:9 geometry.

<p align="center">
  <img src="https://files.catbox.moe/5gutop.svg" alt="HIVE-MIND 26 Subsystems Board"
       width="100%" style="border-radius: 12px;" />
</p>

<details>
<summary><b><img src="https://cdn.jsdelivr.net/gh/withxat/fluentui-emoji-unicode@webp/assets/1f9e9_3d.webp" alt="" width="18" style="vertical-align: middle; margin-right: 6px;" /> Domain map — expand for SS-01 to SS-26</b></summary>

| Domain | Subsystems | Responsibility |
| :--- | :--- | :--- |
| **01 Core & Concurrency** | SS-01 → SS-09 | ServiceContainer (I=0.00), FairnessQueue DRR, SwarmDispatcher, BlueprintManager, EventBus, Planner DAG, SubAgentEngine, PTC VM, PermissionManager |
| **02 Model Intelligence** | SS-10 → SS-14 | ExecutionLayer, ParamConverter pivot↔wire, SmartLayer, OAuth PKCE, Voice (Live/STT/TTS) |
| **03 Gateways & IPC** | SS-15 → SS-17 | Universal TransportInterface, TuiServer WS IPC, CLI Auth Wizard |
| **04 Memory & Cognition** | SS-18 → SS-20 | Multi-Tier Memory L1/L2, MAPLE Ebbinghaus, Local HNSW Media DB |
| **05 Runtime Safety** | SS-21 → SS-26 | VIGIL + Ralph, Tiered Context, Hash-Anchored Edit (FNV-1a Myers), AST Tree-Sitter, Plugin Pipeline, SafeFs |

</details>

---

## <img src="https://cdn.jsdelivr.net/gh/withxat/fluentui-emoji-unicode@webp/assets/2699_3d.webp" alt="" width="28" height="28" style="vertical-align: middle; margin-right: 8px;" /> How It Works

From a normalized `NormalizedMessage` to a delivered answer, the harness executes a closed loop: queue fairly, hydrate selectively, route intelligently, think with tools, validate both pre- and post-action, then persist only what matters. The diagram below is a compact landscape (1280×520) exported from hand-crafted SVG — zero raw Mermaid in markdown.

<p align="center">
  <img src="https://files.catbox.moe/aa8urv.svg" alt="HIVE-MIND How It Works — ReAct loop"
       width="100%" style="border-radius: 12px;" />
</p>

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

---

## <img src="https://cdn.jsdelivr.net/gh/withxat/fluentui-emoji-unicode@webp/assets/1f916_3d.webp" alt="" width="28" height="28" style="vertical-align: middle; margin-right: 8px;" /> Providers

The two-layer Smart Router speaks **8 provider families** through a unified pivot. Layer 1 rotates keys and tiers with sliding-window circuit breakers; Layer 0 adapts `GenerationParams` to each wire protocol.

| Provider | Protocol Family | Strength |
| :--- | :--- | :--- |
| **Google Gemini** | Native Gemini | Multimodal, 2M context, Live audio |
| **Anthropic Claude** | Anthropic | Extended thinking, tool use |
| **OpenAI** | OpenAI-compatible | GPT-4o, o3, vision |
| **Groq** | OpenAI-compatible | 300+ tok/s |
| **Cohere** | Cohere native | Command R+, RAG |
| **Cloudflare AI** | Workers AI | Edge inference |
| **HuggingFace** | HF Inference | Open-source |
| **Codex / Gemini CLI** | OAuth PKCE | Personal free-tier via headless CLI |

---

## <img src="https://cdn.jsdelivr.net/gh/withxat/fluentui-emoji-unicode@webp/assets/1f4e1_3d.webp" alt="" width="28" height="28" style="vertical-align: middle; margin-right: 8px;" /> Channels & Transports

| Channel | Status | Transport File | Notes |
| :--- | :--- | :--- | :--- |
| **WhatsApp** | ![Active](https://img.shields.io/badge/Active-3FB950?style=flat-square) | `baileys.ts` | Multi-device, media, stickers, voice |
| **Discord** | ![Active](https://img.shields.io/badge/Active-3FB950?style=flat-square) | `discord.ts` | Guilds, DMs |
| **Telegram** | ![Active](https://img.shields.io/badge/Active-3FB950?style=flat-square) | `telegram.ts` | Groups, inline bots |
| **CLI** | ![Active](https://img.shields.io/badge/Active-3FB950?style=flat-square) | `cli.ts` | Full interactive UX |
| **TUI Server** | ![Active](https://img.shields.io/badge/Active-3FB950?style=flat-square) | `TuiServerTransport.ts` | Loopback WS :5001 (default, auto-increments if busy; see `tui-connection.json`) |

---

## <img src="https://cdn.jsdelivr.net/gh/withxat/fluentui-emoji-unicode@webp/assets/1f680_3d.webp" alt="" width="28" height="28" style="vertical-align: middle; margin-right: 8px;" /> Quick Start

> **Note** — HIVE-MIND is an **experimental research harness**, not a product. Interfaces are unstable and may change without notice.

<details>
<summary><b><img src="https://cdn.jsdelivr.net/gh/withxat/fluentui-emoji-unicode@webp/assets/1f680_3d.webp" alt="" width="18" style="vertical-align: middle; margin-right: 6px;" /> 1 — Clone & Install (Node 22+ required)</b></summary>

```bash
# Clone the harness
git clone https://github.com/leandre755/HIVE-MIND.git
cd HIVE-MIND

# Install dependencies
npm install
```

</details>

<details>
<summary><b><img src="https://cdn.jsdelivr.net/gh/withxat/fluentui-emoji-unicode@webp/assets/1f4c1_3d.webp" alt="" width="18" style="vertical-align: middle; margin-right: 6px;" /> 2 — Configure Environment</b></summary>

```bash
# Copy the template and fill at least one LLM key + Supabase + Redis
cp .env.example .env
nano .env
```

</details>

<details>
<summary><b><img src="https://cdn.jsdelivr.net/gh/withxat/fluentui-emoji-unicode@webp/assets/2699_3d.webp" alt="" width="18" style="vertical-align: middle; margin-right: 6px;" /> 3 — Launch the Harness</b></summary>

```bash
# Interactive startup menu — channel auth + provider selection
npm start

# Watch mode — auto-restart on source change
npm run dev
```

</details>

<details>
<summary><b><img src="https://cdn.jsdelivr.net/gh/withxat/fluentui-emoji-unicode@webp/assets/2705_3d.webp" alt="" width="18" style="vertical-align: middle; margin-right: 6px;" /> 4 — Verify (build + lint + tests)</b></summary>

```bash
# 73 suites — 595 unit tests
npm run test:unit

# Full local gate
npm run build && npm run lint:fast && npm run test:unit
```

</details>

---

## <img src="https://cdn.jsdelivr.net/gh/withxat/fluentui-emoji-unicode@webp/assets/1f4c1_3d.webp" alt="" width="28" height="28" style="vertical-align: middle; margin-right: 8px;" /> Project Structure

```text
hive-mind/
├── src/
│   ├── bin/              # daemon entry — hive-mind.ts
│   ├── cli/              # startupMenu, whatsappAuthHelper, authSessionManager
│   ├── config/           # Zod schemas, pricing, keyResolver, blueprints
│   ├── core/             # BotCore, ServiceContainer, FairnessQueue, transports
│   ├── persona/          # system prompts + lessons_learned.md
│   ├── plugins/          # modular tools (manifest Zod-validated)
│   ├── providers/        # Layer0 ExecutionLayer + Layer1 SmartLayer + families
│   ├── scheduler/        # node-cron + dbMonitoring
│   ├── services/         # memory L1/L2, agentic Planner/SubAgent, PTC VM, runtime
│   ├── supabase/         # SQL migrations, pgvector match_* functions
│   └── utils/            # safeFs.ts, pidLock, TlsImpersonator, toolExecution
├── documentation/        # 97 Diátaxis docs (core/providers/transport/memory/runtime/plugins)
├── src/tests/
│   ├── unit/             # 73 suites — core/providers/runtime/services
│   ├── integration/      # 5 suites, 34 tests
│   └── e2e/              # harness + WebSocket cross-process
├── .GCC/                 # Git-Context-Controller session state
└── .gouvernance/         # review-policy, accompanied-agent, governance
```

---

## <img src="https://cdn.jsdelivr.net/gh/withxat/fluentui-emoji-unicode@webp/assets/2705_3d.webp" alt="" width="28" height="28" style="vertical-align: middle; margin-right: 8px;" /> Validation

| Command | Purpose | Gate |
| :--- | :--- | :--- |
| `npm run build` | TypeScript strict `tsc --noEmit` | 0 errors on 330 files |
| `npm run lint:fast` | Oxlint, 96 rules, 4 threads | 0 warnings |
| `npm run lint:arch` | dependency-cruiser boundaries | 0 violations |
| `npm run test:unit` | Jest, 73 suites | 595 / 595 passing |
| `npm run test:integration` | 5 suites | 34 / 34 passing |
| `npm audit` | High/Moderate CVEs + GPL-2.0 deny | 0 vulnerabilities |

---

## <img src="https://cdn.jsdelivr.net/gh/withxat/fluentui-emoji-unicode@webp/assets/1f9e0_3d.webp" alt="" width="28" height="28" style="vertical-align: middle; margin-right: 8px;" /> Live Demonstration

Animated media is reserved for concrete proof of execution. Below is the editorial teaser (GIF, 1280×480, 24 frames) — the static hero stays static by design.

<p align="center">
  <img src="https://files.catbox.moe/g6t6vt.gif" alt="HIVE-MIND harness — terminal teaser"
       width="100%" style="border-radius: 8px;" />
</p>

> Teaser loop: `npm start` → harness boots → transports connect → ReAct ×10 → memory persists → WS streams to TUI. Replace with your own screen capture for proof of work.

---

## <img src="https://cdn.jsdelivr.net/gh/withxat/fluentui-emoji-unicode@webp/assets/1f91d_3d.webp" alt="" width="28" height="28" style="vertical-align: middle; margin-right: 8px;" /> Contributing

All non-trivial work ships through **Pull Requests only**. An agent never approves its own code.

- Read [`AGENTS.md`](AGENTS.md) — mandatory rules for every agent and human
- Read [`ARCHITECTURE.md`](ARCHITECTURE.md) — layer blueprint and 26 SS boundaries
- Read [`.gouvernance/review-policy.md`](.gouvernance/review-policy.md) — Strict Review, dual-layer defense, acceptance gates

```bash
# Branch naming — Conventional Commits enforced at pre-commit
git checkout -b feat/my-feature
git checkout -b fix/issue-description

# PR budget: ≤1000 lines warning, 2500 hard limit (docs/assets excluded)
```

---

## <img src="https://cdn.jsdelivr.net/gh/withxat/fluentui-emoji-unicode@webp/assets/1f6e1_3d.webp" alt="" width="28" height="28" style="vertical-align: middle; margin-right: 8px;" /> Security

Private disclosure only — never via public issues. See [`SECURITY.md`](SECURITY.md).

- Every filesystem access goes through [`src/utils/safeFs.ts`](src/utils/safeFs.ts) (`resolveWithinRoot` traversal-safe)
- Secrets are scanned on every commit and push via `gitleaks` (staged + full history), `ALLOW_CONFIG_EDIT=1` for protected files
- `ALLOW_CONFIG_EDIT=1 git commit` is the only authorized path for `package.json`, `.githooks/` etc. — `--no-verify` stays forbidden

---

<p align="center">
  <sub>
    HIVE-MIND is an experimental research harness — the scaffolding is the artifact.<br/>
    Editorial premium — amber <code>#F59E0B</code> · orange <code>#F97316</code> on <code>#0D1117</code> · Fluent 3D icons<br/>
    Apache-2.0 &nbsp;·&nbsp; leandre755 &nbsp;·&nbsp; 2026
  </sub>
</p>
