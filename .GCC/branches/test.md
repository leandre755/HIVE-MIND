# Test Execution Log

## 📅 Date: 2026-09-06

## 🧪 Unit Test Results (InMemoryRedisMock - Issue #25)
- Run command: `npm test -- src/tests/unit/services/redisClient.test.ts`
- Status: **PASSED (44/44 tests green)**
- Output:
```text
PASS src/tests/unit/services/redisClient.test.ts
  InMemoryRedisMock - Strings & Keys (10 tests)
  InMemoryRedisMock - Lists (rPush, lPush, lTrim, lRange, lRem) (7 tests)
  InMemoryRedisMock - Sets & Hashes (hDel, hLen, sCard) (4 tests)
  InMemoryRedisMock - Sorted Sets (zAdd, zRangeByScore, zRemRangeByScore, zCard) (5 tests)
  InMemoryRedisMock - Eval (LockManager atomic script) (3 tests)
  InMemoryRedisMock - Multi Pipeline (3 tests)
  InMemoryRedisMock - Edge cases and advanced semantics (11 tests, including UTF-8 binary tie-breaking and Lua literal case preservation)
  switchToMock and WorkingMemory Integration (1 test)

Test Suites: 1 passed, 1 total
Tests:       44 passed, 44 total
Snapshots:   0 total
Time:        34.693 s
```

## 🧪 Global Unit Test Verification
- Run command: `npm run test:unit`
- Status: **PASSED (759/759 tests green)**
- Output:
```text
Test Suites: 76 passed, 76 total
Tests:       759 passed, 759 total
Snapshots:   0 total
```

## 🧪 Static Codebase Quality Gates
- `npm run lint:fast` (oxlint): **PASSED** (0 warnings, 0 errors across 333 files)
- `npm run build` (tsc --noEmit): **PASSED** (0 errors)
- `npx eslint src/services/redisClient.ts src/tests/unit/services/redisClient.test.ts`: **PASSED** (0 errors, 0 warnings)
- `Prettier`: **PASSED** (100% compliant)
- `Semgrep OSS`: **PASSED** (210 rules, 0 findings)
- `gitleaks`: **PASSED** (0 leaks)


## 🧪 Unit Test Results (Auth Provider Model Registry)
- Run command: `npm test -- --runTestsByPath src/tests/unit/config/models_config_policy.test.ts`
- Status: **PASSED**
- Output:
```text
Test Suites: 1 passed, 1 total
Tests:       1 passed, 1 total
Snapshots:   0 total
Time:        9.672 s
Ran all test suites within paths "src/tests/unit/config/models_config_policy.test.ts".
```

## 🧪 Static Validation Results (Auth Provider Model Registry)
- Run command: `npx eslint src/services/authProviderModelRegistry.ts src/providers/index.ts src/services/quotaManager.ts`
- Status: **PASSED**
- Output: command exited with code 0 and no lint output.
- Run command: `npx tsc --noEmit`
- Status: **FAILED on pre-existing TUI strict nullability errors outside the touched files**
- Output:
```text
src/tui/ui/hooks/useCommandCompletion.tsx(399,65): error TS2532: Object is possibly 'undefined'.
src/tui/ui/hooks/useShellCompletion.ts(471,76): error TS2532: Object is possibly 'undefined'.
src/tui/ui/hooks/useShellCompletion.ts(486,80): error TS2532: Object is possibly 'undefined'.
src/tui/ui/hooks/useShellCompletion.ts(492,80): error TS2532: Object is possibly 'undefined'.
src/tui/ui/hooks/useShellCompletion.ts(579,84): error TS2532: Object is possibly 'undefined'.
src/tui/ui/hooks/useShellCompletion.ts(604,80): error TS2532: Object is possibly 'undefined'.
src/tui/ui/hooks/useSlashCompletion.ts(191,61): error TS2532: Object is possibly 'undefined'.
src/tui/ui/hooks/useSlashCompletion.ts(252,73): error TS2532: Object is possibly 'undefined'.
src/tui/ui/hooks/useSlashCompletion.ts(368,69): error TS2532: Object is possibly 'undefined'.
src/tui/ui/hooks/useSlashCompletion.ts(374,57): error TS2532: Object is possibly 'undefined'.
src/tui/ui/hooks/useSlashCompletion.ts(597,61): error TS2532: Object is possibly 'undefined'.
```

## 📅 Date: 2026-06-04

## 🚀 E2E CLI Battery Results (Test 1)
- Run command: `npx tsx src/scripts/run_cli_battery.ts --first`
- First attempt status: **FAILED BEFORE BOOT** under sandbox with `listen EPERM /tmp/tsx-1000/15.pipe`.
- Retried with escalation outside sandbox.
- Final runner status: **COMPLETED WITH TEST TIMEOUT** (process exit 0, report generated).
- Report: `TEST_RESULT/battery_test/e2e_battery_report_1.md`.
- Verdict: **TIMEOUT** — Files `0/2`, Text length `0` chars.
- Blocking symptoms observed:
- Initial Supabase DNS failures: `getaddrinfo ENOTFOUND amikgmbhvlwfaheikxdr.supabase.co`.
- Cloudflare/Supabase host failures: `521 Web server is down`.
- PostgREST schema cache failure: `PGRST205` — missing `public.global_admins` in schema cache.
- Conclusion: Battery 1 did not validate the Zod-native tool schema path because the runtime did not process the injected CLI message to a captured response.

## 🧪 Unit Tests & Static Validation (Native Zod Tool Schemas)
- Run command: `npm test -- src/tests/unit/utils/toolExecution.test.ts --runInBand`
- Initial status: **FAILED as expected (red)** — old `zod-to-json-schema` path emitted only `$schema` for the Zod v4 object case, proving the contract gap.
- Final status: **PASSED (100% SUCCESS, 2/2 tests green)** after migrating `defineZodTool` to native `z.toJSONSchema`.
- Run command: `npm run build`
- Status: **PASSED (100% SUCCESS, 0 TypeScript errors)**.
- Run command: `npx eslint src/utils/toolExecution.ts src/tests/unit/utils/toolExecution.test.ts`
- Status: **PASSED (100% SUCCESS, 0 errors, 0 warnings)**.
- Run command: `rg -n "openai/helpers/zod|zodFunction|zod-to-json-schema|zodToJsonSchema" src package.json`
- Status: **VERIFIED** — no direct source or package dependency remains.

## 📅 Date: 2026-05-19

## 🧪 Unit Tests Results
Run command: `NODE_OPTIONS='--experimental-vm-modules' npx jest tests/unit/services/RuntimeInfrastructure.test.ts`
Status: **PASSED (100%)**

- `✓ should correctly initialize budget and track usage` (85 ms)
- `✓ should trigger kill switch when budget is exceeded` (21 ms)
- `✓ should calculate Lagrangian KKT lambda correctly based on budget depletion` (3 ms)
- `✓ should allow safe tools automatically without LLM evaluation` (2 ms)
- `✓ should allow admin actions automatically` (5 ms)
- `✓ should query LLM safety recipe for potentially risky actions` (5 ms)
- `✓ should flag laziness and provide kickback instructions if agentic laziness is detected` (3 ms)

