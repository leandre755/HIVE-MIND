# Execution Plan: Fix des 6 bugs restants (#20 #23 #27 #33 #36 #37) + Épopée couverture #112

## 📋 Target Invariant & Pre-requisites
- **Target Invariant**: `npm run build` (tsc) 0 erreur, `npm run lint:fast` (oxlint) 0 warning, `npm run test:unit` 100% au vert ; toute I/O `fs` passe par `src/utils/safeFs.ts` (hors safeFs lui-même) ; zéro timer non `clearTimeout` à la résolution ; zéro `Function('return import(...)')` ; `gemini-native` résoluble via le registre des familles.
- **Pre-requisites**: `npm install --include=dev --ignore-scripts && npm rebuild` (NODE_ENV=production masquait les devDeps au départ — corrigé), `gh` authentifié, compte agent `hivemindagent-boop`.

## 🛠️ Step-by-Step Sequence

### Step 1: Fix #20 — MailboxWatcher (rejet non géré du callback setInterval)
- [x] **Action**: `src/services/events/MailboxWatcher.ts` — wrap du `pushEvent` en try/catch avec log.
- [ ] **Verify**: test unitaire (pushEvent qui rejette → aucun unhandled rejection, console.error émis).

### Step 2: Fix #27 — StateManager (corruption `names`)
- [x] **Action**: `src/services/state/StateManager.ts` — `_flattenForRedis` sérialise tableaux/objets en JSON, `_unflattenFromRedis` + `_parseNames` (JSON.parse + Array.isArray, repli legacy split(',')). Ligne de front : plus jamais `String(v)` sur `names`.
- [ ] **Verify**: tests round-trip `['Alexandre','Alex']` (sous-agent couverture StateManager en charge).

### Step 3: Fix #33 — Telegram (getMe() par message)
- [x] **Action**: `src/core/transport/telegram.ts` — `selfId` mis en cache (`resolveSelfId`, promesse unique), résolu à `connect()`, réutilisé par le handler, réinitialisé à `disconnect()`.
- [ ] **Verify**: test (3 événements message → `getMe` appelé 1 seule fois).

### Step 4: Fix #23 — PermissionManager (timers jamais clear)
- [x] **Action**: `src/core/security/PermissionManager.ts` — `PendingRequest.timers: Set<NodeJS.Timeout>`, timers Hub (HUB_TIMEOUT_MS) et In-Band (INBAND_TIMEOUT_MS) trackés, `_cleanup` central purge `clearTimeout` sur tous les chemins de résolution.
- [ ] **Verify**: test unitaire (approbation → `clearTimeout` invoqué, `pendingCount` 0).

### Step 5: Fix #36 — Migration safeFs (I/O `fs` directe)
- [x] **Action**: migration de `google_ai_search/index.ts`, `admin/index.ts`, `journal_generator.ts`, `audioHandler.ts`, `TieredContextLoader.ts`, `readFileInRange.ts`, `cleanup.ts`, `loader.ts` vers safeFs ; `safeFstat` + re-exports de types (`Stats`, `Dirent`, `ReadStream`, `WriteStream`) ajoutés à `safeFs.ts`. Sous-agent dédié : `src/scripts/**` + `src/tests/**`.
- [ ] **Verify**: grep statique `from 'fs'|from 'node:fs'|require('fs')` sur `src/` → uniquement `safeFs.ts` (+ exceptions de mocks documentées) ; suites existantes au vert.

### Step 6: Fix #37 — gemini-native + purge `Function('return import(...)')`
- [x] **Action**: nouveau `src/providers/families/protocols/GeminiNativeProtocol.ts` (generateContent/streamGenerateContent, contents/parts, systemInstruction, functionDeclarations, usageMetadata) + `headers/XGoogApiKeyHeaders.ts` (`x-goog-api-key`) + enregistrement registry + `buildStreamUrl`/`streamUsesBodyFlag` dans `ProtocolFamily` + retrait du garde `ensureProtocolSupported` (ExecutionLayer) + branche candidates Gemini dans `extractDeltaFields` + remplacement de `Function('return import(...)')` par `import()` natif dans `providers/index.ts`.
- [ ] **Verify**: tests unitaires du protocole + résolution registry + `tsc` 0 erreur.

