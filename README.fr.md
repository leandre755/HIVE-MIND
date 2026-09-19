<p align="center">
  <img src="https://i.ibb.co/27t7qsBT/banner-readme-tall-condensed-drone-transparent.png#gh-dark-mode-only" alt="Bannière HIVE-MIND" border="0" />
  <img src="https://i.ibb.co/1JwwQ5ry/banner-readme-tall-condensed-bold-drone-light.png#gh-light-mode-only" alt="Bannière HIVE-MIND" border="0" />
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
  <a href="#démonstration-live">
    <img src="https://img.shields.io/badge/Démo_Live-→-00B4D8?style=flat-square" alt="Démo Live" />
  </a>
  <a href="#capacités">
    <img src="https://img.shields.io/badge/Capacités-→-00B4D8?style=flat-square" alt="Capacités" />
  </a>
  <a href="#comment-ça-marche">
    <img src="https://img.shields.io/badge/Workflow-→-00B4D8?style=flat-square" alt="Workflow" />
  </a>
  <a href="#fournisseurs">
    <img src="https://img.shields.io/badge/Fournisseurs-→-00B4D8?style=flat-square" alt="Fournisseurs" />
  </a>
  <a href="#démarrage-rapide">
    <img src="https://img.shields.io/badge/Démarrage_Rapide-→-8B5CF6?style=flat-square" alt="Démarrage Rapide" />
  </a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Version-1.0.0-0D1117?style=flat-square&labelColor=0D1117&color=3FB950" alt="Version" />
  <img src="https://img.shields.io/badge/TypeScript-7.0.2-0D1117?style=flat-square&labelColor=0D1117&color=3178C6&logo=typescript&logoColor=white" alt="TypeScript 7.0.2" />
  <img src="https://img.shields.io/badge/Node.js-22+-0D1117?style=flat-square&labelColor=0D1117&color=3FB950&logo=node.js&logoColor=white" alt="Node 22+" />
  <img src="https://img.shields.io/badge/Rust-1.81+-0D1117?style=flat-square&labelColor=0D1117&color=DEA584&logo=rust&logoColor=white" alt="Rust 1.81+" />
  <img src="https://img.shields.io/badge/Licence-Apache--2.0-0D1117?style=flat-square&labelColor=0D1117&color=F0883E" alt="Apache 2.0" />
</p>

---

### La Philosophie : Pourquoi HIVE-MIND ?

Les déploiements LLM paraissent solides en démo puis échouent sur le terrain — non parce que les modèles manquent de capacité, mais parce que le harnais qui les entoure est trop mince. Une boucle de prompts sans état ne peut ni se souvenir, ni budgéter, ni se coordonner, ni se relever d’une erreur d’outil sans aide humaine. Le modèle est nu sans le harnais ; un harnais sans modèle est mort.

**HIVE-MIND** a été conçu pour inverser cette hiérarchie. Il traite le harnais lui-même comme l’artefact principal — un banc d’essai de recherche où chaque couture est mesurable. Cinq couches strictes, vingt-six sous-systèmes extractibles, huit familles de fournisseurs et cinq canaux ne sont pas des fonctionnalités mais des instruments pour poser la question : quel échafaudage rend réellement un modèle meilleur sur des tâches qu’il n’a jamais apprises ?

Le mécanisme est le câblage sélectif, pas le bourrage de contexte. Une VM PTC sandboxée qui économise 80–95 % de tokens, un réconciliateur Myers ancré par hash qui élimine la dérive, un squelette AST qui coupe 90 % du contexte de code, une mémoire bicouche à oubli Ebbinghaus, et un Smart Router qui pivote les quotas avec zéro 429. **HIVE-MIND** existe pour prouver, instrumenter et itérer cette hypothèse en public, comme un harnais expérimental.

---

## <picture><source media="(prefers-color-scheme: dark)" srcset="https://api.iconify.design/lucide:boxes.svg?color=%23f0f6fc"><source media="(prefers-color-scheme: light)" srcset="https://api.iconify.design/lucide:boxes.svg?color=%231f2328"><img src="https://api.iconify.design/lucide:boxes.svg?color=%231f2328" alt="" width="28" height="28" style="vertical-align: middle; margin-right: 8px;" /></picture> Architecture