## 🚀 E2E Local Integration Results
Run command: `npx tsx scripts/test_cli_e2e.ts`
Status: **VERIFIED WORKING**

- Boots full container successfully.
- Correctly resolves and launches Redis & Supabase in CLI test mode.
- Correctly loads providers and unifies runtime services.
- Clean shutdown on signal.

## 📅 Date: 2026-05-20

## 🧪 Unit Tests Results (MindOS & Constraints, DriverSystem)
- Run command: `NODE_OPTIONS='--experimental-vm-modules' npx jest tests/unit/core/tieredContextLoader.test.ts`
- Status: **PASSED (100%)**
- `✓ should load unified context and inject mindos drives & economic constraints in prompt`
- `✓ should support dynamic blueprint resolution per group settings`
- Run command: `NODE_OPTIONS='--experimental-vm-modules' npx jest tests/unit/mindos/DriverSystem.test.ts`
- Status: **PASSED (100%)**
- `✓ should cycle through drives and acquire lock`

## 📅 Date: 2026-05-20

## 🧪 Unit Tests & Compilation Results (Audit Fixes validation)
- Run command: `npx tsc --noEmit`
- Status: **PASSED (100% SUCCESS)**
- No compilation errors remaining.
- Run command: `NODE_OPTIONS='--experimental-vm-modules' npx jest tests/unit/core/tieredContextLoader.test.ts`
- Status: **PASSED (100%)**
- Resolved previous `blueprint` property type issues on context loader test unit.
- SubAgentEngine ephemeral RAM registration and teardown cycles verified.

## 🧪 Unit Tests Results (PermissionManager Sandbox1 Alignment)
- Run command: `NODE_OPTIONS='--experimental-vm-modules' npx jest tests/unit/core/permissionManager.test.ts --forceExit`
- Status: **PASSED (100% SUCCESS, 25/25 tests green)**
- Corrected `isInSandbox`, `validateBashCommand` and `validateFileWrite` assertions to target `pm.sandboxDir` instead of `process.cwd()`.

## 🏆 Global Suite Execution (npm test)
- Run command: `npm test`
- Status: **PASSED (100%)**
- Total: 41 test suites passed, 271 tests passed.
- No regressions detected.

## 📅 Date: 2026-05-22

## 🧪 Integration & Adapter Tests (Codex Provider Implementation)
- Run command: `npx tsc --noEmit`
- Status: **PASSED (100% SUCCESS)**
- No compilation errors remaining.
- Run command: `npx tsx /home/omni/.gemini/antigravity-ide/brain/e1434308-47a2-4f18-83e4-d2620550e02a/scratch/test_codex_adapter.ts`
- Status: **PASSED (100% SUCCESS)**
- Output successfully verifies:
- **`codex` adapter registration**: Registered successfully inside `providerRouter`.
- **Session file resolution**: `/home/omni/.codex/auth.json` loaded and authenticated correctly.
- **Request conversion**: Direct translation of messages array format into Codex flat payload structure.
- **Token refresh automatic**: Seamlessly refreshes access tokens and writes updates back to the session file.
- **Successful mock chat query**: Returned standard response from GPT-5.5 via Codex backend.

## 📅 Date: 2026-05-22

## 🚀 E2E Local Integration Results (CLI Battery)
- Run command: `npx tsx scripts/run_cli_battery.ts --first`
- Status: **SUCCESS (100% - 7/7 steps passed)**
- Key Achievements:
- The first test "Recherche Web avec Captures d'Écran" completed with 100% success.
- Successfully resolved the SerpApi Cloudflare 520 error by preventing the Planner from passing massive scraped content placeholders (like `{{step_X_result}}`) into search query arguments.
- Handled variable interpolation correctly (e.g. resolving the target article URL).
- Captured and transferred 2 screenshots of Hacker News (homepage and first article) to physical storage.
- Formulated the final text summary in French and sent it successfully to the user.
- Cleaned up remaining occurrences of the legacy "moralCompass" term in comments (`RuntimeInfrastructure.ts`).

## 📅 Date: 2026-05-23

## 🧪 Unit Tests Results (Antigravity Provider Integration)
- Run command: `npm run test:unit tests/unit/providers/antigravity.test.ts`
- Status: **PASSED (100% SUCCESS, 2/2 tests green)**
- Tests verified:
- **Successful chat call with mapping**: L'adaptateur d'Antigravity applique maintenant de façon transparente le mapping `MODEL_ALIASES` (ex: `gemini-3.1-pro-thinking` traduit en `gemini-3.1-pro-high`), cible l'endpoint de production réel `https://daily-cloudcode-pa.googleapis.com` et définit la plateforme en `PLATFORM_UNSPECIFIED` pour éviter les erreurs 400.
- **Token refresh error handling**: Gère proprement le refus de rafraîchissement d'OAuth.
- Run command: `npx tsc --noEmit`
- Status: **PASSED (100% SUCCESS)**
- Aucune erreur de typage ou d'importation dans tout le projet suite à l'introduction du mapping d'aliasing.

- Run command: `NODE_OPTIONS='--experimental-vm-modules' npx jest tests/unit/utils/TlsImpersonator.test.ts --forceExit`
- Status: **PASSED (100% SUCCESS, 4/4 tests green)**
- Tests verified: `getImpersonatedAgent` returns standard and Chromium ciphers correctly, and `impersonatedRequest` makes native HTTPS requests matching correct JA3 fingerprint.

- Run command: `NODE_OPTIONS='--experimental-vm-modules' npx jest tests/unit/services/ClearcutSimulator.test.ts --forceExit`
- Status: **PASSED (100% SUCCESS, 4/4 tests green)**
- Tests verified: `trackStartSession`, `trackNewPrompt`, and `trackToolCall` events map variables correctly and handle Google Clearcut upload formats natively.

- Run command: `NODE_OPTIONS='--experimental-vm-modules' npx jest tests/unit/providers/geminiCli.test.ts --forceExit`
- Status: **PASSED (100% SUCCESS, 2/2 tests green)**
- Tests verified: `geminiCli` adapter successfully processes chat requests and handles Google OAuth token refreshes using the new active credentials from `.env`.

- Run command: `NODE_OPTIONS='--experimental-vm-modules' npx jest tests/unit/providers/antigravity.test.ts --forceExit`
- Status: **PASSED (100% SUCCESS, 2/2 tests green)**
- Tests verified: `antigravity` adapter successfully processes chat requests and handles Google OAuth token refreshes using the active `ANTIGRAVITY_REFRESH_TOKEN` credentials from `.env`.

## 📅 Date: 2026-05-23

## 🚀 E2E Local Integration Results (CLI Battery)
- Run command: `npx tsx scripts/run_cli_battery.ts --id=2`
- Configuration: `gemini-3-flash-preview` (famille `gemini-cli`) en `EXECUTOR` et `PLANNER`.
- Status: **SUCCESS (2/2 files, Text length: 500 chars)**
- Details:
- Le routeur V2 a géré la cascade de 429 pour affecter la planification à `gemini-3-flash-preview` (via `gemini-cli`).
- Le nouveau prompt structuré basé sur le Chain of Thought ("Thinking" avant le JSON) et respectant les principes de `# Prompt.md` a permis à `gemini-3-flash-preview` de planifier avec succès en 4 étapes distinctes (1. browser_screenshot, 2. firecrawl_scrape, 3. execute_bash_command pour trending_repos.md, 4. send_file).
- La capture d'écran complète et le livrable Markdown contenant les 5 dépôts GitHub trending (nom, description, langage, étoiles) ont été générés et envoyés à l'utilisateur.
- La boucle d'auto-correction a parfaitement réinjecté l'erreur de schéma initiale ("must be object"), guidant le modèle vers une planification 100% valide à la 2e tentative.


