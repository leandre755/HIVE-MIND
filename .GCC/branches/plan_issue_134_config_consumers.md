# Execution Plan: Migration des consommateurs de configuration sur ConfigPathResolver (#134)

## 📋 Target Invariant & Pre-requisites
- **Target Invariant**: Chaque site de consommation de configuration JSON accède à ses fichiers via `resolveConfigPath(filename)` (ou `loadJsonConfig(filename)` / `loadAndValidateConfig` pour les validations Zod et fusions). Suppression intégrale des constructions en dur relatives à `__dirname` ou `process.cwd()` vers `config/` ou `src/config/`. Éradication des `fs.readFileSync` bruts au profit de `safeReadFileSync` (`src/utils/safeFs.ts`). Préservation absolue du comportement runtime, des fallbacks sur les defaults embarqués, et du confinement sécuritaire des credentials.
- **Pre-requisites**:
  - Sous-issue #96.3 (#133 / PR #138) mergée dans `master` (`ConfigPathResolver.ts` opérationnel et couvert à 100%).
  - PR #139 (pricing.json via `resolveConfigPath`) et PR #140 (alignement documentaire Diátaxis) mergées dans `master`.
  - Branche de travail dédiée : `refactor/config-consumers-migration` initialisée sur `origin/master`.

## 🛠️ Step-by-Step Sequence

### Step 1: Migration des services de stockage et mémoire
- [x] **Action**: Migrer `src/services/supabase.ts`, `src/services/redisClient.ts` et `src/services/graphMemory.ts` vers `resolveConfigPath('credentials.json')` et remplacer `readFileSync` par `safeReadFileSync`.
- [x] **Verify**: `npm run build && npm run lint:fast && npm test -- src/tests/unit/services`
- **Verification Proof**:
```text
> tsc --noEmit (0 errors)
> oxlint --deny-warnings src/ (Found 0 warnings and 0 errors across 372 files)
> jest src/tests/unit/services
Test Suites: 27 passed, 27 total
Tests:       310 passed, 310 total
```

### Step 2: Migration du conteneur de services et de la gestion des quotas
- [x] **Action**: Migrer `src/core/ServiceContainer.ts:117-118` et `src/services/quotaManager.ts:93` pour charger `credentials.json` et `models_config.json` via `resolveConfigPath`. Utiliser `safeReadFileSync` et respecter les validations Zod existantes.
- [x] **Verify**: `npm run build && npm run lint:fast && npm test -- src/tests/unit/core`
- **Verification Proof**:
```text
> tsc --noEmit (0 errors)
> oxlint --deny-warnings src/ (Found 0 warnings and 0 errors across 372 files)
> jest src/tests/unit/core
Test Suites: 15 passed, 15 total
Tests:       166 passed, 166 total
```

### Step 3: Migration des adapters et des services vocaux
- [x] **Action**: Migrer `src/providers/adapters/huggingface.ts:37` et `src/services/voice/voiceProvider.ts:87` vers `resolveConfigPath('credentials.json')` et `safeReadFileSync`.
- [x] **Verify**: `npm run build && npm run lint:fast && npm test -- src/tests/unit/providers`
- **Verification Proof**:
```text
> tsc --noEmit (0 errors)
> oxlint --deny-warnings src/ (Found 0 warnings and 0 errors across 372 files)
> jest src/tests/unit/providers
Test Suites: 12 passed, 12 total
Tests:       201 passed, 201 total
```

### Step 4: Migration des plugins et outils
- [x] **Action**: Migrer `src/plugins/base/admin/index.ts:378` (`config.json`) et `src/plugins/tools/daily_pulse/journal_generator.ts:92` (`credentials.json`) vers `resolveConfigPath` et `safeReadFileSync`. Sécuriser l'écriture de `admin/_setVoiceMode` avec redirection vers `resolveUserConfigDir()`.
- [x] **Verify**: `npm run build && npm run lint:fast && npm test -- src/tests/unit/plugins`
- **Verification Proof**:
```text
> tsc --noEmit (0 errors)
> oxlint --deny-warnings src/ (Found 0 warnings and 0 errors across 372 files)
> jest src/tests/unit/plugins
Test Suites: 14 passed, 14 total
Tests:       80 passed, 80 total
```

### Step 5: Migration des scripts utilitaires
- [x] **Action**: Migrer `src/scripts/health-check.ts`, `src/scripts/ingest_docs.js`, `src/scripts/test_models.ts` et `src/scripts/update_gemma.ts` vers `resolveConfigPath` et `safeReadFileSync`.
- [x] **Verify**: `npm run build && npm run lint:fast`
- **Verification Proof**:
```text
> tsc --noEmit (0 errors)
> oxlint --deny-warnings src/ (Found 0 warnings and 0 errors across 373 files)
```

### Step 6: Tests unitaires dédiés et validation de non-régression
- [x] **Action**: Créer `src/tests/unit/services/configConsumers.test.ts` (couvrant QuotaManager, VoiceProvider, AdminPlugin fallback write, ServiceContainer, HuggingFaceAdapter). Exécuter la suite unitaire complète du projet.
- [x] **Verify**: `npm run build && npm run lint:fast && npm run test:unit`
- **Verification Proof**:
```text
> tsc --noEmit (0 errors)
> oxlint --deny-warnings src/ (Found 0 warnings and 0 errors across 373 files)
> npm run test:unit
Test Suites: 109 passed, 109 total
Tests:       1108 passed, 1108 total
Snapshots:   0 total
Time:        43.355 s
```

### Step 7: Revue locale et audit sous-agents
- [x] **Action**: Déclencher une relecture par les sous-agents critiques indépendants (`antibug` - Fix Verification Critic & Global System Critic) pour homologation 100% defect-free / production-grade.
- [x] **Verify**: Approbation 100% sans défaut.
- **Verification Proof**:
```text
Fix Verification Critic (antibug):
AUDIT PASSED: Zero bugs, vulnerabilities, or regressions identified across the analyzed scope.
Mention officielle : 100% production-grade / impressed.

Global System Critic (antibug):
AUDIT PASSED: Zero bugs, vulnerabilities, or regressions identified across the analyzed scope.
Verdict : 100% production-grade / impressed.
```

## ⚠️ Mitigations & Edge Cases
- **Risk**: Cas où `admin/_setVoiceMode` tente d'écrire dans un template en lecture seule (`defaults/config.json`) si aucun fichier utilisateur n'existe encore.
  - **Mitigation**: Résolu — si `configPath` pointe sur les defaults ou le dossier legacy source, la cible d'écriture est redirigée vers `resolveUserConfigDir()` (`~/.hivemind/config/config.json`) avec `safeMkdirSync`. Test unitaire dédié validé.
- **Risk**: Fichiers de credentials manquants ou corrompus provoquant des crashs non gérés au démarrage d'un service.
  - **Mitigation**: Blocs try/catch préservés avec fallbacks gracieux (localhost pour Redis, warning pour Supabase/GraphMemory, token null pour HuggingFace).
- **Risk**: Régression sur les mocks de tests existants qui simulent `safeReadFileSync` ou `fs`.
  - **Mitigation**: Suite unitaire complète (109 suites, 1108 tests) passée à 100% avec succès.
