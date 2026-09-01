# Execution Plan: PR 14 Production Dependencies Migration

## 📋 Target Invariant & Pre-requisites
- **Target Invariant**: Codebase 100% conforme TypeScript 7.0.2 natif (`npm run build`), Oxlint clean (`npm run lint:fast`), 100% tests unitaires verts (65 suites Jest), 0 vulnérabilité (`npm audit`), 0 licence incompatible (suppression d'audio-decode).
- **Pre-requisites**: `master` propre sur `76681e0`, branche de travail PR #14 `dependabot/npm_and_yarn/npm-production-c8701cb41e`.

## 🛠️ Step-by-Step Sequence

### Step 1: Checkout & Configuration des Dépendances (PR #14)
- [ ] **Action**: Basculer sur `dependabot/npm_and_yarn/npm-production-c8701cb41e`, supprimer `audio-decode` de `package.json`, aligner les 20 autres dépendances de production, et régénérer `package-lock.json` via `npm install`.
- [ ] **Verify**: `npm audit`
- **Verification Proof**:
```text
Pending execution
```

### Step 2: Analyse d'Impact & Adaptation du Code Source (Redis, OpenAI, Groq, Pino)
- [ ] **Action**: Vérifier avec codebase-memory MCP et adapter le code source dans `src/services/redisClient.ts` (remplacement import raw `fs` par `safeFs.ts`, compatibilité redis v6), `src/providers/adapters/openai.ts`, `src/providers/adapters/groq.ts`, `src/core/transport/baileys.ts`.
- [ ] **Verify**: `npm run build && npm run lint:fast`
- **Verification Proof**:
```text
Pending execution
```

### Step 3: Validation Complète des Tests Unitaires & Gates
- [ ] **Action**: Exécuter la suite complète de 65 suites de test Jest sous Node 22 ESM.
- [ ] **Verify**: `npm run test:unit`
- **Verification Proof**:
```text
Pending execution
```

### Step 4: Commit & Préparation de Synchronisation
- [ ] **Action**: Commiter avec Conventional Commits (`chore(deps): align production dependencies and remove unused audio-decode`) via le canal autorisé `ALLOW_CONFIG_EDIT=1` pour les fichiers protégés de configuration.
- [ ] **Verify**: `git status && git log -n 1`
- **Verification Proof**:
```text
Pending execution
```

## ⚠️ Mitigations & Edge Cases
- **Risk**: Rupture d'API sur `redis` v6 ou typage `@types/diff` v8.
- **Mitigation**: Adaptation fine des signatures d'appels dans les adaptateurs/services correspondants.
- **Risk**: Conflit de hook pre-commit sur `package.json` / `package-lock.json`.
- **Mitigation**: Utilisation du canal autorisé documenté `ALLOW_CONFIG_EDIT=1 git commit`.
