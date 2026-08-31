# Execution Plan: Milestone M2 - src/scripts and src/services Refactoring

## 📋 Target Invariant & Pre-requisites

- **Target Invariant**: Zero ESLint warnings/errors (`eslint src/scripts src/services --max-warnings=0`), zero TypeScript errors (`tsc --noEmit`), 100% test pass rate (`npm run test:unit -- --maxWorkers=1`), zero inhibition directives (`eslint-disable`, `@ts-ignore`, `@ts-nocheck`, `@ts-expect-error`, `as any`).
- **Pre-requisites**: All code in `src/scripts/` and `src/services/` clean of type violations and lint errors.

## 🛠️ Step-by-Step Sequence

### Step 1: Fix `src/scripts/` (13 files)

- [ ] **Action**: Refactor all 13 files in `src/scripts/` (`check-redis.ts`, `cli-legacy/cli.ts`, `ingest_docs.js`, `ping_bot.ts`, `ping_bot_user.ts`, `repair-session.ts`, `test-config.js`, `test_10_10.js`, `test_fixes2.ts`, `test_full_page_screenshot.ts`, `test_models.js`, `test_remaining_e2e.ts`, `update_gemma.cjs`). Remove explicit `any` / `as any`, fix command path, object injections, non-literal fs, and imports.
- [ ] **Verify**: `npx eslint src/scripts`

### Step 2: Fix Simple & Low-Complexity Services (19 files)

- [ ] **Action**: Refactor low-complexity services (`EmbeddingsService.ts`, `feedbackService.ts`, `WakeSystem.ts`, `LockManager.ts`, `socialCueWatcher.ts`, `ActionMemory.ts`, `DriverSystem.ts`, `DatabaseMonitor.ts`, `MediaIndexer.ts`, `audioConverter.ts`, `groqSTT.ts`, `ContextWindowService.ts`, `RuntimeInfrastructure.ts`, `anchor/index.ts`, `anchor/lineHashing.ts`, `quotaManager.ts`, `redisClient.ts`, `supabase.ts`, `agentMemory.ts`). Fix `Math.random()`, unused vars, super-linear regexes, object injections, non-literal fs.
- [ ] **Verify**: `npx eslint <reformatted services>`

### Step 3: Fix Moderate-Complexity Services (10 files)

- [ ] **Action**: Refactor moderate-complexity services (`LearningEngine.ts`, `IdentityMap.ts`, `ActionEvaluator.ts`, `BrowserService.ts`, `cleanup.ts`, `envResolver.ts`, `userService.ts`, `voice/minimax.ts`, `voice/voiceProvider.ts`, `audio/geminiLiveProvider.ts`). Fix super-linear regexes, cognitive complexity, object injections, fs calls, imports.
- [ ] **Verify**: `npx eslint <reformatted services>`

### Step 4: Fix High-Complexity Services (8 files)

- [ ] **Action**: Refactor high-complexity services (`AnchorStateManager.ts`, `TreeSitterService.ts`, `goalsService.ts`, `groupService.ts`, `ProgrammaticExecutor.ts`, `SafeScriptValidator.ts`, `MultimodalEmbeddingService.ts`, `Planner.ts`). Extract internal helpers to reduce cognitive complexity < 15, fix super-linear regexes, `Math.random()`, object injections, non-literal fs, template literals, and code-eval.
- [ ] **Verify**: `npx eslint src/services --max-warnings=0`

### Step 5: Full Repo Verification & Integrity Check

- [ ] **Verify**:
  - `npx eslint src/scripts src/services --max-warnings=0`
  - `npx tsc --noEmit`
  - `npm run test:unit -- --maxWorkers=1`
  - Inhibition directive check (0 matches for `eslint-disable`, `@ts-ignore`, `@ts-nocheck`, `@ts-expect-error`, `as any`)

## ⚠️ Mitigations & Edge Cases

- **Risk**: Extracting helpers for cognitive complexity could alter private scope or return values.
- **Mitigation**: Pure functional extractions, verify with existing test suite after each step.