### Step 7: Couverture #112 (Palier 1 : 65% globale)
- [ ] **Action**: sous-agents — `StateManager`, `LockManager` (≥90% lignes) ; `WakeSystem`, `logger`, `toolCallExtractor`, `startup`, `fuzzyMatcher` (≥85% lignes).
- [ **Verify**: `jest --coverage` ciblé sur ces fichiers + rapport de couverture brut.

### Step 8: Revue locale + livraison
- [ ] **Action**: revue locale (CodeRabbit CLI / sous-agents), batch de correctifs, commits atomiques par issue, branche `fix/remaining-bugs-and-coverage`, PR avec template.
- [ ] **Verify**: `npm run build && npm run lint:fast && npm run test:unit` (raw outputs collés ci-dessous) + CI verte + revues bots lues intégralement.

## ⚠️ Mitigations & Risks
- **Risk**: `NODE_ENV=production` sur le poste masque les devDeps (`npm install` par défaut les saute). **Mitigation**: toujours `npm install --include=dev` ; consigné dans `.GCC/resume.md`.
- **Risk**: gate Codecov « 100% patch coverage » sur les lignes modifiées des fichiers déjà couverts. **Mitigation**: tests unitaires par fix + micro-tests sur ExecutionLayer/providers-index si lcov signale des lignes modifiées non couvertes.
- **Risk**: contention CPU 2 cœurs avec les sous-agents de couverture. **Mitigation**: validations séquentielles, jamais 2 jest en parallèle.

## 🧪 Verification Proofs (raw outputs)

- Typecheck (post-fix #37 refactor) : `npm run build` → `tsc --noEmit`, sortie vide, exit 0.
- Lint ciblé : `npx oxlint` sur 23 fichiers modifiés → `Found 0 warnings and 0 errors. Finished in 27ms on 23 files with 96 rules using 4 threads.` ; `npx eslint` sur GeminiNativeProtocol.ts + ExecutionLayer.ts → 0 problème (après extraction `imagePartFromUrl`/`parseToolArguments`/`extractChoicesDeltaFields` pour `sonarjs/cognitive-complexity`).
- Tests des fixes : `npx jest mailboxWatcher telegramGetMe permissionManagerTimers geminiNativeProtocol` → `Test Suites: 3 passed` puis après correction `advanceTimersByTimeAsync` : **16/16** ; `permissionManagerTimers + permissionManager` → `Test Suites: 2 passed, 2 total / Tests: 60 passed, 60 total`.
- Migration safeFs (sous-agent) : `npx tsc --noEmit` exit 0 ; suites relancées une à une : `generation_params 44/44`, `models_config_policy 1/1`, `fileStateCache 3/3`, `pidLock 5/5`, `LSPTool 6/6`, `tieredContextLoader 5/5`, `provider_families 34/34` après mise à jour des attentes registre (D.3/D.4).
- Validation complète (2026-09-23 01:24Z) : `npm run build` → BUILD_EXIT=0 ; `npm run lint:fast` → LINT_EXIT=0 ; `npm run test:unit` → TEST_EXIT=0 — `Test Suites: 96 passed, 96 total / Tests: 975 passed, 975 total / Time: 30.488 s`.
- Quality Gate pre-commit : 8/8 franchie sur les 7 commits (gitleaks 0 leak, oxlint 0/0, prettier OK, eslint 0, semgrep 0 finding), commit-msg Conventional validé.
- Recherche statique `from 'fs'|from 'node:fs'|require('fs')` sur `src/` : `src/utils/safeFs.ts` (wrapper lui-même), `tieredContextLoader.test.ts` (machinerie de mock documentée), `test_remaining_e2e.ts:111` (chaîne dans un prompt = faux positif), `Planner.ts:687` (exemple dans un prompt LLM = faux positif).