## 📅 Date: 2026-05-23

## 🧪 Unit Tests Results (Service Fallback Circuit Breaker)
- Run command: `NODE_OPTIONS='--experimental-vm-modules' npx jest tests/smart_router_v2.test.ts --forceExit`
- Status: **PASSED (100% SUCCESS, 8/8 tests green)**
- Tests verified:
- **Primary model available**: `callServiceRecipe` calls the primary model correctly when healthy.
- **Cooldown active**: `callServiceRecipe` skips the primary model and pivots directly to the fallback if the family is in cooldown (circuit breaker active).
- **No quota (429 Proactive)**: `callServiceRecipe` skips the primary model and pivots directly to the fallback if the model has no quota (all key indices exhausted in `quotaManager`).
- **All models exhausted**: Throws a clean, explicit error if every model in the cascade is unavailable or in cooldown.
- Run command: `npx tsc --noEmit`
- Status: **PASSED (100% SUCCESS)**
- No type or compilation errors remaining in the test suite after casting mocks to `any`.
## 📅 Date: 2026-05-24

## 🧪 Unit Tests & Linter Verification (Post-Reorganisation validation)
- Run command: `npx eslint src/core/events.ts`
- Status: **PASSED (100% SUCCESS, 0 errors, 0 warnings)**
- Fully typed events.ts with strict contracts, resolving all implicit `any` type issues and trailing whitespaces under ESLint Flat Config.
- Run command: `npm run test:unit`
- Status: **PASSED (100% SUCCESS, 259/259 tests green)**
- Successfully ran all unit tests (259/259 pass) without a single regression or failures post-reorganisation.
- Run command: `npx tsc --noEmit`
- Status: **PASSED (100% SUCCESS, 0 errors)**
- No type or compilation errors remaining across the entire project repository.
- Verify command: `graphify update .`
- Status: **PASSED (100% SUCCESS)**
- Graphify CLI verified accessible globally via a symlink in `$PATH`, and graph updated successfully after removing deprecated source code (`contextBuilder.ts`, `utils/index.ts`, `services/index.ts`).

## 📅 Date: 2026-05-26

## 🏆 Global Static Analysis & Compilation Excellence (Objectif 0/0)
- Run command: `npx eslint .`
- Status: **PASSED (100% SUCCESS, 0 errors, 0 warnings)**
- Successfully achieved a totally clean linter state without using any global `/* eslint-disable */` or `// @ts-nocheck` comments in the codebase.
- Run command: `npx tsc --noEmit`
- Status: **PASSED (100% SUCCESS, 0 errors)**
- Fully strictly typed all core modules. Resolved TS18046 and TS2353 compilation errors in the un-overridden `src/core/context/TieredContextLoader.ts` by introducing the formal `UnifiedContext` exported interface.

## 🧪 Jest Unit & Integration Test Suites
- Run command: `npm test`
- Status: **PASSED (100% SUCCESS, 317/317 tests green)**
- Output: All 52 test suites and 317 test assertions completed successfully. Confirmed 100% runtime integrity.

## 📅 Date: 2026-05-26

## 🚀 E2E Local Integration Results (CLI Battery)
- Run command: `npx tsx src/scripts/run_cli_battery.ts --id=3`
- Status: **SUCCESS (100% SUCCESS, 3/3 steps passed)**
- Key Achievements:
- **Désactivation TTY / cli-progress robuste** : L'initialisation s'est faite de manière 100% textuelle propre en mode test (grâce au getter dynamique `isTest`), éliminant définitivement les signaux de suspension `Stoppé` du noyau Linux.
- **Planification CommonJS (.cjs) correcte** : Le Planner a généré et exécuté avec succès le script CommonJS `storage_hm/extract_text.cjs` en contournant l'erreur ES Modules grâce au correctif de l'exemple few-shot contredisant l'instruction de l'extension.
- **API pdf-parse v2 & variables valides** : Extraction du texte PDF réussie avec `new PDFParse({ data: dataBuffer })` et sauvegarde du résultat dans `test_document.md` (30 octets).
- **Durée** : 32.9 secondes pour un taux de réussite de 100% de bout en bout !

## 📅 Date: 2026-06-11

## 🧪 Validation statique de la TUI
- Run command: `npx tsc --noEmit`
- Status: **PASSED (100% SUCCESS sur le scope TUI)**
- Verdict: Les 6 erreurs TypeScript restantes spécifiques au code de la TUI (`src/tui/`) ont toutes été corrigées sans ajouter de directives `@ts-ignore` ou `eslint-disable`.
- Fichiers corrigés :
- `src/tui/ui/components/Footer.tsx` : Fourni des valeurs de fallback (`branchName ?? ''`, `model ?? ''`) pour assurer le passage de types string stricts.
- `src/tui/ui/components/shared/VirtualizedList.tsx` : Passé `isStatic ?? false` pour éviter une potentielle valeur `undefined` non acceptée.
- `src/tui/ui/components/shared/text-buffer.ts` : Changé le type casting dans le bloc exhaustif default de `action as any` en `action as never` pour satisfaire les exigences strictes de TypeScript.
- `src/tui/ui/components/shared/vim-buffer-actions.ts` : Importé `isCombiningMark` de `./text-buffer.js` ; mis à jour la signature et l'implémentation de `findCharInLine` pour accepter 6 arguments et retourner `-1` si non trouvé ; et mis à jour les appels dans `handleFindChar` et `handleDeleteToChar` pour valider `found !== -1`.

## 📅 Date: 2026-06-15 (session 4)

## 🧪 Validation E2E du pont core↔TUI
- Run command: `npx tsx scripts/diag-tui-io.ts`
- Status: **PASSED (100% SUCCESS)** avec `agentStart=1, agentEnd=1, response="Bonjour ! 😊 Comment puis-je vous aider aujourd'hui ?"`
- Verdict: Le pont TUI → core → TUI fonctionne bout en bout. Un message utilisateur est envoyé, traité par le Router (FAST_CHAT → AGENTIC), exécuté via un LLM fallback, et la réponse revient via HiveTransport.sendText → HiveCoreConnection.messageListener → AgentEvent.

### Bugs identifiés puis corrigés pendant le test
1. **`activeTransports` filtré à vide** (`src/core/index.ts:458`)
- Symbole : `npx tsx` sans TTY → `process.stdin.isTTY === false` → filtre `ink-cli` du tableau → `submitUserMessage()` no-op silencieux.
- Fix : `tuiExplicitlyRequested = activeTransports.includes('ink-cli')`. Si oui, bypass complet du filtre.
- Validation : "Connecté (ink-cli)" désormais visible, callbacks enregistrés, message transmis au core.

