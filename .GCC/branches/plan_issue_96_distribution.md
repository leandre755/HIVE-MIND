# Execution Plan: Préparation distribution #96 — registre statique, chemins portables, ConfigPathResolver

> Sous-issues GitHub associées (créées 2026-09-25, rattachées à #96) : **#131, #132, #133, #134, #135**.

## 📋 Target Invariant & Pre-requisites

- **Target Invariant**: après chaque étape, le comportement runtime reste inchangé tandis que l'application cesse de dépendre de l'arbre source et de `process.cwd()`/`__dirname` pour ses configurations, ses espaces de données et ses adapters. `credentials.json` reste exclusivement utilisateur (jamais dans les defaults, jamais empaqueté, jamais lu par l'agent).
- **Pre-requisites**:
  - Sous-issues #131-#135 créées et rattachées à #96 (fait le 2026-09-25).
  - Dépendances : #134 et #135 exigent #133 mergée ; #131 et #132 sont indépendantes.
  - `node_modules` complet : si absent, `npm install --include=dev --ignore-scripts && npm rebuild hnswlib-node` (`NODE_ENV=production` masque les devDeps).
  - Recoupement optionnel avant implémentation : `graphify extract . --code-only` (AST local) + `codebase-memory-mcp` (`index_repository`) — le MCP n'est pas câblé dans Command Code à ce stade.
  - I/O fichiers via `src/utils/safeFs.ts` uniquement.

## 🛠️ Step-by-Step Sequence

### Step 1: #131 — Chemins utilisateur en dur → `os.homedir()` (critère 2)

- [x] **Action**: `src/providers/adapters/codex.ts:30` et `src/scripts/test_codex_connection.ts:4` : `'/home/omni/.codex/auth.json'` → `path.join(os.homedir(), '.codex', 'auth.json')`. Audit global `grep -rn '/home/omni' --exclude-dir={node_modules,.git}` (fixtures de tests `helpers.test.ts`, `bashTool.test.ts` intentionnelles, à exclure). Ajouter un test de résolution avec `os.homedir()` mocké (`src/tests/unit/providers/codexPath.test.ts`). Branche : `fix/distribution-hardcoded-paths`. PR : [#136](https://github.com/leandre755/HIVE-MIND/pull/136).
- [x] **Verify**: `npm run build && npm run lint:fast && npm run test:unit`
- **Verification Proof**:
```text
> hive-mind@1.0.0 build
> tsc --noEmit
(sortie vide = 0 erreur)

> hive-mind@1.0.0 lint:fast
> oxlint --deny-warnings src/
Found 0 warnings and 0 errors.
Finished in 72ms on 366 files with 96 rules using 4 threads.

npx jest src/tests/unit/providers/codexPath.test.ts
PASS src/tests/unit/providers/codexPath.test.ts
  Codex Auth File Path Resolution (#131)
    ✓ résout le chemin auth.json dynamiquement à partir de os.homedir() (5 ms)
    ✓ gère les chemins avec séparateurs système standards (POSIX ou Windows) (1 ms)
    ✓ exporte AUTH_FILE_PATH cohérent avec la structure attendue (.codex/auth.json) (1 ms)
Test Suites: 1 passed, 1 total
Tests:       3 passed, 3 total

npm run test:unit
Test Suites: 104 passed, 104 total
Tests:       1057 passed, 1057 total
Snapshots:   0 total
Time:        50.985 s
```

### Step 2: #132 — Registre statique des adapters providers (critère 1)

- [ ] **Action**: créer `src/providers/adapters/registry.ts` (imports statiques des 8 adapters — openai, gemini, anthropic, groq, huggingface, cohere, cloudflare, modal — + `export const adapterRegistry: Record<string, ProviderAdapter>`) ; `loadAdapters()` (`src/providers/index.ts:1313-1332`) consomme le registre, suppression de la boucle `pathToFileURL(join(__dirname,'adapters',…)) + import(adapterUrl)`. Canal générique `GenericProviderAdapter`, idempotence `loadPromise` et `ServiceContainer.loadAdapters()` inchangés. Tests : complétude du registre + non-régression (aucun import calculé sur `adapters/`). Branche : `refactor/providers-static-registry`.
- [ ] **Verify**: `npm run build && npm run lint:fast && npx jest src/tests/unit/providers && npm run test:unit`
- **Verification Proof**:
```text
(Session 2026-09-25 : aucune ligne de code modifiée — preuve à déposer à l'exécution.)
```

### Step 3: #133 — ConfigPathResolver + defaults embarqués (critères 3-4, fondation)

- [ ] **Action**: créer `src/config/ConfigPathResolver.ts` (`resolveConfigPath(filename)` : env `HIVE_CONFIG_DIR` > `./config/` projet > `~/.config/hive-mind/` > defaults embarqués ; `resolveDataDir(sub?)`/`resolveTempDir(sub?)`) ; créer `src/config/defaults/` (config.json, models_config.json, scheduler.json, services_config.json, pricing.json en lecture seule — **jamais** credentials.json) ; `src/config/index.ts` passe par le resolver (validation Zod inchangée). Tests : priorité niveau par niveau, repli defaults, override `HIVE_CONFIG_DIR`, absence de credentials dans defaults. Branche : `feat/config-path-resolver`.
- [ ] **Verify**: `npm run build && npm run lint:fast && npx jest src/tests/unit/config && npm run test:unit`
- **Verification Proof**:
```text
(Session 2026-09-25 : aucune ligne de code modifiée — preuve à déposer à l'exécution.)
```

### Step 4: #134 — Migration des consommateurs de config (fin des critères 3-4)

- [ ] **Action**: migrer sur `resolveConfigPath` : `src/providers/index.ts:253`, `src/services/quotaManager.ts:93`, `src/services/supabase.ts:44`, `src/services/redisClient.ts:22`, `src/services/graphMemory.ts:61`, `src/core/ServiceContainer.ts:117-118`, `src/providers/adapters/huggingface.ts:37`, `src/services/voice/voiceProvider.ts:87`, `src/plugins/base/admin/index.ts:378`, `src/scheduler/index.ts:32`, `src/plugins/tools/daily_pulse/journal_generator.ts:92` ; unifier `src/providers/layer0/ModelRegistry.ts:33-46` et `src/providers/layer1/ServiceRegistry.ts:42` (logique cwd supprimée) ; scripts `ingest_docs.js:26-37`, `health-check.ts:32-35`, `test_models.ts:27`, `update_gemma.ts:15`. Si diff > 1000 lignes : découpage 4a (src services/core) / 4b (providers/scripts). Branche : `refactor/config-consumers-migration`.
- [ ] **Verify**: `npm run build && npm run lint:fast && npm run test:unit`
- **Verification Proof**:
```text
(Session 2026-09-25 : aucune ligne de code modifiée — preuve à déposer à l'exécution.)
```

### Step 5: #135 — Espaces de l'agent + assets/caches hors arbre source (inventaire global)

- [ ] **Action**: `Sandbox1/` → `resolveTempDir('sandbox')` (éphémère, symlink interne `storage_hm` du `PermissionManager.ts:955-961` préservé ; `PersistentShell.ts:17`, `SearchTools.ts:77`, `TransportManager.ts:329-332`) ; `storage_hm/` → `resolveDataDir('storage')` (`STORAGE_DIR` prioritaire : `BrowserService.ts:40`, `send_sticker/index.ts:40`, consignes `Planner.ts:684-692`) ; `hm_storage/` → `resolveTempDir('downloads')` (`core/index.ts:1253`, audio) ; `mediaDB/` → `resolveDataDir('mediaDB')` (`MultimodalEmbeddingService.ts:172`, `config.dbPath` prioritaire) ; `skills/` → defaults embarqués + dossier utilisateur (merge ; `TieredContextLoader.ts:755,781`, `LearningEngine.ts:131,159`) ; `db_text/` → corpus embarqué lecture seule (`ingest_docs.js:18`) ; caches TTS (`minimaxTTS.ts:46`, `geminiTTS.ts:97`, `gttsTTS.ts:55`, `voice/minimax.ts:53`, `cleanup.ts:19`), persona (`src/persona/persona.md` via `personaLoader.ts`, post-#130), `dreamService.ts:19`, `TreeSitterService.ts:91,111`, `google_ai_search/index.ts:11` ; mettre à jour les prompts qui codifient les chemins (`Planner.ts:684-692`, frontière sandbox `system.md:183`). Si diff > 1000 lignes : découpage 5a (espaces agent) / 5b (caches + assets). Branche : `refactor/data-spaces-portability`.
- [ ] **Verify**: `npm run build && npm run lint:fast && npm run test:unit`
- **Verification Proof**:
```text
(Session 2026-09-25 : aucune ligne de code modifiée — preuve à déposer à l'exécution.)
```

## ⚠️ Mitigations & Edge Cases

- **Risk**: dépendance non détectée par l'inventaire grep (imports calculés cachés, consommations d'espaces oubliées).
  - **Mitigation**: recoupement graphify (`graphify extract . --code-only`, AST local) + `codebase-memory-mcp` avant chaque PR ; corriger le périmètre de la PR si le graphe révèle un site manquant.
- **Risk**: dépassement du budget de taille de PR (warn 1000 / hard 2500).
  - **Mitigation**: découpage documenté 4a/4b et 5a/5b — jamais de contournement de la gate.
- **Risk**: régression du symlink `storage_hm` interne au sandbox (PermissionManager) ou de l'override `STORAGE_DIR`.
  - **Mitigation**: tests dédiés sur ces deux comportements dans #135 ; invariants listés dans l'issue.
- **Risk**: fuite de secrets durant la migration de config.
  - **Mitigation**: ne jamais ouvrir `src/config/credentials.json` ni `.env*` ; credentials absent de `defaults/` vérifié par test.
- **Risk**: perte de sémantique Zod lors du branchement du resolver.
  - **Mitigation**: validation inchangée dans `src/config/index.ts` ; tests existants de `config.schema` maintenus au vert.
