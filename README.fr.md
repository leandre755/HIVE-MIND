<!-- BLOC 1 : Hero statique paysage (1280×640, 16:9, border-radius 8px) -->
<p align="center">
  <img src="https://files.catbox.moe/b3i12u.png" alt="HIVE-MIND — Le Harnais Omni-Source pour Agents LLM"
       width="100%" style="border-radius: 8px;" />
</p>

<!-- BLOC 2 : Titre + Logo transparent (512×512 No-BG) -->
<h1 align="center">
  <img src="https://files.catbox.moe/uq7jny.png" alt="Logo HIVE-MIND" width="92"
       style="vertical-align: middle; margin-right: 12px; border-radius: 8px;" />
  HIVE-MIND
</h1>

<!-- BLOC 3 : Sélecteur de langue -->
<p align="center">
  🌐 <b><a href="README.md">English</a></b> | <b><a href="README.fr.md">Français</a></b>
</p>

<!-- BLOC 4 : Badges de navigation (primaire #F59E0B, flat-square, flèche →) -->
<p align="center">
  <a href="#architecture">
    <img src="https://img.shields.io/badge/Architecture-→-F59E0B?style=flat-square" alt="Architecture" />
  </a>
  <a href="#capacités">
    <img src="https://img.shields.io/badge/Capacités-→-F59E0B?style=flat-square" alt="Capacités" />
  </a>
  <a href="#comment-ça-marche">
    <img src="https://img.shields.io/badge/Workflow-→-F59E0B?style=flat-square" alt="Workflow" />
  </a>
  <a href="#fournisseurs">
    <img src="https://img.shields.io/badge/Fournisseurs-→-F59E0B?style=flat-square" alt="Fournisseurs" />
  </a>
  <a href="#démarrage-rapide">
    <img src="https://img.shields.io/badge/Démarrage_Rapide-→-F97316?style=flat-square" alt="Démarrage Rapide" />
  </a>
  <a href="#démonstration-live">
    <img src="https://img.shields.io/badge/Démo_Live-→-F97316?style=flat-square" alt="Démo Live" />
  </a>
</p>

<!-- BLOC 5 : Badges de métadonnées (labelColor #0D1117) -->
<p align="center">
  <img src="https://img.shields.io/badge/Version-1.0.0-0D1117?style=flat-square&labelColor=0D1117&color=3FB950" alt="Version" />
  <img src="https://img.shields.io/badge/TypeScript-Strict-0D1117?style=flat-square&labelColor=0D1117&color=3178C6&logo=typescript&logoColor=white" alt="TypeScript Strict" />
  <img src="https://img.shields.io/badge/Node.js-22+-0D1117?style=flat-square&labelColor=0D1117&color=3FB950&logo=node.js&logoColor=white" alt="Node 22+" />
  <img src="https://img.shields.io/badge/Licence-Apache--2.0-0D1117?style=flat-square&labelColor=0D1117&color=F0883E" alt="Apache 2.0" />
  <img src="https://img.shields.io/badge/Harnais-Expérimental-0D1117?style=flat-square&labelColor=0D1117&color=F59E0B" alt="Harnais Expérimental" />
</p>

---

### La Philosophie : Pourquoi HIVE-MIND ?

Les déploiements LLM paraissent solides en démo puis échouent sur le terrain — non parce que les modèles manquent de capacité, mais parce que le harnais qui les entoure est trop mince. Une boucle de prompts sans état ne peut ni se souvenir, ni budgéter, ni se coordonner, ni se relever d’une erreur d’outil sans aide humaine. Le modèle est nu sans le harnais ; un harnais sans modèle est mort.

**HIVE-MIND** a été conçu pour inverser cette hiérarchie. Il traite le harnais lui-même comme l’artefact principal — un banc d’essai de recherche où chaque couture est mesurable. Cinq couches strictes, vingt-six sous-systèmes extractibles, huit familles de fournisseurs et cinq canaux ne sont pas des fonctionnalités mais des instruments pour poser la question : quel échafaudage rend réellement un modèle meilleur sur des tâches qu’il n’a jamais apprises ?

Le mécanisme est le câblage sélectif, pas le bourrage de contexte. Une VM PTC sandboxée qui économise 80–95 % de tokens, un réconciliateur Myers ancré par hash qui élimine la dérive, un squelette AST qui coupe 90 % du contexte de code, une mémoire bicouche à oubli Ebbinghaus, et un Smart Router qui pivote les quotas avec zéro 429. **HIVE-MIND** existe pour prouver, instrumenter et itérer cette hypothèse en public, comme un harnais expérimental.

---

## <img src="https://cdn.jsdelivr.net/gh/withxat/fluentui-emoji-unicode@webp/assets/1f3d7_3d.webp" width="28" height="28" style="vertical-align: middle; margin-right: 8px;" /> Architecture

HIVE-MIND est un **harnais strict à cinq couches** à dépendance unidirectionnelle : chaque couche ne parle qu’à ses voisines immédiates, aucun saut. La décomposition en 26 sous-systèmes est auditée formellement dans [`docs/subsystems_report.pdf`](docs/subsystems_report.pdf) avec les métriques d’instabilité de Martin.

<p align="center">
  <img src="https://files.catbox.moe/zhthbm.svg" alt="Harnais HIVE-MIND cinq couches"
       width="100%" style="border-radius: 12px;" />
</p>

| Couche | Rôle | Composants Clés |
| :--- | :--- | :--- |
| **Transport** | Entrée / sortie unifiée | WhatsApp (Baileys), Discord, Telegram, CLI, TUI WebSocket :5001 |
| **Orchestration** | Boucle ReAct, IoC, ordonnancement | BotCore, ServiceContainer, FairnessQueue, BlueprintManager, Planner, PTC VM |
| **Runtime** | Sécurité & gouvernance coût | VIGIL, Ralph, ConstraintManifold, ContextWindowService |
| **Cognitif** | Mémoire hiérarchique | Redis L1 <50ms, Supabase pgvector L2, MAPLE, HNSW |
| **Smart Router** | Routage modèle | Layer 1 SmartLayer (rotation quota, circuit breakers), Layer 0 ExecutionLayer (8 adaptateurs) |

---

## <img src="https://cdn.jsdelivr.net/gh/withxat/fluentui-emoji-unicode@webp/assets/1f9e9_3d.webp" width="28" height="28" style="vertical-align: middle; margin-right: 8px;" /> Capacités

Vingt-six sous-systèmes, chacun **extractible, testable indépendamment et documenté** avec sa page Diátaxis dans [`documentation/`](documentation/). La planche ci-dessous est éditoriale — ambre sur `#0D1117`, rayon 12px, géométrie 16:9 équilibrée.

<p align="center">
  <img src="https://files.catbox.moe/5gutop.svg" alt="Planche 26 sous-systèmes HIVE-MIND"
       width="100%" style="border-radius: 12px;" />
</p>

<details>
<summary><b><img src="https://cdn.jsdelivr.net/gh/withxat/fluentui-emoji-unicode@webp/assets/1f9e9_3d.webp" width="18" style="vertical-align: middle; margin-right: 6px;" /> Carte des domaines — déplier SS-01 à SS-26</b></summary>

| Domaine | Sous-Systèmes | Responsabilité |
| :--- | :--- | :--- |
| **01 Core & Concurrence** | SS-01 → SS-09 | ServiceContainer (I=0.00), FairnessQueue DRR, SwarmDispatcher, BlueprintManager, EventBus, Planner DAG, SubAgentEngine, PTC VM, PermissionManager |
| **02 Intelligence Modèle** | SS-10 → SS-14 | ExecutionLayer, ParamConverter pivot↔wire, SmartLayer, OAuth PKCE, Voix (Live/STT/TTS) |
| **03 Gateways & IPC** | SS-15 → SS-17 | TransportInterface universel, TuiServer WS IPC, Assistant Auth CLI |
| **04 Mémoire & Cognition** | SS-18 → SS-20 | Mémoire Multi-Tier L1/L2, MAPLE Ebbinghaus, DB HNSW multimodale |
| **05 Runtime Safety** | SS-21 → SS-26 | VIGIL + Ralph, Tiered Context, Hash-Anchored Edit (FNV-1a Myers), AST Tree-Sitter, Plugin Pipeline, SafeFs |

</details>

---

## <img src="https://cdn.jsdelivr.net/gh/withxat/fluentui-emoji-unicode@webp/assets/2699_3d.webp" width="28" height="28" style="vertical-align: middle; margin-right: 8px;" /> Comment Ça Marche

Du `NormalizedMessage` à la réponse livrée, le harnais exécute une boucle fermée : ordonnancer équitablement, hydrater sélectivement, router intelligemment, penser avec des outils, valider avant et après l’action, puis ne persister que l’essentiel. Le diagramme ci-dessous est un paysage compact (1280×520) exporté depuis un SVG artisanal — zéro Mermaid brut dans le markdown.

<p align="center">
  <img src="https://files.catbox.moe/aa8urv.svg" alt="HIVE-MIND Comment Ça Marche — boucle ReAct"
       width="100%" style="border-radius: 12px;" />
</p>

| Étape | Action du Harnais | Code Clé |
| :--- | :--- | :--- |
| 1 | Normaliser l’entrée | `TransportInterface` → `NormalizedMessage` (`src/core/transport/`) |
| 2 | Ordonnancer équitablement | `FairnessQueue.ts` DRR + files VIP |
| 3 | Hydrater le contexte | `tieredContextLoader.ts` + `ContextWindowService.ts` avec Ebbinghaus `0.4·e^{-t/τ}` |
| 4 | Router le modèle | `SmartLayer.ts` → `ExecutionLayer.ts` (8 adaptateurs, zéro-429) |
| 5 | Boucle ReAct ×10 | `BotCore.ts` + `SubAgentEngine.ts` (fork/fresh) |
| 6 | Exécuter les outils | `PTC ProgrammaticExecutor.ts` en `vm` + validation Acorn |
| 7 | Garde-fou | `VIGIL` pré-action + `Ralph` post-audit + `λ=(cost/budget)^4` |
| 8 | Persister | `workingMemory.ts` (Redis) + `SemanticMemory.ts` (pgvector HNSW) |

---

## <img src="https://cdn.jsdelivr.net/gh/withxat/fluentui-emoji-unicode@webp/assets/1f916_3d.webp" width="28" height="28" style="vertical-align: middle; margin-right: 8px;" /> Fournisseurs

Le Smart Router bicouche parle **8 familles de fournisseurs** via un pivot unifié. Layer 1 pivote les clés et les tiers avec des circuit breakers à fenêtre glissante ; Layer 0 adapte `GenerationParams` à chaque protocole wire.

| Fournisseur | Famille Protocole | Force |
| :--- | :--- | :--- |
| **Google Gemini** | Gemini natif | Multimodal, contexte 2M, audio Live |
| **Anthropic Claude** | Anthropic | Raisonnement étendu, tool use |
| **OpenAI** | Compatible OpenAI | GPT-4o, o3, vision |
| **Groq** | Compatible OpenAI | 300+ tok/s |
| **Cohere** | Cohere natif | Command R+, RAG |
| **Cloudflare AI** | Workers AI | Inférence edge |
| **HuggingFace** | HF Inference | Open-source |
| **Codex / Gemini CLI** | OAuth PKCE | Free-tier via CLI headless |

---

## <img src="https://cdn.jsdelivr.net/gh/withxat/fluentui-emoji-unicode@webp/assets/1f4e1_3d.webp" width="28" height="28" style="vertical-align: middle; margin-right: 8px;" /> Canaux & Transports

| Canal | Statut | Fichier Transport | Notes |
| :--- | :--- | :--- | :--- |
| **WhatsApp** | ![Actif](https://img.shields.io/badge/Actif-3FB950?style=flat-square) | `baileys.ts` | Multi-appareil, média, stickers, voix |
| **Discord** | ![Actif](https://img.shields.io/badge/Actif-3FB950?style=flat-square) | `discord.ts` | Guildes, DMs |
| **Telegram** | ![Actif](https://img.shields.io/badge/Actif-3FB950?style=flat-square) | `telegram.ts` | Groupes, bots inline |
| **CLI** | ![Actif](https://img.shields.io/badge/Actif-3FB950?style=flat-square) | `cli.ts` | UX interactive complet |
| **Serveur TUI** | ![Actif](https://img.shields.io/badge/Actif-3FB950?style=flat-square) | `TuiServerTransport.ts` | WS loopback :5001 vers `HIVE-MIND-TUI` standalone |

---

## <img src="https://cdn.jsdelivr.net/gh/withxat/fluentui-emoji-unicode@webp/assets/1f680_3d.webp" width="28" height="28" style="vertical-align: middle; margin-right: 8px;" /> Démarrage Rapide

> **Note** — HIVE-MIND est un **harnais de recherche expérimental**, pas un produit. Les interfaces sont instables et peuvent changer sans préavis.

<details>
<summary><b><img src="https://cdn.jsdelivr.net/gh/withxat/fluentui-emoji-unicode@webp/assets/1f680_3d.webp" width="18" style="vertical-align: middle; margin-right: 6px;" /> 1 — Cloner & Installer (Node 22+ requis)</b></summary>

```bash
# Cloner le harnais
git clone https://github.com/leandre755/HIVE-MIND.git
cd HIVE-MIND

# Installer les dépendances
npm install
```

</details>

<details>
<summary><b><img src="https://cdn.jsdelivr.net/gh/withxat/fluentui-emoji-unicode@webp/assets/1f4c1_3d.webp" width="18" style="vertical-align: middle; margin-right: 6px;" /> 2 — Configurer l’Environnement</b></summary>

```bash
# Copier le modèle et remplir au moins une clé LLM + Supabase + Redis
cp .env.example .env
nano .env
```

</details>

<details>
<summary><b><img src="https://cdn.jsdelivr.net/gh/withxat/fluentui-emoji-unicode@webp/assets/2699_3d.webp" width="18" style="vertical-align: middle; margin-right: 6px;" /> 3 — Lancer le Harnais</b></summary>

```bash
# Menu de démarrage interactif — auth canal + sélection fournisseur
npm start

# Mode watch — redémarrage auto sur changement source
npm run dev
```

</details>

<details>
<summary><b><img src="https://cdn.jsdelivr.net/gh/withxat/fluentui-emoji-unicode@webp/assets/2705_3d.webp" width="18" style="vertical-align: middle; margin-right: 6px;" /> 4 — Vérifier (build + lint + tests)</b></summary>

```bash
# 73 suites — 595 tests unitaires
npm run test:unit

# Porte locale complète
npm run build && npm run lint:fast && npm run test:unit
```

</details>

---

## <img src="https://cdn.jsdelivr.net/gh/withxat/fluentui-emoji-unicode@webp/assets/1f4c1_3d.webp" width="28" height="28" style="vertical-align: middle; margin-right: 8px;" /> Structure du Projet

```
hive-mind/
├── src/
│   ├── bin/              # entrée daemon — hive-mind.ts
│   ├── cli/              # startupMenu, whatsappAuthHelper, authSessionManager
│   ├── config/           # schémas Zod, pricing, keyResolver, blueprints
│   ├── core/             # BotCore, ServiceContainer, FairnessQueue, transports
│   ├── persona/          # prompts système + lessons_learned.md
│   ├── plugins/          # outils modulaires (manifest validé Zod)
│   ├── providers/        # Layer0 ExecutionLayer + Layer1 SmartLayer + families
│   ├── scheduler/        # node-cron + dbMonitoring
│   ├── services/         # mémoire L1/L2, Planner/SubAgent agentic, PTC VM, runtime
│   ├── supabase/         # migrations SQL, fonctions pgvector match_*
│   └── utils/            # safeFs.ts, pidLock, TlsImpersonator, toolExecution
├── documentation/        # 97 docs Diátaxis (core/providers/transport/memory/runtime/plugins)
├── src/tests/
│   ├── unit/             # 73 suites — core/providers/runtime/services
│   ├── integration/      # 5 suites, 34 tests
│   └── e2e/              # harness + WebSocket cross-process
├── .GCC/                 # état session Git-Context-Controller
└── .gouvernance/         # review-policy, accompanied-agent, gouvernance
```

---

## <img src="https://cdn.jsdelivr.net/gh/withxat/fluentui-emoji-unicode@webp/assets/2705_3d.webp" width="28" height="28" style="vertical-align: middle; margin-right: 8px;" /> Validation

| Commande | Objet | Porte |
| :--- | :--- | :--- |
| `npm run build` | `tsc --noEmit` strict | 0 erreur sur 330 fichiers |
| `npm run lint:fast` | Oxlint, 96 règles, 4 threads | 0 warning |
| `npm run lint:arch` | dependency-cruiser frontières | 0 violation |
| `npm run test:unit` | Jest, 73 suites | 595 / 595 passants |
| `npm run test:integration` | 5 suites | 34 / 34 passants |
| `npm audit` | CVE High/Moderate + GPL-2.0 deny | 0 vulnérabilité |

---

## <img src="https://cdn.jsdelivr.net/gh/withxat/fluentui-emoji-unicode@webp/assets/1f9e0_3d.webp" width="28" height="28" style="vertical-align: middle; margin-right: 8px;" /> Démonstration Live

Les médias animés sont réservés à la preuve d’exécution concrète. Ci-dessous le teaser éditorial (GIF, 1280×480, 24 frames) — le hero reste statique par design.

<p align="center">
  <img src="https://files.catbox.moe/g6t6vt.gif" alt="HIVE-MIND harnais — teaser terminal"
       width="100%" style="border-radius: 8px;" />
</p>

> Boucle teaser : `npm start` → harnais démarre → transports connectés → ReAct ×10 → mémoire persiste → WS stream vers TUI. Remplacez par votre propre capture pour la preuve de travail.

---

## <img src="https://cdn.jsdelivr.net/gh/withxat/fluentui-emoji-unicode@webp/assets/1f91d_3d.webp" width="28" height="28" style="vertical-align: middle; margin-right: 8px;" /> Contribuer

Tout travail non trivial passe par des **Pull Requests uniquement**. Un agent n’approuve jamais son propre code.

- Lire [`AGENTS.md`](AGENTS.md) — règles obligatoires pour chaque agent et humain
- Lire [`ARCHITECTURE.md`](ARCHITECTURE.md) — blueprint des couches et frontières 26 SS
- Lire [`.gouvernance/review-policy.md`](.gouvernance/review-policy.md) — Strict Review, défense bicouche, portes d’acceptation

```bash
# Nommage de branche — Conventional Commits imposé au pre-commit
git checkout -b feat/ma-fonctionnalite
git checkout -b fix/description-probleme

# Budget PR : ≤1000 lignes warning, 2500 hard limit (docs/assets exclus)
```

---

## <img src="https://cdn.jsdelivr.net/gh/withxat/fluentui-emoji-unicode@webp/assets/1f6e1_3d.webp" width="28" height="28" style="vertical-align: middle; margin-right: 8px;" /> Sécurité

Divulgation privée uniquement — jamais via les issues publiques. Voir [`SECURITY.md`](SECURITY.md).

- Chaque accès fichiers passe par [`src/utils/safeFs.ts`](src/utils/safeFs.ts) (`resolveWithinRoot` anti-traversal)
- Les secrets sont scannés à chaque commit et push via `gitleaks` (staged + historique complet), `ALLOW_CONFIG_EDIT=1` pour les fichiers protégés
- `ALLOW_CONFIG_EDIT=1 git commit` est la seule voie autorisée pour `package.json`, `.githooks/` etc. — `--no-verify` reste interdit

---

<p align="center">
  <sub>
    HIVE-MIND est un harnais de recherche expérimental — l’échafaudage est l’artefact.<br/>
    Éditorial premium — ambre <code>#F59E0B</code> · orange <code>#F97316</code> sur <code>#0D1117</code> · icônes Fluent 3D<br/>
    Apache-2.0 &nbsp;·&nbsp; leandre755 &nbsp;·&nbsp; 2026
  </sub>
</p>