<p align="center">
  <img src="https://files.catbox.moe/0qzfn6.png#gh-dark-mode-only" alt="Architecture HIVE-MIND" width="100%" />
  <img src="https://files.catbox.moe/d8fpip.png#gh-light-mode-only" alt="Architecture HIVE-MIND" width="100%" />
</p>

HIVE-MIND est un **harnais strict à cinq couches** à dépendance unidirectionnelle : chaque couche ne parle qu’à ses voisines immédiates, aucun saut. La décomposition en 26 sous-systèmes est auditée formellement dans [`ARCHITECTURE.md`](ARCHITECTURE.md) avec les métriques d’instabilité de Martin.

| Couche | Rôle | Composants Clés |
| :--- | :--- | :--- |
| **Transport** | Entrée / sortie unifiée | WhatsApp (Baileys), Discord, Telegram, CLI, TUI WebSocket :5001 |
| **Orchestration** | Boucle ReAct, IoC, ordonnancement | BotCore, ServiceContainer, FairnessQueue, BlueprintManager, Planner, PTC VM |
| **Runtime** | Sécurité &amp; gouvernance coût | VIGIL, Ralph, ConstraintManifold, ContextWindowService |
| **Cognitif** | Mémoire hiérarchique | Redis L1 &lt;50ms, Supabase pgvector L2, MAPLE, HNSW |
| **Smart Router** | Routage modèle | Layer 1 SmartLayer (rotation quota, circuit breakers), Layer 0 ExecutionLayer (8 adaptateurs) |

---

## <picture><source media="(prefers-color-scheme: dark)" srcset="https://api.iconify.design/lucide:sparkles.svg?color=%23f0f6fc"><source media="(prefers-color-scheme: light)" srcset="https://api.iconify.design/lucide:sparkles.svg?color=%231f2328"><img src="https://api.iconify.design/lucide:sparkles.svg?color=%231f2328" alt="" width="28" height="28" style="vertical-align: middle; margin-right: 8px;" /></picture> Démonstration Live

Soon.

---

## <picture><source media="(prefers-color-scheme: dark)" srcset="https://api.iconify.design/lucide:puzzle.svg?color=%23f0f6fc"><source media="(prefers-color-scheme: light)" srcset="https://api.iconify.design/lucide:puzzle.svg?color=%231f2328"><img src="https://api.iconify.design/lucide:puzzle.svg?color=%231f2328" alt="" width="28" height="28" style="vertical-align: middle; margin-right: 8px;" /></picture> Capacités

<p align="center">
  <img src="https://files.catbox.moe/u9ih47.png#gh-dark-mode-only" alt="Capacités HIVE-MIND" width="100%" />
  <img src="https://files.catbox.moe/u1zqz0.png#gh-light-mode-only" alt="Capacités HIVE-MIND" width="100%" />
</p>

Vingt-six sous-systèmes, chacun **extractible, testable indépendamment et documenté** avec sa page Diátaxis dans [`documentation/`](documentation/).

<details>
<summary><b><picture><source media="(prefers-color-scheme: dark)" srcset="https://api.iconify.design/lucide:puzzle.svg?color=%23f0f6fc"><source media="(prefers-color-scheme: light)" srcset="https://api.iconify.design/lucide:puzzle.svg?color=%231f2328"><img src="https://api.iconify.design/lucide:puzzle.svg?color=%231f2328" alt="" width="18" style="vertical-align: middle; margin-right: 6px;" /></picture> Carte des domaines — déplier SS-01 à SS-26</b></summary>

| Domaine | Sous-Systèmes | Responsabilité |
| :--- | :--- | :--- |
| **01 Core &amp; Concurrence** | SS-01 → SS-09 | ServiceContainer (I=0.00), FairnessQueue DRR, SwarmDispatcher, BlueprintManager, EventBus, Planner DAG, SubAgentEngine, PTC VM, PermissionManager |
| **02 Intelligence Modèle** | SS-10 → SS-14 | ExecutionLayer, ParamConverter pivot↔wire, SmartLayer, OAuth PKCE, Voix (Live/STT/TTS) |
| **03 Gateways &amp; IPC** | SS-15 → SS-17 | TransportInterface universel, TuiServer WS IPC, Assistant Auth CLI |
| **04 Mémoire &amp; Cognition** | SS-18 → SS-20 | Mémoire Multi-Tier L1/L2, MAPLE Ebbinghaus, DB HNSW multimodale |
| **05 Runtime Safety** | SS-21 → SS-26 | VIGIL + Ralph, Tiered Context, Hash-Anchored Edit (FNV-1a Myers), AST Tree-Sitter, Plugin Pipeline, SafeFs |

