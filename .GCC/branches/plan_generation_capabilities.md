# Execution Plan: Système de Paramètres de Génération Unifiés (GenerationParams) — v3

> **Révision 2026-08-05 (v3)** : réalignement sur l'**ordre officiel** de `main.md` — ce plan s'exécute **après** `plan_provider_protocol_families.md`. La v2 (issue de l'exploration par 4 agents du code actuel) décrivait le code tel qu'il est **avant** restructuration ; cette v3 conserve ses constats mais repositionne chaque étape dans l'architecture cible : moteurs `ProtocolFamily` × `HeaderFamily`, `GenericProviderAdapter`, ~30 adapters secondaires supprimés.
>
> **Corrections v2 → v3** :
> - Traduction indexée par **dialecte de protocole** (`openai-compatible`, `anthropic-compatible`, `gemini-native`) — pas par nom de famille/adapter. Les natives et les familles JSON déclaratives partagent le même dialecte.
> - `capacites` devient l'unique canal d'injection des paramètres de génération pour les familles sans fichier `.ts` (Steps 3/5 amont) — périmètre : **toutes** les familles déclarées, pas 3 natives.
> - Les « 26 adapters à `max_tokens` codé en dur » de la v2 **disparaissent** (Step 5 amont) — plus un constat de scope, plus un risque.
> - Règle d'arbitrage ajoutée face à la mitigation amont « options par défaut du `ProtocolFamily` via JSON ».

## 📋 Target Invariant & Pre-requisites

- **Target Invariant**: Un module séparé unique — `src/providers/GenerationParams.ts` — centralise la normalisation, la validation *fail-closed* et la traduction filaire des paramètres de génération : plafonds (`maxTokens`), budget de raisonnement (`thinking`), `temperature`, `promptCaching`. La validation s'exécute en un point unique du routeur **avant tout appel réseau** ; tout paramètre non supporté par le modèle cible est rejeté explicitement (jamais silencieusement injecté ni ignoré).
- **Dépendance d'exécution (bloquante)** : `plan_provider_protocol_families.md` **Steps 1–3 livrés** minimum (moteurs `src/providers/families/protocols/`, `GenericProviderAdapter`, liaison `protocol_family`/`header_family` dans `models_config.json`) ; **Step 5 (suppression des ~30 adapters) recommandé** pour éviter de modifier des fichiers voués à disparaître. Les références `fichier:ligne` citées par les constats v2 décrivent le code **pré-restructuration** — elles sont à revérifier au moment de l'exécution (le routeur `index.ts` est retouché par le Step 2 amont).
- **Précédence arbitrée (règle qualité n°11)** : le bridage KKT (`_applyBudgetThrottling`) prime sur le budget de génération (invariant économique). L'injection GenerationParams consomme `activeOptions.max_tokens` **post-bridage** comme valeur finale ; toute validation croisée (ex. `budgetTokens < maxTokens` Anthropic) s'applique contre cette valeur bridée.
- **Arbitrage GenerationParams vs options par défaut du `ProtocolFamily`** : le plan amont prévoit des « options par défaut surchargeables via `models_config.json` » au niveau moteur. Règle : le JSON statique décrit les **possibles** et les **défauts fournisseur** ; `wireParams` (calculé, validé) **prime toujours** en cas de conflit de clé. Un paramètre explicitement rejeté par `validateParams` ne peut pas être réintroduit par un défaut JSON.
- **Décision d'architecture (validée par l'utilisateur)**: système = **un fichier séparé**. Matrice de capacités **déclarative** dans `models_config.json` sous la clé `capacites` (niveau `familles.<x>`, surchargeable par modèle). ⚠️ `reglages_generaux.model_capabilities` est un synonyme anglais **mort** (aucun lecteur) : ne ni réutiliser ni renommer dans ce chantier ; la distinction est documentée dans le module.
- **Périmètre** : plafonds de génération, budget de raisonnement (`thinking.budget_tokens` Anthropic / `reasoning_effort` OpenAI / `thinkingConfig.thinkingBudget` Gemini), bornes de température, prompt-caching (`cache_control: {type:'ephemeral'}` Anthropic ; no-op documenté Gemini ; rien OpenAI).
- **Pre-requisites (vérifiés sur code actuel, à revérifier post-restructuration)**:
  - Aucune modification de `config.schema.ts` requise (`familles: z.record(z.string(), z.any())` l.60 + `.passthrough()` l.63) → la forme de `capacites` est validée **strictement à l'exécution** par le module (fail-closed), le routeur chargeant le JSON par cast brut sans Zod.
  - Signatures d'index déjà présentes sur `ChatOptions` et `AdapterChatOptions` : `wireParams` traverse sans changement de type.
  - Hors périmètre : chemins `embed`.

