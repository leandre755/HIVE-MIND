# HIVE-MIND: The Autonomous Hive Meta-Mind

## Original Idea & Vision

HIVE-MIND is designed to be a high-intelligence, Omni-Channel Autonomous Agent framework. It acts as a "Meta-Mind" orchestrating multiple specialized plugins and AI providers to provide a seamless, rich interactive experience across various interfaces (CLI, WhatsApp, Discord, etc.).

### Core Objectives

1. **Autonomy**: Ability to process messages, trigger actions, and manage its own state with minimal intervention.
2. **Extensibility**: A plugin-based architecture allowing for rapid addition of new capabilities (e-mail, group management, etc.).
3. **Resilience**: Leveraging Redis for working memory and Supabase for persistent storage, ensuring context is never lost.
4. **Multi-Modal**: Support for text, images, and native audio (Gemini Live) to interact across all media types.

## Current Project State

The project is currently a large-scale JavaScript (ESM) codebase. It has reached a level of complexity where type safety and strict architectural enforcement (SOLID) are required to maintain stability and enable further growth.

## The Transformation

We are migrating to **TypeScript** to:

- Eliminate runtime type errors.
- Enforce strict coding standards across the entire "Hive".
- Improve maintainability and developer experience through clear interfaces and contracts.

## Design Note — Native Zod Tool Schemas (2026-06-04)

Goal: migrate Zod-defined tools away from the direct `zod-to-json-schema` conversion path and use Zod v4's native `z.toJSONSchema` API instead.

Tradeoffs:

- Keep `OpenAIToolDefinition` as the runtime provider contract because adapters and validators already consume OpenAI-compatible JSON Schema.
- Use native Zod schema generation directly so the exposed tool schema contains full JSON Schema content (`type`, `properties`, `required`, `additionalProperties`) rather than only metadata.
- Preserve `_zodSchema` on tool definitions so execution still validates with native Zod rather than trusting provider arguments.

## Design Note — Provider-Agnostic Prompt Caching (2026-07-28) [À FAIRE / RECHERCHE]

> **Statut** : Tâche de recherche + conception à réaliser AVANT implémentation. Aucune mise en cache de prompt n'existe actuellement dans les appels LLM (`src/providers/adapters/`), ce qui gaspille tokens, coût et latence sur le contexte répété (system prompt, historique, schémas d'outils).

### Contrainte explicite (exigence utilisateur)
La stratégie de caching **ne doit pas être spécifiée par site d'appel ni codée en dur par provider** à chaque endpoint. Il faut un **module/fonction unique** qui gère la mise en cache de manière transverse sur les 38 adapters (`src/providers/adapters/`).

### Contexte technique — 3 paradigmes de caching distincts constatés
- **Anthropic** (adapters `anthropic.ts`) : opt-in MANUEL via `cache_control: { type: "ephemeral" }` placé sur ≤4 breakpoints (system, tools, derniers messages). Write facturé 1.25×, read 0.1×. TTL ~5 min par défaut.
- **OpenAI** (adapters `openai.ts`, et compatibles `groq.ts`, `fireworks.ts`, `openrouter.ts`, `kimi.ts`…) : AUTOMATIQUE pour les préfixes ≥1024 tokens (gpt-4o, o1…), aucune modification d'appel, ~50% de remise sur les read. Le provider gère ; on ne fait rien côté code sauf lire le `usage.cache_read_input_tokens`.
- **Google Gemini** (adapters `gemini.ts`, `geminiCli.ts`, `geminiLive.ts`) : objet de cache EXPLICITE (`cachedContent`) créé via API séparée, référencé par nom + TTL paramétrable (défaut 1h). Pas implicite.

### Livrable visé
1. **Recherche** (cette étape en premier) :
   - Comparer formellement les 3 paradigmes (breakpoints vs automatique vs cache-object) — limites, pricing, TTL, gestion d'éviction, reporting d'usage.
   - Vérifier la capacité réelle des 38 adapters à supporter le caching (certains endpoints compatibles-OpenAI passent-ils le cache au-delà du provider mère ?).
   - Identifier où la décision de "que cacher" se prend aujourd'hui dans le pipeline (system prompt / composed context / TieredContextLoader — voir `test_afaire.md` MOD Context V3).
2. **Conception** :
   - Interface `PromptCacheStrategy` typée : `"automatic" | "explicit-breakpoints" | "explicit-cache-object" | "none"`, résolue par adapter via registre (pas de branch `if (provider === …)` dispersé).
   - Module `src/providers/promptCache/` (ou `src/core/promptCacheManager.ts`) injectant/transposant selon la stratégie retournée, sans toucher chaque site d'appel.
   - Normalisation du reporting d'usage (`cache_read_input_tokens` Anthropic vs `cached_tokens` OpenAI vs `cacheTokenCount` Gemini) vers une structure unique consommée par le `CostTracker` existant (MOD 4 `test_afaire.md`).
3. **Validation** :
   - Test fonctionnel : deux appels successifs avec même préfixe → 2e appel montre un cache-hit (tokens lus, coût réduit) sur chacun des providers supportés.

### Risques / points ouverts
- Abstraction trop fine risque d'effacer des optimisations spécifiques (par ex. position optimale des breakpoints Anthropic dépend du contexte).
- Cohérence avec l'historique compressé (`_compactHistory`, MOD 1) : casser un préfixe = invalider le cache. Le strategie doit être conscient des resets de contexte.
- Certains providers n'ont AUCUN caching (`none`) — l'interface doit l'exprimer explicitement (ne pas simuler un cache inexistant).