</details>

---

## <picture><source media="(prefers-color-scheme: dark)" srcset="https://api.iconify.design/lucide:workflow.svg?color=%23f0f6fc"><source media="(prefers-color-scheme: light)" srcset="https://api.iconify.design/lucide:workflow.svg?color=%231f2328"><img src="https://api.iconify.design/lucide:workflow.svg?color=%231f2328" alt="" width="28" height="28" style="vertical-align: middle; margin-right: 8px;" /></picture> Comment Ça Marche

<p align="center">
  <img src="https://files.catbox.moe/u12g5w.png#gh-dark-mode-only" alt="Workflow HIVE-MIND" width="100%" />
  <img src="https://files.catbox.moe/83bk41.png#gh-light-mode-only" alt="Workflow HIVE-MIND" width="100%" />
</p>

Du `NormalizedMessage` à la réponse livrée, le harnais exécute une boucle fermée : ordonnancer équitablement, hydrater sélectivement, router intelligemment, penser avec des outils, valider avant et après l’action, puis ne persister que l’essentiel.

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
| 9 | Livrer | `Transport.sendResponse()` vers le canal source |

---

## <picture><source media="(prefers-color-scheme: dark)" srcset="https://api.iconify.design/lucide:cpu.svg?color=%23f0f6fc"><source media="(prefers-color-scheme: light)" srcset="https://api.iconify.design/lucide:cpu.svg?color=%231f2328"><img src="https://api.iconify.design/lucide:cpu.svg?color=%231f2328" alt="" width="28" height="28" style="vertical-align: middle; margin-right: 8px;" /></picture> Fournisseurs

Le Smart Router bicouche orchestre **8 familles d'adaptateurs natifs** et **22+ endpoints dynamiques** via un pivot découplé. Layer 1 gère le routage résilient avec état (disjoncteurs 6 fenêtres glissantes, scoring P50, rotation zéro-429, verrou de stream SSE) ; Layer 0 pilote la transformation filaire sans état (`ProtocolFamily` $\times$ `HeaderFamily`, budgets de raisonnement, erreurs typées).

| Fournisseur / Famille | Implémentation | Protocole Filaire | Capacités Clés | Spécificités Techniques |
| :--- | :--- | :--- | :--- | :--- |
| **OpenAI** | Natif (`openai.ts`) | `openai-compatible` (`/v1/chat/completions`) | Chat, Tool Calling, Vision, Effort Reasoning | Gestion native `max_completion_tokens` et `reasoning_effort`, embeddings |
| **Google Gemini** | Natif (`gemini.ts`) | `gemini-native` (`generateContent`) | Multimodal (Texte, Image, Audio), Thinking Budget | Structure multipart, préservation `thought_signature`, `systemInstruction` |
| **Anthropic Claude** | Natif (`anthropic.ts`) | `anthropic-compatible` (`/v1/messages`) | Raisonnement Étendu, Tool Calling, Prompt Caching | Extraction `system` racine, schéma `input_schema`, bornage budget raisonnement |
| **Groq Cloud** | Natif (`groq.ts`) | `openai-compatible` (`/openai/v1`) | Inférence LPU Ultra-rapide, Tool Calling, Outils Serveur | Groq Compound `executed_tools`, `usage_breakdown`, versioning via en-tête |
| **Cohere** | Natif (`cohere.ts`) | `cohere-v2` (`/v2/chat`) | Contenu Structuré, Tool Calling | Séparation message `system`, fragments typés, normalisation des tokens |
| **Cloudflare AI** | Natif (`cloudflare.ts`) | `cloudflare-v1` (`/ai/v1/chat/completions`) | Inférence Serverless &amp; Tool Calling | Format clé composite `account_id:api_token`, désencapsulation `{ result }`, erreurs |
| **Hugging Face** | Natif (`huggingface.ts`) | `openai-compatible` (`router.huggingface.co`) | Modèles Open-Source du Hub | Wrapper SDK officiel, initialisation autonome des clés, gestionnaire 429 |
| **Modal** | Natif (`modal.ts`) | `openai-compatible` (`{appUrl}/v1`) | Conteneurs GPU Serverless Personnalisés | URL dynamique par ID modèle, timeout 120s pour absorption des cold-starts |
| **Spécialisations OAuth** | Headless (`codex.ts`, `antigravity.ts`) | Flux SSE Direct / Cloud Code REST API | OAuth2 PKCE / Session OAuth Locale | Rafraîchissement (&lt;300s), télémétrie Clearcut simulée, impersonation TLS |
| **Fournisseurs Dynamiques** | Générique (`GenericAdapter.ts`) | `openai-compatible` / `standard-token` | 22+ Fournisseurs de l'Écosystème (Mistral, NIM, etc.) | Assainissement 9-char des IDs d'outils, relais `reasoning_content`, passthrough |

