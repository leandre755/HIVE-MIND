# Execution Plan: Restructuration du Routeur de Providers par Familles (Protocol & Headers)

## 📋 Target Invariant & Pre-requisites

- **Target Invariant**: Le routeur de providers s'appuie sur une architecture à deux axes orthogonaux (`ProtocolFamily` x `HeaderFamily`). Les providers secondaires sont déclarés dans `models_config.json` sans nécessiter de fichier `.ts` individuel. Le code compile, toutes les requêtes émettent le bon payload/headers, et les ~30 fichiers adapters redondants sont supprimés.
- **Protocol Families**:
  - `openai-compatible` : format ChatCompletions standard, messages, tools, usage.
  - `anthropic-compatible` : format Messages API standard, system prompt séparé, tool_use.
- **Header Families**:
  - `claude-code` : signature complète Stainless (`User-Agent: claude-cli/...`, `X-Stainless-Lang/OS/Runtime...`, `anthropic-beta: claude-code-...`, `x-app: cli`, `anthropic-dangerous-direct-browser-access: true`).
  - `standard-bearer` : `Authorization: Bearer <KEY>`.
  - `x-api-key` : `x-api-key: <KEY>`.
- **Core Adapters conservés dans `src/providers/adapters/`**:
  - `openai.ts`, `gemini.ts`, `anthropic.ts`, `codex.ts` / `antigravity.ts` (implémentations natives spécifiques).

## 🛠️ Step-by-Step Sequence

### Step 1: Implémenter les moteurs de Familles (Protocol & Headers)

- [x] **Action**: Créer les deux registres d'abstraction dans `src/providers/families/`:
  - `src/providers/families/protocols/` (`OpenAICompatibleProtocol.ts`, `AnthropicCompatibleProtocol.ts`).
  - `src/providers/families/headers/` (`ClaudeCodeHeaders.ts`, `StandardBearerHeaders.ts`, `XApiKeyHeaders.ts`).
- [x] **Verify**: `npx tsc --noEmit`.
- **Verification Proof**:
```text
$ npx tsc --noEmit
(exit 0 — aucune sortie)
# Livré : src/providers/families/{types,registry}.ts, protocols/{OpenAI,
#   Anthropic}CompatibleProtocol.ts + wireMerge.ts, headers/ x4
#   (StandardBearer, StandardToken, XApiKey, ClaudeCode)
```


### Step 2: Créer le `GenericProviderAdapter` et adapter le `ProviderRouter`

- [x] **Action**: Créer `src/providers/GenericProviderAdapter.ts` qui combine un `ProtocolFamily` et une `HeaderFamily` à partir de la configuration d'un provider.
- [x] **Action**: Mettre à jour `src/providers/index.ts` pour instancier dynamiquement un `GenericProviderAdapter` pour toute famille déclarée dans `models_config.json` n'ayant pas d'adapter natif dédié.
- [x] **Verify**: `npx tsc --noEmit && npx eslint src/providers/`.
- **Verification Proof**:
```text
$ npx tsc --noEmit
(exit 0)
$ npx eslint src/providers/ --max-warnings=0
(exit 0 — aucune sortie)
# Livré : GenericProviderAdapter.ts (résolution paresseuse à chat(),
#   timeout AbortController, fusion extra_headers) + index.ts câblé
#   (8 natifs + boucle générique sur familles JSON)
```


### Step 3: Enrichir `models_config.json` avec la liaison des familles

- [x] **Action**: Déclarer pour chaque provider secondaire dans `models_config.json` : `protocol_family`, `header_family`, `base_url`, `env_key`, et la liste des `modeles`.
- [x] **Verify**: Valider le schéma JSON et le chargement du routeur via `npx tsc --noEmit`.
- **Verification Proof**:
```text
$ python3 -c "json.load(open('src/config/models_config.json'))"
(OK — 25 familles, protocol_family/header_family/protocol_options liés)
$ npx tsc --noEmit
(exit 0)
$ npx jest smart_router_v2 models_config_policy envResolver keyResolver --forceExit
Test Suites: 4 passed, 4 total
Tests:       19 passed, 19 total
Time:        27.077 s
# Corrections appliquées durant ce Step : opencodezen base_url
#   (opencode.ai/zen/v1 -> api.opencode.ai/v1), mistral base_url ajoutée
#   (https://api.mistral.ai/v1)
```


### Step 4: Écrire les tests de non-régression réseau

- [x] **Action**: Créer la suite de tests unitaires/intégration `src/tests/provider_families.test.ts` vérifiant que chaque provider génère l'URL, les headers et le body JSON exacts.
- [x] **Verify**: `npm test -- src/tests/provider_families.test.ts`.
- **Verification Proof**:
```text
$ npx jest src/tests/provider_families.test.ts --forceExit
Test Suites: 1 passed, 1 total
Tests:       33 passed, 33 total
Time:        10.012 s (puis 9.145 s après réalignement)
# NOTE: les 2 écarts figés par le garde-fou ont été RÉSOLUS dans le code
#   avant suppression (1. protocol_options.extra_headers fusionné par le
#   GenericProviderAdapter ; 2. base_url mistral dans le JSON) — suite
#   réalignée, commentaire d'en-tête mis à jour
```


### Step 5: Suppression des ~30 adapters redondants et nettoyage du registre

- [x] **Action**: Supprimer les fichiers `.ts` secondaires dans `src/providers/adapters/` (`ai21.ts`, `baseten.ts`, `cerebras.ts`, `fireworks.ts`, `hyperbolic.ts`, `nebius.ts`, `novita.ts`, `scaleway.ts`, etc.).
- [x] **Action**: Mettre à jour le mapping `loadAdapters()` dans `src/providers/index.ts` pour ne charger en auto-import que les adapters natifs complexes.
- [x] **Verify**: `npx tsc --noEmit && npx eslint . --max-warnings=0 && npm test`.
- **Verification Proof**:
```text
$ git rm src/providers/adapters/{ai21,alibaba,baseten,cerebras,codestral,
    fireworks,github,hyperbolic,inferencenet,kimi,mistral,moonshot,nebius,
    nlpcloud,novita,nvidia,opencodezen,openrouter,sambanova,scaleway,
    upstage,vercel}.ts
(22 fichiers supprimés — 0 import orphelin résiduel, grep vérifié)
$ npx tsc --noEmit
(exit 0)
$ npx eslint src/ --max-warnings=0
(exit 0 — aucune sortie)
$ npx prettier --check <fichiers touchés>
(propre après --write ; 12 fichiers legacy hors périmètre non formatés
 pré-existants, non touchés)
$ npm test -- --maxWorkers=1
Test Suites: 68 passed, 68 total
Tests:       531 passed, 531 total
Time:        111.463 s
```


## ⚠️ Mitigations & Edge Cases

- **Risque**: Un provider peut requérir un paramètre spécifique dans le payload (ex: `temperature`, `max_tokens` custom).
  - **Mitigation**: Le `ProtocolFamily` accepte un objet d'options par défaut surchargable via `models_config.json`.
- **Risque**: Clés d'API absentes au démarrage pour un provider secondaire.
  - **Mitigation**: Le `GenericProviderAdapter` vérifie la présence de la clé au moment de l'invocation et échoue proprement sans bloquer le démarrage du routeur.