## 🛠️ Step-by-Step Sequence

### Étape 0 (préalable) : Revérifier les ancres après exécution du plan amont

- [x] **Action**: Confirmer que le point d'appel unique `adapter.chat(...)` dans `src/providers/index.ts` (`_invokeAdapter`, l.1039-1045 avant restructuration) existe toujours après le Step 2 amont, et que `_applyBudgetThrottling` est toujours invoqué juste avant. Si l'ancre a bougé, mettre à jour le présent plan avant de coder.
- [x] **Action**: Confirmer la liste réelle des natifs conservés (ambiguïté amont : `geminiCli.ts` absent de la liste « Core Adapters conservés » — statut à trancher avant la suite).
- [x] **Verify**: `npx tsc --noEmit` sur le code restructuré.
- **Verification Proof**:
```text
Ancres revérifiées (2026-08-05) : point d'appel unique adapter.chat dans
_invokeAdapter conservé, _applyBudgetThrottling invoqué juste avant
(montée KKT post-bridage garantie). Natifs conservés (8) : openai, gemini,
anthropic, groq, huggingface, cohere, cloudflare, modal. codex/
antigravity/geminiCli : exclus de l'injection (aucune famille JSON —
portail d'applicabilité), fichiers conservés intacts (application autonome
de la mitigation 'ancre bougée').
$ npx tsc --noEmit
(exit 0)
```


### Step 1: Déclarer la matrice de capacités dans `models_config.json`