2. **`agent_end` jamais émis** (`src/tui/core/connection.ts`)
- Symbole : Le core ne notifie jamais la fin d'une réponse. La TUI reste bloquée en "thinking".
- Fix : `scheduleAgentEnd()` déclenché à chaque message agent, debounce timer `RESPONSE_IDLE_DELAY_MS=1500ms`.
- Validation : `agent_end` émis 1.5s après le dernier message. Filet de sécurité 60s en cas de silence total.

3. **Stdout pollué par le core** (`src/utils/startup.ts` + `src/tui/core/connection.ts`)
- Symbole : `startupDisplay.showLogo()` + barre de progression Router/FinOps/Agent logs écrasent l'écran Ink en mode TUI.
- Fix : `isTuiSuppressed` dans `startupDisplay` + `installTuiLogRedirect()` qui intercepte `process.stdout.write` (sans toucher `console.log` pour ne pas casser les références capturées au chargement).
- Validation : seuls les `console.error` traversent (Redis errors visibles pour diagnostic), tout le reste va au ring buffer / fichier log optionnel (`HIVE_TUI_LOG_FILE`).

### Tests à venir
- ⏳ Test visuel en TTY interactif : `npx tsx src/tui/index.tsx` dans un vrai terminal pour confirmer le rendu Ink (le test diag utilise un sous-process sans TTY).
- ⏳ Test conversation multi-tour.
- ⏳ Test `hive.md` context injection.

## 📅 Date: 2026-07-19

## 🧪 Validation statique et tests de non-régression
- Run command: `npx tsc --noEmit`
- Status: **PASSED (100% SUCCESS)**
- Verdict: 0 erreurs, 0 warnings sur tout le projet.
- Run command: `npm run lint`
- Status: **PASSED (100% SUCCESS sur src/tui)**
- Verdict: Aucune erreur ni warning ESLint dans le dossier `src/tui/`.
- Run command: `npm run test:unit`
- Status: **PASSED (100% SUCCESS)**
- Verdict: Les 54 suites de tests unitaires (366 tests au total) passent avec succès (0 échec).

## 🚀 Résolution du Rendu Loop (Crash de démarrage)
- Verdict: La TUI démarre de manière stable suite à la suppression des stubs instables qui déclenchaient des rendus en chaîne. Les logs de debug trop verbeux et le Render Loop detector temporaire ont été intégralement retirés.

## 📅 Date: 2026-07-22

## 🧪 Validation Dynamique & Éradication du Bug `Maximum update depth exceeded`
- Run command: `rm -f .GCC/tui_test_err.log; ACTIVE_TRANSPORTS=ink-cli npx tsx src/index.ts > .GCC/core_test.log 2>&1 & CORE_PID=$!; sleep 4; npx tsx src/tui/index.tsx > .GCC/tui_test_out.log 2> .GCC/tui_test_err.log & TUI_PID=$!; sleep 15; kill -9 $CORE_PID $TUI_PID 2>/dev/null || true; cat .GCC/tui_test_err.log`
- Status: **PASSED (100% SUCCESS)**
- Output: **0 octet d'erreur / 0 exception `Maximum update depth exceeded`** dans `.GCC/tui_test_err.log`.
- Second run command: `rm -f .GCC/tui_test_err2.log; ACTIVE_TRANSPORTS=ink-cli npx tsx src/index.ts > .GCC/core_test.log 2>&1 & CORE_PID=$!; sleep 4; npx tsx src/tui/index.tsx > .GCC/tui_test_out.log 2> .GCC/tui_test_err2.log & TUI_PID=$!; sleep 20; kill -9 $CORE_PID $TUI_PID 2>/dev/null || true; wc -c .GCC/tui_test_err2.log`
- Status: **PASSED (100% SUCCESS)**
- Output: `0 .GCC/tui_test_err2.log` (0 octet d'erreur).
- Static verification command: `npx tsc --noEmit && npx eslint src/tui/`
- Status: **PASSED (100% SUCCESS - 0 erreurs, 0 warnings)**.

## 📅 Date: 2026-07-24

## 🏆 Final SonarCloud Roadmap Resolution (Sessions 9 & 10)
- Run command: `node: import migration script`
- Status: **PASSED (100% SUCCESS)**
- Output: 94 files in `src/` migrated to `node:*` prefix imports (218 bare imports replaced). Zero bare node imports remaining.
- Run command: `npx tsc --noEmit`
- Status: **PASSED (100% SUCCESS, 0 errors)**
- Run command: `npm run test:unit`
- Status: **PASSED (100% SUCCESS, 58/58 test suites PASS, 393/393 tests PASS)**
- Run command: `NODE_OPTIONS='--experimental-vm-modules' npx jest src/tests/integration/tui_websocket.test.ts`
- Status: **PASSED (100% SUCCESS, 7/7 tests PASS)**
- Run command: `npm run build`
- Status: **PASSED (100% SUCCESS, Exit code 0)**
- Run command: `npm test`
- Status: **PASSED (100% SUCCESS, 64/64 test suites PASS, 434/434 tests PASS)**



## 2026-07-26 — Session Lot 4 TUI (partielle)

### Cartographie
- Commande: `graphify query "How is src/tui connected to core services and websocket transport?" --budget 1800`
- Résultat: succès; `BFS depth=2`, `23 nodes found`.
- Conclusion: TUI découplée, reliée au core via transport WebSocket; dépendances principales `ui/hooks`, `ui/contexts`, `core`, `transport`.

### Diagnostic ESLint initial
- Commande: `npx eslint src/tui/`
- Résultat: échec attendu du diagnostic; `1348 problems (773 errors, 575 warnings)`, `162 fichiers affectés`.

### Validations ciblées
- `npx eslint src/tui/config/extensions/consent.ts src/tui/deferred.ts` -> code 0.
- `npx eslint src/tui/config/hiveConfig.ts src/tui/config/trustedFolders.ts` -> code 0.
- `npx eslint src/tui/config/hiveSettingsSchema.ts && npx tsc --noEmit` -> code 0.
- `npx eslint src/tui/config/settings-validation.ts && npx tsc --noEmit` -> code 0.
- `npx eslint src/tui/config/settings.ts` -> 0 erreur, 1 avertissement: `settings.ts:1228:25 security/detect-object-injection`.
- `npx tsc --noEmit` -> code 0.

### Non exécuté
- `NODE_OPTIONS='--experimental-vm-modules' npx jest src/tests/integration/tui_websocket.test.ts`
- `npm run test:unit`
- Raison: session clôturée avant la fin du Lot 4.

## 📅 Date: 2026-07-26

## 🧪 Static Validation Results (TUI Config & Core Connection)
- Run command: `npx eslint src/tui/config/ src/tui/core/connection.ts && npx tsc --noEmit`
- Status: **PASSED**
- Output: command exited with code 0 and no lint output.

## 🧪 TUI Global ESLint Status
- Run command: `npx eslint src/tui/`
- Status: **IN PROGRESS**
- Output: 1252 problems (709 errors, 543 warnings) remaining
- Progress: 96 problems fixed since session start (1348 → 1252)
- Files validated: `config/` (8 files), `core/connection.ts`

## 2026-07-30 — Session 4 (Providers) : clôture

### Validation statique — périmètre `src/providers` (39 fichiers + 6 modules créés)

- Commande: `npx eslint src/providers/index.ts --max-warnings=0` (état initial de la session)
- Statut: **ÉCHEC attendu** — `780:17 error Refactor this function to reduce its Cognitive Complexity from 17 to the 15 allowed  sonarjs/cognitive-complexity` → `1 problem (1 error, 0 warnings)`, EXIT=1.
- Note: le handoff annonçait 16 problèmes sur ce fichier ; la mesure réelle en début de session en donnait **1**. La réécriture de `index.ts` était déjà faite dans l'arbre de travail (non commitée, +728/-492).
- Commande: `npx eslint src/providers/index.ts --max-warnings=0` (après extraction de `_runFamilyModels`)
- Statut: **PASSED** — `ESLINT_EXIT=0`.
- Commande: `npx eslint src/providers --max-warnings=0`
- Statut: **PASSED** — `ESLINT_PROVIDERS_EXIT=0` (périmètre complet de la session).
- Commande: `npx oxlint --quiet --deny-warnings src/providers/`
- Statut: **PASSED** — `OXLINT_EXIT=0`.
- Commande: `npx prettier --check src/providers/`
- Statut: **PASSED** — `All matched files use Prettier code style!`, `PRETTIER_EXIT=0`.
- Commande: `npx tsc --noEmit 2>&1 | grep -c "error TS"`
- Statut: **PASSED** — `0` sur le projet entier.
- Commande: `grep -rnE "eslint-disable|@ts-ignore|@ts-nocheck|@ts-expect-error|as any" src/providers/`
- Statut: **PASSED** — aucune occurrence (EXIT=1).
- Commande: `npx depcruise --validate .dependency-cruiser.cjs src/providers`
- Statut: **PASSED (sans régression)** — 17 warnings `no-circular`, tous préexistants et centrés sur `src/core/ServiceContainer.ts`. Aucun des 6 modules créés (`types.ts`, `geminiTypes.ts`, `toolIds.ts`, `requireModel.ts`, `adapters/codexProtocol.ts`, `adapters/ttsTypes.ts`) n'apparaît dans un cycle.

### Validation fonctionnelle (runtime)

- Commande: `NODE_OPTIONS='--experimental-vm-modules' NODE_ENV=test SUPABASE_URL=http://localhost SUPABASE_KEY=dummy npx jest src/tests/smart_router_v2.test.ts --forceExit`
- Statut: **PASSED** — `Test Suites: 1 passed, 1 total` / `Tests: 8 passed, 8 total` / `Time: 42.454 s`.
- Portée couverte: recettes de service (`callServiceRecipe`), saut des modèles à quota épuisé (`_isRecipeCandidateUsable`), circuit breaker par famille, sélection proactive de clé, cascade de familles.
- Conclusion: la réécriture complète de `src/providers/index.ts` (décomposition de `ProviderRouter.chat()` en 14 méthodes) **n'altère pas** le comportement de routage observable.

### Bugs / régressions découverts

- Aucun. La seule divergence relevée est documentaire : `.GCC/resume.md` annonçait 16 problèmes résiduels sur `index.ts` alors que l'arbre de travail en portait 1 (travail non commité effectué après l'écriture du handoff).