---

## <picture><source media="(prefers-color-scheme: dark)" srcset="https://api.iconify.design/lucide:radio.svg?color=%23f0f6fc"><source media="(prefers-color-scheme: light)" srcset="https://api.iconify.design/lucide:radio.svg?color=%231f2328"><img src="https://api.iconify.design/lucide:radio.svg?color=%231f2328" alt="" width="28" height="28" style="vertical-align: middle; margin-right: 8px;" /></picture> Canaux &amp; Transports

| Canal | Statut | Fichier Transport | Notes |
| :--- | :--- | :--- | :--- |
| **WhatsApp** | ![Actif](https://img.shields.io/badge/Actif-3FB950?style=flat-square) | `baileys.ts` | Multi-appareil, média, stickers, voix |
| **Discord** | ![Actif](https://img.shields.io/badge/Actif-3FB950?style=flat-square) | `discord.ts` | Guildes, DMs |
| **Telegram** | ![Actif](https://img.shields.io/badge/Actif-3FB950?style=flat-square) | `telegram.ts` | Groupes, bots inline |
| **CLI** | ![Actif](https://img.shields.io/badge/Actif-3FB950?style=flat-square) | `cli.ts` | UX interactif complet |
| **Serveur TUI** | ![Actif](https://img.shields.io/badge/Actif-3FB950?style=flat-square) | `TuiServerTransport.ts` | WS loopback :5001 (défaut, auto-incrémenté si occupé ; voir `tui-connection.json`) |

---

## <picture><source media="(prefers-color-scheme: dark)" srcset="https://api.iconify.design/lucide:rocket.svg?color=%23f0f6fc"><source media="(prefers-color-scheme: light)" srcset="https://api.iconify.design/lucide:rocket.svg?color=%231f2328"><img src="https://api.iconify.design/lucide:rocket.svg?color=%231f2328" alt="" width="28" height="28" style="vertical-align: middle; margin-right: 8px;" /></picture> Démarrage Rapide

> **Note** — HIVE-MIND est un **harnais de recherche expérimental**, pas un produit. Les interfaces sont instables et peuvent changer sans préavis.

<details>
<summary><b><picture><source media="(prefers-color-scheme: dark)" srcset="https://api.iconify.design/lucide:rocket.svg?color=%23f0f6fc"><source media="(prefers-color-scheme: light)" srcset="https://api.iconify.design/lucide:rocket.svg?color=%231f2328"><img src="https://api.iconify.design/lucide:rocket.svg?color=%231f2328" alt="" width="18" style="vertical-align: middle; margin-right: 6px;" /></picture> 1 — Cloner &amp; Installer (Node 22+ requis)</b></summary>

```bash
# Cloner le harnais
git clone https://github.com/leandre755/HIVE-MIND.git
cd HIVE-MIND

# Installer les dépendances
npm install
```

</details>

<details>
<summary><b><picture><source media="(prefers-color-scheme: dark)" srcset="https://api.iconify.design/lucide:key.svg?color=%23f0f6fc"><source media="(prefers-color-scheme: light)" srcset="https://api.iconify.design/lucide:key.svg?color=%231f2328"><img src="https://api.iconify.design/lucide:key.svg?color=%231f2328" alt="" width="18" style="vertical-align: middle; margin-right: 6px;" /></picture> 2 — Configurer l’Environnement</b></summary>

```bash
# Copier le modèle et remplir au moins une clé LLM + Supabase + Redis
cp .env.example .env
nano .env
```

</details>

<details>
<summary><b><picture><source media="(prefers-color-scheme: dark)" srcset="https://api.iconify.design/lucide:terminal.svg?color=%23f0f6fc"><source media="(prefers-color-scheme: light)" srcset="https://api.iconify.design/lucide:terminal.svg?color=%231f2328"><img src="https://api.iconify.design/lucide:terminal.svg?color=%231f2328" alt="" width="18" style="vertical-align: middle; margin-right: 6px;" /></picture> 3 — Lancer le Harnais</b></summary>

```bash
# Menu de démarrage interactif — auth canal + sélection fournisseur
npm start

# Mode watch — redémarrage auto sur changement source
npm run dev
```

</details>

<details>
<summary><b><picture><source media="(prefers-color-scheme: dark)" srcset="https://api.iconify.design/lucide:check-circle-2.svg?color=%23f0f6fc"><source media="(prefers-color-scheme: light)" srcset="https://api.iconify.design/lucide:check-circle-2.svg?color=%231f2328"><img src="https://api.iconify.design/lucide:check-circle-2.svg?color=%231f2328" alt="" width="18" style="vertical-align: middle; margin-right: 6px;" /></picture> 4 — Vérifier (build + lint + tests)</b></summary>

```bash
# 77 suites — 834 tests unitaires
npm run test:unit

# Porte locale complète
npm run build && npm run lint:fast && npm run test:unit
```

</details>

---

## <picture><source media="(prefers-color-scheme: dark)" srcset="https://api.iconify.design/lucide:folder-tree.svg?color=%23f0f6fc"><source media="(prefers-color-scheme: light)" srcset="https://api.iconify.design/lucide:folder-tree.svg?color=%231f2328"><img src="https://api.iconify.design/lucide:folder-tree.svg?color=%231f2328" alt="" width="28" height="28" style="vertical-align: middle; margin-right: 8px;" /></picture> Structure du Projet

<p align="center">
  <img src="https://i.ibb.co/gLrbpqN0/Image-Codex-19-sept-2026-21-05-01.png#gh-dark-mode-only" alt="Structure du Projet" width="100%" style="border-radius: 10px;" />
  <img src="https://i.ibb.co/m5J3YmfB/Image-Codex-19-sept-2026-21-08-21.png#gh-light-mode-only" alt="Structure du Projet" width="100%" style="border-radius: 10px;" />
</p>

---

## <picture><source media="(prefers-color-scheme: dark)" srcset="https://api.iconify.design/lucide:shield-check.svg?color=%23f0f6fc"><source media="(prefers-color-scheme: light)" srcset="https://api.iconify.design/lucide:shield-check.svg?color=%231f2328"><img src="https://api.iconify.design/lucide:shield-check.svg?color=%231f2328" alt="" width="28" height="28" style="vertical-align: middle; margin-right: 8px;" /></picture> Validation

| Commande | Objet | Porte |
| :--- | :--- | :--- |
| `npm run build` | `tsc --noEmit` strict | 0 erreur sur 334 fichiers |
| `npm run lint:fast` | Oxlint, 96 règles, 4 threads | 0 warning |
| `npm run lint:arch` | dependency-cruiser frontières | 0 violation |
| `npm run test:unit` | Jest, 77 suites | 834 / 834 passants |
| `npm run test:integration` | 5 suites | 34 / 34 passants |
| `npm audit` | CVE High/Moderate + GPL-2.0 deny | 0 vulnérabilité |

---

## <picture><source media="(prefers-color-scheme: dark)" srcset="https://api.iconify.design/lucide:lock.svg?color=%23f0f6fc"><source media="(prefers-color-scheme: light)" srcset="https://api.iconify.design/lucide:lock.svg?color=%231f2328"><img src="https://api.iconify.design/lucide:lock.svg?color=%231f2328" alt="" width="28" height="28" style="vertical-align: middle; margin-right: 8px;" /></picture> Sécurité

Voir [`SECURITY.md`](SECURITY.md).