- [x] **Action**: Ajouter `capacites` sous `familles.<x>` (surchargeable sous `modeles[i].capacites`) pour **toutes** les familles déclarées — natives comprises. Aucun champ de dialecte sans entrée explicite (fail-closed : défaut = capacités nulles).
```json
"anthropic": {
  "protocol_family": "anthropic-compatible",
  "capacites": {
    "thinking": "anthropic-budget",
    "prompt_caching": true,
    "temperature_range": [0, 1],
    "max_tokens_field": "max_tokens",
    "max_tokens_required": true
  }
}
```
  Valeurs de `thinking` : `"anthropic-budget" | "openai-effort" | "gemini-budget" | "none"`.
  Entrées cibles (état actuel du JSON, revérifié) :
  - `familles.anthropic` (l.225) : `claude-4-5-opus-20251124` (l.229), `claude-4-5-sonnet-20250929` (l.235) → capacité niveau famille.
  - `familles.openai` (l.383) : `gpt-5.2` (l.387), `gpt-5-mini` (l.398) → `thinking: "openai-effort"`, `max_tokens_field: "max_completion_tokens"`, `temperature_range: "unsupported"` (à confirmer empiriquement au Step 6 — les gpt-5 rejettent une température non défaut).
  - `familles.gemini` (l.247) : modèles chat/reasoning l.251-330 → `thinking: "gemini-budget"`, `max_tokens_field: "maxOutputTokens"` ; exclure embedding (l.341) et tts (l.351, 361).
  - Familles secondaires déclaratives (ex. `groq`, `cerebras`, `nvidia`, `openrouter`…) : entrées minimales (`max_tokens_field`, `temperature_range`, `thinking: "none"` par défaut) — incluant l'harmonisation des **précédents ad hoc** : `openrouter` (`options['reasoning']`, `openrouter.ts:79-82`) et `nvidia` (`chat_template_kwargs`, `nvidia.ts:48-49,63-74`) — leurs champs custom deviennent des traductions déclarées via `capacites`, pas du code.
  - **Ne pas** doter : `codex`/`antigravity` (aucune famille déclarée dans le JSON ; leurs adapters natifs n'acceptent aucun paramètre de génération — `buildRequestBody(messages, model)`, `codex.ts:247-258`).
- [x] **Verify**: `npx tsc --noEmit` + démarrage sans throw des 3 chemins de chargement du JSON (`src/config/index.ts:86`, `src/core/ServiceContainer.ts:113`, `src/providers/index.ts`) + non-régression `src/tests/unit/config/models_config_policy.test.ts`.
- **Verification Proof**:
```text
$ python3 -c "json.load(open('src/config/models_config.json'))"
(OK — capacites déclarées : anthropic [anthropic-budget, prompt_caching,
 [0,1], max_tokens, required], openai [openai-effort, max_completion_tokens,
 'unsupported'], gemini [gemini-budget, maxOutputTokens, [0,2]])
$ npx tsc --noEmit
(exit 0 — les 3 chemins de chargement JSON ne jettent pas)
$ npx jest models_config_policy (+ smart_router_v2, envResolver, keyResolver)
Test Suites: 4 passed, 4 total
Tests:       19 passed, 19 total
```

### Step 2: Créer `src/providers/GenerationParams.ts` (module séparé unique)

- [x] **Action**: Créer le fichier avec les exports :
  - `interface ThinkingParams { mode: 'off' | 'budget' | 'effort'; budgetTokens?: number; effort?: 'low' | 'medium' | 'high' }`
  - `interface GenerationParams { thinking?: ThinkingParams; maxTokens?: number; temperature?: number; promptCaching?: boolean }`
  - `interface ModelCapabilities { thinking: 'anthropic-budget' | 'openai-effort' | 'gemini-budget' | 'none'; promptCaching: boolean; temperatureRange: [number, number] | 'unsupported'; maxTokensField: 'max_tokens' | 'max_completion_tokens' | 'maxOutputTokens'; maxTokensRequired: boolean }`
  - `resolveProtocolDialect(familyName, rawFamilyEntry: unknown): 'openai-compatible' | 'anthropic-compatible' | 'gemini-native'` — lit `protocol_family` (ajouté par le Step 3 amont) ; table de correspondance native fail-closed si le champ est absent (`anthropic→anthropic-compatible`, `openai→openai-compatible`, `gemini→gemini-native`) ; `throw` sur dialecte inconnu (`codex`, `antigravity` hors périmètre déclaré).
  - `resolveCapabilities(modelId, rawFamilyEntry: unknown): ModelCapabilities` — surcharge `modele.capacites ?? famille.capacites ?? none` (mécanisme nouveau : aucun héritage famille→modèle n'existe dans le code) ; validation stricte de la forme (clés inconnues/malformées → `GenerationParamsError`), le chargeur routeur étant un cast brut non validé.
  - `validateParams(params, caps, effectiveMaxTokens): void` — fail-closed : `GenerationParamsError` explicite sur toute violation (thinking non supporté, température hors bornes ou `"unsupported"`, `budgetTokens >= effectiveMaxTokens` — valeur **post-bridage KKT**). Minimum 2 assertions par chemin (règle `in_depth_validation`).
  - `toWireParams(dialect, params, caps, effectiveMaxTokens): Record<string, unknown>` — champs prêts à fusionner, indexés par **dialecte** : `anthropic-compatible` → `thinking: {type:'enabled', budget_tokens}` + `temperature` + `max_tokens` ; `openai-compatible` → `reasoning_effort` + `max_completion_tokens` (gpt-5) ou `max_tokens` + `temperature` si bornée ; `gemini-native` → sous-objet destiné à `generationConfig` (`temperature?`, `maxOutputTokens`, `thinkingConfig?`).
  - `applyPromptCaching(messages, caps): ChatMessage[]` — annotation défensive `cache_control: {type: 'ephemeral'}` (copie immuable, jamais de mutation en place).
- [x] **Verify**: `npx tsc --noEmit`.
- **Verification Proof**:
```text
$ npx tsc --noEmit
(exit 0)
# Livré : src/providers/GenerationParams.ts (~560 lignes) — exports
#   resolveProtocolDialect (fail-closed), resolveCapabilities (override
#   modeles[].capacites > capacites famille > CAPABILITIES_NONE),
#   validateParams (règle KKT), toWireParams (3 dialectes),
#   applyPromptCaching (copie défensive immutable)
```

### Step 3: Câblage du routeur (point d'injection unique)

- [x] **Action**: Au point d'appel unique `adapter.chat(...)` du routeur (ancre revérifiée à l'Étape 0 ; avant restructuration : `_invokeAdapter`, entre `_applyBudgetThrottling` l.1036 et le littéral d'options l.1039) :
  1. `dialect = resolveProtocolDialect(family, <entrée famille brute>)` ;
  2. `caps = resolveCapabilities(model, <entrée famille brute>)` ;
  3. `validateParams(<params extraits des options>, caps, activeOptions.max_tokens)` — fail-closed avant réseau (absorbé en `failedNonQuota` par la gestion d'erreur existante) ;
  4. fusion de `toWireParams(...)` dans le littéral sous la clé dédiée `wireParams`.
  Ne pas toucher aux chemins `embed`.
- [x] **Verify**: `npx tsc --noEmit && npx eslint src/providers/index.ts src/providers/GenerationParams.ts`.
- **Verification Proof**:
```text
$ npx tsc --noEmit
(exit 0)
$ npx eslint src/providers/index.ts src/providers/GenerationParams.ts --max-warnings=0
(exit 0 — aucune sortie)
# Câblage : _prepareWireParams appelé dans _invokeAdapter APRÈS
#   _applyBudgetThrottling ; portail d'applicabilité = familles déclarant
#   protocol_family ou capacites (5 natives sans injection : cohere,
#   cloudflare, huggingface, modal, groq — zéro changement de comportement)
```

### Step 4: Consommation de `wireParams` par les moteurs et les natifs

- [x] **Action**: Les constructeurs de payload (moteurs et natifs) bâtissent le body champ par champ sans spreader les options — chaque consommateur fusionne `options.wireParams` explicitement :
  - `src/providers/families/protocols/OpenAICompatibleProtocol.ts` (créé par le plan amont) : fusion de `wireParams` dans le body ChatCompletions — couvre **toutes** les familles `openai-compatible`, secondaires déclaratives incluses.
  - `src/providers/families/protocols/AnthropicCompatibleProtocol.ts` (id) : fusion + application de `applyPromptCaching` aux blocs de contenu avant assemblage.
  - Natifs conservés à adapter : `openai.ts` (retrait du défaut `temperature = 0.7` codé en dur l.29 au profit de l'émission conditionnelle via `wireParams` — changement documenté : absence de température = défaut API, requis pour gpt-5), `anthropic.ts` (extension d'`AnthropicRequestBody` l.52-58 avec `thinking?`/`temperature?` ; conservation du floor `REQUIRED_MAX_TOKENS_FLOOR` comme repli hors-routeur), `gemini.ts` (fusion dans `generationConfig` ; **correction incluse du bug** `maxOutputTokens` figé à 1000 ignorant `options.max_tokens` l.190-196 — le throttling KKT redevient effectif pour Gemini ; usage du type existant `GeminiGenerationConfig.thinkingConfig`, `geminiTypes.ts:98-103`).
  - Stratégie d'évitement si natif ≈ moteur : si le Step 2 amont a fait des natives `anthropic.ts`/`openai.ts` de simples coquilles déléguant aux moteurs, la consommation ne s'implémente qu'une fois côté moteur (à constater à l'Étape 0).
  - Exclusions : `codex.ts`, `antigravity.ts` (natifs sans famille JSON ni paramètres de génération).
- [x] **Verify**: `npx tsc --noEmit && npx eslint src/providers/ --max-warnings=0`.
- **Verification Proof**:
```text
$ npx tsc --noEmit
(exit 0)
$ npx eslint src/providers/ --max-warnings=0
(exit 0 — 15 findings initiaux résolus en 3 itérations, sans aucune
 suppression ; règle 17 respectée)
# Consommation : mergeWireParams (dernier mot) dans les 2 moteurs ; natifs
#   openai.ts (défaut temperature 0.7 retiré), anthropic.ts (thinking +
#   floor 4096 conservé), gemini.ts (bug maxOutputTokens=1000 corrigé —
#   options.max_tokens puis wireParams gagnent)
```

### Step 5: Tests unitaires de traduction (preuve obligatoire, hors-ligne)

- [x] **Action**: Créer `src/tests/unit/providers/generation_params.test.ts` (ramassé par `npm test` **et** `npm run test:unit` ; `testMatch: '**/tests/**/*.test.ts'`, `jest.config.js:23`). Stack réelle : **Jest + ts-jest ESM** ; pas de `nock` dans le repo.
  - Pattern imposé (précédent `src/tests/unit/providers/geminiCli.test.ts:3-16`) : mock de `global.fetch` typé `jest.MockedFunction<typeof fetch>`, sauvegarde/restauration `originalFetch`, réponses `as Partial<Response> as Response`, assertion sur `JSON.parse(String(mockFetch.mock.calls[n][1].body))`. Imports relatifs `.js`, `import { jest, ... } from '@jest/globals'`, `jest.unstable_mockModule` + `await import()` top-level si mock de module, aucun alias TS, aucun `@ts-expect-error`/`eslint-disable` (hook, règle 17).
  - Cas couverts (module pur + chemins moteurs + natifs) :
    - Dialecte `anthropic-compatible` : `budgetTokens=8000` → `thinking.type='enabled'`, `budget_tokens=8000`, `budget_tokens < max_tokens` validé contre la valeur post-bridage ; `promptCaching=true` → `cache_control` posé, entrée non mutée (aliasing testé). Vérifié **au moins** via le moteur + via `anthropic.ts`.
    - Dialecte `openai-compatible` : `effort` → `reasoning_effort` + `max_completion_tokens` ; `temperature` sur capacité `"unsupported"` → `GenerationParamsError` avant tout fetch (`mockFetch` jamais appelé). Vérifié via le moteur (couvre de fait les familles secondaires) + via `openai.ts`.
    - Dialecte `gemini-native` : `thinkingBudget` → `generationConfig.thinkingConfig` ; `max_tokens` routeur → `maxOutputTokens` honoré (régression du bug `gemini.ts:190-196`).
    - Capacités absentes : tout paramètre non supporté → rejet explicite.
    - Précédence KKT : bridage à 200 + `budgetTokens ≥ 200` → rejet.
    - Arbitrage options statiques moteur : un défaut JSON du `ProtocolFamily` n'écrase jamais un `wireParams` validé.
  - Complément — pas doublon — de la suite amont `src/tests/provider_families.test.ts` (Step 4 amont) : celle-ci teste URL/headers/body structurels, la nôtre teste le contenu de génération.
- [x] **Verify** (préfixe d'env obligatoire) :
  `cd /home/omni/Code/HIVE-MIND-RAILWAY && NODE_ENV=test SUPABASE_URL=http://localhost:54321 SUPABASE_KEY=dummy REDIS_URL=redis://localhost:6379 NODE_OPTIONS='--experimental-vm-modules' npx jest src/tests/unit/providers/generation_params.test.ts --forceExit`
  puis `npm test` global (hook 8 couches : Prettier, `tsc --noEmit`, ESLint `--max-warnings=0`).
- **Verification Proof**:
```text
$ npx jest src/tests/unit/providers/generation_params.test.ts --forceExit
Test Suites: 1 passed, 1 total
Tests:       44 passed, 44 total
Time:        9.135 s (puis 9.374 s après restructure lint)
$ npm test -- --maxWorkers=1
Test Suites: 68 passed, 68 total
Tests:       531 passed, 531 total
Time:        111.463 s
$ npx tsc --noEmit && npx eslint src/ --max-warnings=0 && npx prettier --check <touched>
(exit 0 partout — hook 8 couches satisfait sur le périmètre)
```

### Step 6: Smoke réel optionnel (selon clés disponibles)

- [x] **Action**: Ajouter à `.GCC/branches/test_afaire.md` : appel réel Anthropic (`usage.cache_read_input_tokens`, traces de thinking), appel Gemini (`thoughtsTokenCount`), vérification empirique que gpt-5 rejette une `temperature` non défaut (conditionne `"unsupported"` du Step 1), et un appel via une famille secondaire `openai-compatible` déclarée en JSON (preuve du canal `capacites` sans fichier `.ts`).
- [ ] **Verify**: Exécution manuelle loggée dans `.GCC/branches/test.md` (protocole GCC-E).
  - ⏳ **NON EXÉCUTÉ (2026-08-05)** : nécessite des clés API réelles ; entrées reportées dans `test_afaire.md` §8, bilan dans `test.md`.

## ⚠️ Mitigations & Edge Cases

- **Risque**: Dérive des ancres du plan amont (le Step 2 amont retouche `index.ts` ; `_invokeAdapter`, les lignes citées et même la forme des natives peuvent bouger).
  - **Mitigation**: Étape 0 de revérification obligatoire avant tout code ; le présent plan est mis à jour *avant* implémentation si l'ancre a bougé. Application autonome à l'exécution.
- **Risque**: Collision avec la mitigation amont « options par défaut du `ProtocolFamily` via JSON » (deux canaux pour des paramètres de génération).
  - **Mitigation**: Règle d'arbitrage documentée dans l'invariant : JSON statique = possibles/défauts fournisseur ; `wireParams` validé prime ; un rejet `validateParams` est irréfragable par un défaut JSON. Testée au Step 5.
- **Risque**: Les proxies compatibles OpenAI rejettent les champs inconnus du body (HTTP 400).
  - **Mitigation**: Traduction strictement conditionnée à `capacites` (défaut = capacités nulles). Post-Step 5 amont, le seul émetteur `openai-compatible` est le moteur — la discipline est mécaniquement garantie en un seul endroit.
- **Risque**: Incohérence budgétaire Anthropic (`budget_tokens >= max_tokens` → 400 API).
  - **Mitigation**: Validation croisée contre `effectiveMaxTokens` **post-bridage** ; un bridage à 200 rend invalide tout thinking ≥ 200 → rejet explicite, jamais d'envoi.
- **Risque**: JSON chargé par cast brut sans validation côté routeur.
  - **Mitigation**: `resolveCapabilities`/`resolveProtocolDialect` reçoivent `unknown`, valident strictement et jettent. `config.schema.ts` non étendu dans ce chantier (vérité unique dans le module).
- **Risque**: Retrait du défaut `temperature = 0.7` d'`openai.ts` change le comportement des modèles OpenAI classiques.
  - **Mitigation**: Changement assumé et documenté (absence = défaut API ; requis pour gpt-5 ; tous les appelants métier recensés passent déjà une valeur explicite).
- **Risque**: Mutation des messages lors de l'annotation `cache_control` (aliasing).
  - **Mitigation**: Copie défensive (`indirection_control`), testée au Step 5.
- **Risque**: Gemini prompt-caching implicite (seuil 2048 tokens) perçu comme actif.
  - **Mitigation**: Hint no-op déclaré dans le contrat et documenté dans le résultat.
- **Risque (amont, signalé)**: Statut de `geminiCli.ts` ambigu dans le plan Protocol/Header (ni listé parmi les natifs conservés, ni explicitement supprimé) ; divergence `maxOutputTokens` 8192 vs 1000 entre `geminiCli.ts`/`antigravity.ts` et `gemini.ts`.
  - **Mitigation**: Tranché à l'Étape 0 **avec l'utilisateur** s'il n'a pas été arbitré pendant l'exécution du plan amont — je ne décide pas seul du sort d'un natif.

## 🔍 Constats vérifiés (exploration 4 agents du code pré-restructuration, 2026-08-05)

**Constats qui survivent à la restructuration :**

| Constat | Référence (pré-restructuration) |
|---|---|
| Point d'appel unique `adapter.chat` + bridage KKT juste avant | `src/providers/index.ts:1036-1045` (à revérifier, Étape 0) |
| Absorption fail-closed des throws | `src/providers/index.ts:966-979` + `QUOTA_ERROR_PATTERN` l.208 |
| JSON chargé cast brut (sans Zod) au routeur | `src/providers/index.ts:237-243` |
| JSON validé Zod (2 autres lecteurs) | `src/config/index.ts:86,40,45` ; `src/core/ServiceContainer.ts:106-113` |
| Schéma permissif familles + racine | `src/config/config.schema.ts:60,63` |
| Signatures d'index (`wireParams` traversant) | `src/providers/index.ts:112` ; `src/providers/types.ts:97,77-80` |
| `AnthropicRequestBody` fermé, floor en dur | `src/providers/adapters/anthropic.ts:52-58,19-26,126-133` |
| `temperature = 0.7` en dur, pas de `max_completion_tokens` | `src/providers/adapters/openai.ts:29,34,37-41` |
| `maxOutputTokens` figé 1000 ignorant `options.max_tokens` (bug KKT) | `src/providers/adapters/gemini.ts:22-30,179,190-196` |
| `thinkingConfig` typé mais jamais émis | `src/providers/geminiTypes.ts:98-103` |
| Codex sans paramètre de génération | `src/providers/adapters/codex.ts:247-258` |
| Zéro occurrence `thinking`/`cache_control`/`reasoning_effort` | grep `src/` négatif |
| Aucun test existant pour anthropic/openai/gemini | `src/tests/unit/providers/` |
| Tests config non impactés par `capacites` | `src/tests/unit/config/models_config_policy.test.ts:22-50` |
| Absence d'o-series / modèles cibles gpt-5 | `models_config.json:383-402` |
| Absence de familles codex/antigravity dans le JSON | `models_config.json` (30 clés `familles`) |

**Constats rendus obsolètes par la restructuration (à ne pas propager)** :

| Constat v2 | Pourquoi obsolète |
|---|---|
| 26 adapters à `max_tokens` codé en dur (`groq.ts:39`, …) | Fichiers supprimés (Step 5 amont) — remplacés par moteur + JSON |
| Précédents ad hoc `openrouter.ts:79-82` / `nvidia.ts:48-74` | Idem — deviennent traductions déclaratives via `capacites` |
| Traduction ciblant « 3 natives séparées » | Dialecte partagé moteur/natif via `protocol_family` |

## 🐞 Anomalies découvertes hors périmètre (décision utilisateur requise, non traitées ici)

1. **Bug inerte** : `src/services/agentic/Planner.ts:582` et `src/services/tagService.ts:52` passent `maxTokens` en camelCase — champ silencieusement avalé par la signature d'index de `ChatOptions`, jamais lu (le contrat est `max_tokens`).
2. **Références orphelines** : `chat_recipes` pointe vers 9 modèles inexistants (`claude-opus-4-6-thinking`, `gpt-5.5`, `gemini-3.1-pro-high` — `models_config.json:142-176` ; `parseModelString` renvoie `null` avec warning, `index.ts:291-308`).
3. **Ambiguïté de périmètre amont** : statut de `geminiCli.ts` non tranché par `plan_provider_protocol_families.md` ; divergence `maxOutputTokens` 8192/1000 entre `geminiCli.ts`/`antigravity.ts` et `gemini.ts`.
4. **Clé morte** : `reglages_generaux.model_capabilities` (documentation sans lecteur).