### Non exécuté (reste au backlog)

- Test E2E réel d'un appel provider avec clés vivantes (non mocké) : hors périmètre d'une session de typage à comportement constant, et nécessite des quotas API.

## 📅 Date: 2026-08-02

## 🧪 Audit indépendant du pipeline Pre-Commit
- Commande: `sh .husky/pre-commit`
- Statut: **BLOQUÉ À LA COUCHE npm audit PAR LE RÉSEAU SANDBOX** — `getaddrinfo EAI_AGAIN registry.npmjs.org`.
- Commande: `npx npm audit --audit-level=high --omit=dev`
- Statut: **EXIT 0** — 0 vulnérabilité high/critical, 8 vulnérabilités moderate.
- Commande: `npx oxlint --quiet --deny-warnings src/`
- Statut: **EXIT 0** — aucun output.
- Commande: `npx prettier --check "src/**/*.{ts,tsx,json,md}"`
- Statut: **ÉCHEC** — 3 fichiers non formatés: `src/core/transport/baileys.ts`, `src/tui/ui/commands/hiveCommands.ts`, `src/tui/ui/contexts/UIStateContext.tsx`.
- Commande: `npx tsc --noEmit`
- Statut: **ÉCHEC** — 2 erreurs `TS2440`/`TS2484` dans `src/tui/ui/contexts/UIStateContext.tsx`.
- Commande: `npx depcruise --validate .dependency-cruiser.cjs src`
- Statut: **EXIT 0** — 0 violation, 768 modules et 2896 dépendances analysés.
- Commande: `npx eslint . --max-warnings=0`
- Statut: **ÉCHEC** — 26049 erreurs et 1635 warnings; `src/` seul: 0 erreur et 0 warning. La majorité vient du bundle externe `excalidraw/.obsidian/plugins/obsidian-excalidraw-plugin/main.js`.
- Commande: `/home/omni/.local/bin/uv run --with semgrep semgrep scan --config auto --quiet --error`
- Statut: **ÉCHEC** — 122 findings SAST.

## 🧪 Suite Jest complète
- Commande: `npm test -- --runInBand`
- Statut: **ÉCHEC** — 57 suites passées, 9 échouées; 405 tests passés, 49 échoués sur 454.
- Causes observées: état MediaDB temporaire partagé (`ENOTEMPTY`), impossibilité sandbox de `listen` sur `127.0.0.1:5001`, échecs du routeur/providers, sanitizer, visual reporter et audio cleanup.

## 🧪 Correctif du périmètre ESLint
- Fichier: `eslint.config.js`
- Exclusions ajoutées: `excalidraw/**` et `llm_as_*/**`.
- Imports de configuration ESLint convertis en exports nommés pour supprimer 4 warnings de configuration.
- Commande: `npx eslint . --max-warnings=0`
- Statut: **EXIT 0** — 0 erreur, 0 warning.

## 🧪 Epic provider-families + GenerationParams (2026-08-05, branche worktree-provider-families-epic)
- `npx jest src/tests/provider_families.test.ts --forceExit` — **33/33 passed**.
- `npx jest src/tests/unit/providers/generation_params.test.ts --forceExit` — **44/44 passed**.
- Suites d'impact (`smart_router_v2`, `models_config_policy`, `envResolver`, `keyResolver`) — **19/19 passed**.
- `npx tsc --noEmit` — exit 0 ; `npx eslint src/ --max-warnings=0` — exit 0 ; prettier sur fichiers touchés — propre.
- 22 adapters secondaires supprimés (`git rm`) : 0 import orphelin résiduel (grep préalable).
- `npm test -- --maxWorkers=1` — **68 suites / 531 tests, tous verts** (111,5 s).
- Plan GenerationParams Step 6 (smoke réel Anthropic/Gemini/gpt-5/famille JSON) : **NON EXÉCUTÉ** — clés API réelles requises ; entrées reportées dans `test_afaire.md` §8.

## 📅 Date: 2026-08-28

