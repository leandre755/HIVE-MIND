# Execution Plan: PR 14 Production Dependencies Migration

## 📋 Target Invariant & Pre-requisites
- **Target Invariant**: Codebase 100% conforme TypeScript 7.0.2 natif (`npm run build`), Oxlint clean (`npm run lint:fast`), 100% tests unitaires verts (65 suites Jest), 0 vulnérabilité (`npm audit`), 0 licence incompatible (suppression d'audio-decode).
- **Pre-requisites**: `master` propre sur `76681e0`, branche de travail PR #14 `dependabot/npm_and_yarn/npm-production-c8701cb41e`.

## 🛠️ Step-by-Step Sequence

### Step 1: Checkout & Configuration des Dépendances (PR #14)
- [x] **Action**: Basculer sur `dependabot/npm_and_yarn/npm-production-c8701cb41e`, supprimer `audio-decode` de `package.json`, aligner les 20 autres dépendances de production, ajouter l'override `browserslist: ^4.28.8`, et régénérer `package-lock.json` via `npm install`.
- [x] **Verify**: `npm audit`
- **Verification Proof**:
```text
found 0 vulnerabilities
```

### Step 2: Analyse d'Impact & Adaptation du Code Source (Redis v6)
- [x] **Action**: Adapter le code source dans `src/services/redisClient.ts` (remplacement import raw `fs` par `safeFs.js`, adaptation de `keepAlive: true` et `keepAliveInitialDelay: 10000`, assignation dynamique robuste dans `switchToMock`), et `src/services/state/StateManager.ts` (`sPop` multi -> `sPopCount`).
- [x] **Verify**: `npm run build && npm run lint:fast`
- **Verification Proof**:
```text
> hive-mind@1.0.0 build
> tsc --noEmit

> hive-mind@1.0.0 lint:fast
> oxlint --deny-warnings src/
Found 0 warnings and 0 errors.
Finished in 131ms on 325 files with 96 rules using 4 threads.
```

### Step 3: Validation Complète des Tests Unitaires & Gates
- [x] **Action**: Exécuter la suite complète de 65 suites de test Jest sous Node 22 ESM et valider les hooks Quality Gate.
- [x] **Verify**: `npm run test:unit`
- **Verification Proof**:
```text
Test Suites: 65 passed, 65 total
Tests:       502 passed, 502 total
Snapshots:   0 total
Time:        58.142 s, estimated 71 s
Ran all test suites matching src/tests/unit.
```

### Step 4: Commit & Préparation de Synchronisation
- [x] **Action**: Commiter avec Conventional Commits (`fix(redis): adapt client and state manager to redis v6 and purge audio-decode`) via le canal autorisé `ALLOW_CONFIG_EDIT=1` pour les fichiers protégés de configuration (`67e5f7f`).
- [x] **Verify**: `git status && git log -n 1`
- **Verification Proof**:
```text
[dependabot/npm_and_yarn/npm-production-c8701cb41e 67e5f7f] fix(redis): adapt client and state manager to redis v6 and purge audio-decode
 4 files changed, 50 insertions(+), 556 deletions(-)
```

## ⚠️ Mitigations & Edge Cases
- **Risk**: Rupture d'API sur `redis` v6 (`sPop` n'acceptant plus le paramètre count en v6).
- **Mitigation**: Utilisation de `sPopCount` dans `StateManager.ts`.
- **Risk**: Violation de licence GPL introduite par la dépendance morte `audio-decode`.
- **Mitigation**: Suppression définitive d'audio-decode et régénération propre du lockfile.