## 🏆 Extraction & Découplage TUI Standalone — Tests & Validation E2E
- **Jalon M1 (Découplage Transport Core)** :
- Commande: `npx jest src/tests/integration/tui_websocket.test.ts --forceExit`
- Statut: **PASSED (7/7 tests réussis, 100%)**
- Vérification frontière: `grep -rn "src/tui" src/core/` -> **0 référence résiduelle**
- **Jalon M2 (Dépôt Standalone /home/omni/Code/HIVE-MIND-TUI)** :
- Commande: `cd /home/omni/Code/HIVE-MIND-TUI && npx tsc --noEmit && npx eslint src/`
- Statut: **PASSED (0 erreur TS, 0 erreur/avertissement ESLint)**
- Commande: `cd /home/omni/Code/HIVE-MIND-TUI && npm test`
- Statut: **PASSED (6/6 suites, 89/89 tests unitaires et adversariaux réussis)**
- **Jalon M3 (Purge Monorepo HIVE-MIND)** :
- Commande: `npx tsc --noEmit`
- Statut: **PASSED (0 erreur TS)**
- Commande: `npm test -- --runInBand --forceExit`
- Statut: **PASSED (72/72 suites, 590/590 tests réussis, 0 régression)**
- **Jalon M4 (Validation E2E Cross-Process WebSocket)** :
- Commande: `NODE_OPTIONS='--experimental-vm-modules' npx jest src/tests/e2e/tui_cross_process_e2e.test.ts --forceExit`
- Statut: **PASSED (11/11 tests réussis, 100%)**
- Scénarios validés: Handshake sécurisé tokenisé, rejet 4403, flux d'événements live (présence, visual_response, messages assistant), soumission de commandes utilisateur, approbation/rejet interactif HITL.


## 📅 Date: 2026-08-31 (Validation de la baseline de gouvernance et de sa gate)

- **Périmètre** : aucun fichier `src/` modifié ; validation du dépôt en tant que conteneur (hooks, policies, workflows, index Git).
- **Contrôle d'index avant commit `84e61d2`** :
- Commande: `git diff --cached --name-only --diff-filter=ACMR | grep -E '\.(js|jsx|ts|tsx|mjs|cjs)$'`
- Statut: **VID** — les contrôles 3/8 à 8/8 du `pre-commit` (oxlint, tsc, dependency-cruiser, knip, format, tests) n'auraient collecté aucun fichier.
- Commande: `git diff --cached --diff-filter=ACMR -G "<en-tete PEM: BEGIN + type de clef + les deux mots anglais accolés signifiant clef privee>" --name-only`
- Statut: **VID** — aucun matériel cryptographique réel dans les 62 fichiers indexés.
- **Échec de gate reproduit (faux positifs de documentation)** :
- Commande: `git commit` (message Conventional Commits, sans drapeau)
- Statut: **REJECTED (exit 1)** — `[Erreur Quality Gate] Motif de clé privée ou jeton d'accès identifié dans : .GCC/branches/plan_tui_ui_s5.md`.
- Commande: reproduction des deux scans sur l'index complet
- Statut: **12 fichiers signalés** — scan jeton : 1 (`.GCC/branches/plan_tui_ui_s5.md`, ligne ajoutée citant la commande de scan) ; scan inhibitions : 11 (10 journaux `.GCC/branches/` + `AGENTS.md`).
- Preuve du cas `AGENTS.md`: `git diff --cached AGENTS.md | grep -inE "<motif d'inhibition>"` → 1 seule ligne, préfixée `-` (suppression de l'ancienne version) ; `grep -c` dans le fichier de travail → **0**. Le fichier ne peut pas devenir passable par édition de contenu.
- **Correctif validé rétrospectivement sur le commit posé** :
- Commande: `git diff HEAD~1..HEAD --diff-filter=ACMR -G "<motif>" --name-only | grep -v '\.githooks/pre-commit' | grep -vE '\.(md|markdown)$'`
- Statut: **0 fichier** pour les deux scans → le filtre markdown suffit à lever les 12 rejets.
- **Commit réel**: `84e61d2` posé avec `--no-verify` **sur demande explicite du mainteneur** (écart à `AGENTS.md` §5.3, tracé en décision dans `main.md`). `0ead9b5` l'avait été avec le canal documenté `ALLOW_CONFIG_EDIT=1` (package.json / package-lock.json protégés), gate par ailleurs exécutée.
- **Vérifications complémentaires**: `command -v gitleaks` → absent à cette date (les deux scans littéraux étaient alors les seuls contrôles anti-fuite effectifs) ; `_common/detect-secrets.sh`, `check-format.sh`, `run-linter.sh` → référencés par aucun hook (seul `run-tests.sh` est branché par `pre-push`) ; `git push` non exécuté (jamais demandé).


## 📅 Date: 2026-08-31 (Soirée — Validation de la gate corrigée et de gitleaks)

- **Périmètre**: `.githooks/` et `.gitleaks.toml` uniquement ; aucun fichier `src/`. Contrôles séquentiels (hôte 2 cœurs).
- **Syntaxe des trois scripts modifiés**:
- Commande: `sh -n .githooks/pre-commit && bash -n .githooks/pre-push && bash -n .githooks/_common/detect-secrets.sh`
- Statut: **PASSED** — trois retours « syntaxe OK », aucun avertissement.
- **Test positif — le faux positif de documentation ne bloque plus**:
- Commande: `git add .githooks/pre-commit .githooks/pre-push .githooks/_common/detect-secrets.sh .gitleaks.toml && ALLOW_CONFIG_EDIT=1 sh .githooks/pre-commit`
- Statut: **EXIT=0** — `[Quality Gate] 1b - Scan gitleaks de l'index...` → `no leaks found` → `✅ Aucun secret détecté` → `Aucun fichier JS/TS dans le périmètre 'staged'`. Même résultat sur l'index du lot licence (`LICENSE`, `README.md`, `package.json`, `package-lock.json`). Les 12 fichiers qui faisaient rejeter `84e61d2` ne sont plus signalés.
- **Test négatif (canary) — la couverture anti-fuite n'a pas régressé**:
- Commande: bloc PEM factice (en-tête de clef privée RSA + corps fictif, aucune clef réelle) écrit dans `canary_probe.md`, puis `git add canary_probe.md && ALLOW_CONFIG_EDIT=1 sh .githooks/pre-commit`
- Statut: **REJECTED (EXIT=1)** — `[Erreur Quality Gate] Bloc de clé privée PEM indexé dans : canary_probe.md`. Le scan compensatoire, qui n'admet **aucune** exemption de chemin, attrape donc bien un secret dissimulé dans un fichier markdown filtré par `DOC_FILTER`.
- Commande: `bash .githooks/_common/detect-secrets.sh staged` (canary toujours indexé)
- Statut: **REJECTED (EXIT=1)** — couche indépendante : `RuleID: private-key`, `File: canary_probe.md`, `Line: 3`, `Secret: REDACTED`, `leaks found: 1`. Le canary a été désindexé (`git reset`), supprimé, et n'apparaît ni dans l'index ni dans `git status`.
- **Second rejet, inattendu et instructif**: Le présent journal, indexé après rédaction, a été refusé par le même contrôle — `[Erreur Quality Gate] Bloc de clé privée PEM indexé dans : .GCC/branches/test.md` — parce qu'il **reproduisait littéralement** un en-tête de bloc PEM pour décrire le canary. Preuve directe que le scan frappe la documentation, `DOC_FILTER` compris, exactement comme prévu.
- **Résolution**: la ligne fautive a été réécrite en **description** plutôt qu'en reproduction (même convention que la ligne 476 du fichier). Aucune exemption de chemin n'a été ajoutée, aucun motif affaibli, et le commit n'a pas été contourné. Règle pour les journaux : *nommer* un format sensible, ne pas l'écrire en clair.
- **Absence du binaire = échec bloquant, pas saut d'étape**:
- Commande: `detect-secrets.sh` avec `PATH` tronqué (reproduit sous `HOME=/tmp/fakehome` pour ne pas dépendre de l'environnement du poste)
- Statut: **EXIT=1** avec le bloc d'installation copiable. Le bloc en question a été exécuté tel quel : `gitleaks_8.30.1_linux_x64.tar.gz: Réussi` (sha256 vérifié contre le `checksums.txt` publié) puis `8.30.1`.
- **Scan de l'historique complet (ce que fera le `pre-push`)**:
- Commande: `gitleaks git . --config .gitleaks.toml --redact --no-banner`
- Statut: **CLEAN** — `10 commits scanned`, `13.57 MB`, `no leaks found`. Antérieurement au correctif, 4 findings portaient sur `documentations/tui/reference/core-connection.md` : des **faux positifs** sur un jeton d'exemple de 8 caractères, traité par allowlist documentée limitée à ce seul chemin (`useDefault = true` conserve sinon toutes les règles natives).
- **Cohérence de licence**:
- Commande: `node -e` comparant `package.json` et le paquet racine du lockfile
- Statut: **PASSED** — `JSON OK | lock racine = Apache-2.0 | package.json = Apache-2.0 | author = leandre755`. `sha256sum LICENSE` = `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30`, identique à la publication officielle.
- **Commits réels**: `cc4fa2a` (4 fichiers, +116/−64) et `74aefe7` (4 fichiers, +208/−25), tous deux gate exécutée et `commit-msg` validé, **sans aucun drapeau de contournement**. `ALLOW_CONFIG_EDIT=1` a été nécessaire pour `74aefe7` (`package.json` / `package-lock.json` protégés) — canal documenté, pas un contournement.
- **Mode `history` exercé directement** (la voie qu'empruntera le `pre-push`) : `bash .githooks/_common/detect-secrets.sh history` → `11 commits scanned`, `no leaks found`, `✅ Aucun secret détecté`, `EXIT=0`.
- **Test croisé du filtrage markdown (le motif exact du blocage de `84e61d2`)**:
- Commande: `printf '# probe\n\nCe document cite eslint-disable et @ts-ignore en prose…\n' > doc_probe.md && git add doc_probe.md && sh .githooks/pre-commit`
- Statut: **EXIT=0**, le fichier n'est pas mentionné → une documentation de politique qui *cite* les directives d'inhibition ne bloque plus. Probe désindexé et supprimé.
- Commande (non-régression): `printf '// eslint-disable-next-line no-console\nexport const probe = 1;\n' > src/code_probe.ts && git add src/code_probe.ts && sh .githooks/pre-commit`
- Statut: **REJECTED (EXIT=1)** — `Commentaires de masquage détectés … src/code_probe.ts` → le contrôle reste intégralement actif sur le code. Probe désindexé et supprimé.
- **Audit de la dette des chemins machine — deux passes, la seconde seule fait foi**:
- **Passe 1 (partielle, chiffres rétractés)**: `git grep -o -e HIVE-MIND-RAILWAY` → 135 mentions, et ventilation par répertoire → « 120 liens sur **25 fichiers** » ; population hors Railway énumérée à la main → « **14 chemins sur 7 fichiers** ». Les deux comptages étaient **bogués** : `git grep -l` agrège les fichiers où le nom du dépôt n'apparaît qu'en prose (`cd … && …` dans les journaux), et l'énumération manuelle laissait de côté quatre fichiers tout en en imputant cinq à la mauvaise population.
- **Passe 2 (autoritaire, exécutée sur `git show HEAD:<fichier>`)**:
- Commande: script Python comptant les occurrences du préfixe complet `file:` + `//` + `/home/omni/Code/HIVE-MIND-RAILWAY/`, puis `os.path.exists` sur chaque cible distincte, et un second décompte des chemins non-Railway par fichier
- Statut: **MESURÉ** — **120 liens** dans **16 fichiers** : 6 de `documentation/explanations/` (77 liens) et 10 de `documentations/tui/` (43 liens), **aucun lien hors de ces deux arbres**. **9 fichiers** ne portent que la mention en prose (`documentation/00_index.md`, `src/scripts/test_email.ts`, `src/tests/unit/utils/helpers.test.ts` et 6 journaux `.GCC/`). Ces 120 liens visent **65 cibles distinctes** : **45 résolubles** telles quelles, **20 introuvables** (19 `src/tui/**` + `PROJECT.md`). Population hors Railway : **21 occurrences** dans **11 fichiers**, soit **8 dans 6 fichiers de code et doc** (seule `src/providers/adapters/codex.ts` l. 26 a un effet à l'exécution) et **13 descriptives dans 5 journaux `.GCC/`**.
- **Verdict sur les chiffres du journal**: l'estimation d'origine « 6 + 10 fichiers » de `main.md` §Known Bugs était **juste au lien près** ; « 28 cibles orphelines », présent en trois points de `main.md` et `resume.md`, était **faux** (20) ; « 5 liens dans `main.md` » était **faux** (`main.md` porte 0 lien, uniquement de la prose).
- **Leçon d'instrument consignée**: un compte de *porteurs* ne se fait pas avec `git grep -l` sur le nom d'un dépôt — ce motif attrape la prose. Il faut matcher le préfixe de lien complet, et mesurer sur l'état commité (`git grep <rev>` / `git show`) quand l'arbre de travail est en cours de réécriture, sans quoi l'audit se auto-conte : la passe 1 avait déjà ajouté une mention de plus à `.GCC/branches/test.md`, portant à 26 le nombre de fichiers littéraux.
- **Re-exécution du scan d'historique (voie `pre-push`) sur le dernier commit**: `bash .githooks/_common/detect-secrets.sh history` → `no leaks found`, code de sortie relevé hors pipeline = `0`. Le volume annoncé (`15 commits`, `13.61 MB`) n'est **pas** un critère : il dépend du nombre de commits au moment de la lecture, donc il dérive à chaque commit de journal.
- **Vérification du tour « §6 + badge + titulaire »**:
- Commande: `grep -ncE` d'un jeu de tokenizer français sur `AGENTS.md` → **0** occurrence : la contrainte « full anglais » du mainteneur est tenue, y compris sur le paragraphe qui décrit le refus des blocs de clé privée (format **nommé**, jamais reproduit — le scan d'en-tête n'ayant aucune exemption de chemin, il frapperait `AGENTS.md` lui-même).
- Contrôle croisé documentaire: les 8 fichiers listés dans `<protected_files>` d'`AGENTS.md` §6 = exactement la regex `PROTECTED_MODIFIED` de `.githooks/pre-commit` l. 56 ; les 3 étapes décrites pour `pre-push` = ses 3 blocs réels. Écart résiduel corrigé en cours de relecture : une forme orthographique britannique (« authorised ») voisine avec les américanismes du reste du fichier (`hypothesize`, `summarize`) → ramenée à `authorized`.
- Commande: `curl` du rendu shields.io du badge `Node.js` + lecture de `<title>` → `200`, `<title>Node.js-22+</title>` : la valeur `22+` se rend correctement, le tiret littéral n'a pas besoin d'être doublé ici (contrairement à `Apache--2.0`).
- Gate exécutée par les trois commits de fond — `8564779 docs(agents)`, `3ea25ce docs(readme)`, `4955cac chore(license)` — chacun avec, dans l'ordre, `1b - Scan gitleaks de l'index...` → `no leaks found` → `✅ Aucun secret détecté` → `Aucun fichier JS/TS dans le périmètre 'staged'`, plus `✅ Commit message format is valid`. Aucun `--no-verify`, aucun `ALLOW_CONFIG_EDIT` requis (aucun des trois fichiers n'est dans la liste protégée).
- Post-condition de licence: `sha256sum LICENSE` → `d10f91a1eb210bb37509cc5f7e55568bfd92175a6bf05ae78cf810bd3269658b`, donc bien distinct du texte distribué `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30`. L'écart est la conséquence voulue de l'annexe remplie ; un futur contrôle « LICENSE doit être identique à apache.org » est donc **caduc** tel quel.
- **Re-mesure des compteurs de journal (leçon appliquée)**: la ventilation « `test.md` ×6, `main.md` ×3 » de la passe 2 ne tenait plus après les éditions de ce tour (`main.md` 2, `test.md` 7, solde inchangé, total 13 toujours juste). Les décomptes par journal sont retirés de `main.md` §Known Bugs au profit de la commande de re-mesure — un chiffre que la seule écriture du journal déplace n'est pas une preuve.
- **Non testé (hors périmètre, à faire)**: `npm run build`, `lint:fast`, `test:unit`, et le déclenchement réel des hooks par un `git push` (aucun push demandé, et `AGENTS.md` §4 impose la voie Pull Request).

## 📅 Date: 2026-09-05 (Validation Sécurité Parseur Shell-Aware Command Substitutions & P1 Greptile PR #24)

- **Périmètre**: `src/core/security/PermissionManager.ts`, `src/tests/unit/core/permissionManager.test.ts`.
- **Analyse statique et compilation**:
  - Commande: `npm run lint:fast`
  - Statut: **PASSED (0 warning, 0 error)** — oxlint sur 331 fichiers en 87ms.
  - Commande: `npm run build`
  - Statut: **PASSED (0 error)** — `tsc --noEmit`.
- **Suite ciblée Jest**:
  - Commande: `NODE_ENV=test SUPABASE_URL=http://localhost:54321 SUPABASE_KEY=dummy REDIS_URL=redis://localhost:6379 NODE_OPTIONS='--experimental-vm-modules --no-warnings' npx jest src/tests/unit/core/permissionManager.test.ts`
  - Statut: **PASSED (1/1 suite, 57/57 tests réussis, 100%)**
  - Cas de test adversariaux validés:
    - Substitution avec parenthèse fermante entre guillemets (`echo "$(printf ')'; sudo id)"`) -> bloqué (`res.result === false`).
    - Substitution avec parenthèse fermante échappée (`echo "$(echo \); sudo id)"`) -> bloqué.
    - Substitution avec guillemets doubles et simples imbriqués (`echo "$(printf ")"; sudo id)"`) -> bloqué.
    - Process substitution avec parenthèse fermante entre guillemets (`cat <(printf ')'; sudo id)`) -> bloqué.
    - Backtick substitution avec parenthèse fermante (<code>echo \`printf ")"; sudo id\`</code>) -> bloqué.
    - Substitutions imbriquées multiples (`$($(echo sudo) id)`) -> bloqué.
    - Substitutions syntaxiquement tronquées ou non fermées -> fail-closed (`requiresPermission: true`).
    - Substitutions et commandes arithmétiques légitimes (`echo $(( 2 + 3 ))`, `echo "$(echo '()')"`) -> autorisées sans permission.
- **Suite complète des tests unitaires**:
  - Commande: `npm run test:unit`
  - Statut: **PASSED (74/74 suites, 661/661 tests réussis, 0 régression)**.

## 📅 Date: 2026-09-06 (Validation InMemoryRedisMock & Résolution Issue #25)

- **Périmètre**: `src/services/redisClient.ts`, `src/tests/unit/services/redisClient.test.ts`.
- **Analyse statique et compilation**:
  - Commande: `npm run lint:fast`
  - Statut: **PASSED (0 warning, 0 error)** — oxlint sur 333 fichiers.
  - Commande: `npx eslint src/services/redisClient.ts src/tests/unit/services/redisClient.test.ts`
  - Statut: **PASSED (0 error, 0 warning)**.
  - Commande: `npx prettier --check src/services/redisClient.ts src/tests/unit/services/redisClient.test.ts`
  - Statut: **PASSED (100% compliant)**.
  - Commande: `npm run build`
  - Statut: **PASSED (0 error)** — `tsc --noEmit`.
- **Suite ciblée Jest (ESM native)**:
  - Commande: `NODE_ENV=test SUPABASE_URL=http://localhost:54321 SUPABASE_KEY=dummy REDIS_URL=redis://localhost:6379 NODE_OPTIONS='--experimental-vm-modules --no-warnings' npx jest src/tests/unit/services/redisClient.test.ts`
  - Statut: **PASSED (1/1 suite, 32/32 tests réussis, 100%)**
  - Cas de test validés:
    - Strings & Keys: `set`, `get`, non-existent keys (null), `NX`, `XX`, `PX` (millisecond TTL expiration), `setEx`, `del` (multi-key), `keys` pattern matching, `incr`, `incrBy`, `ping`, `info`, `quit`.
    - Lists: `rPush`, `lPush` (scalars and arrays), `lTrim` (positive and negative indices, start > stop empty), `rPop`, `lPop`, `lRem` (count > 0, count < 0, count = 0), `lRange` (including negative start).
    - Sets & Hashes: `sAdd`, `sMembers`, `sIsMember`, `sCard`, `sRem`, `sPop`, `sPopCount`, `hSet`, `hGet`, `hGetAll`, `hIncrBy`, `hDel`, `hLen`, `hExists`.
    - Sorted Sets: `zAdd` polymorphism (single object `{ score, value }`, array of objects, and positional arguments), `zRangeWithScores` with `REV`, `zRangeByScore` (`-inf`, `+inf`, numeric bounds), `zRemRangeByScore`, `zIncrBy`, `zRem`, `zCard`.
    - Eval: LockManager unlock script with matching/mismatched lockId, simple `return redis.call` commands.
    - Multi Pipeline: Chained proxy operations executed sequentially with `exec()`, list operations within pipeline.
    - Integration WorkingMemory: `switchToMock(redis)` dynamic binding prevents `TypeError: redis.rPush is not a function`, full `workingMemory.addMessage()` and `workingMemory.getContext()` flow executes cleanly on mock fallback.


