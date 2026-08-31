# Execution Plan: Jules Security & Performance Fixes

## 📋 Target Invariant & Pre-requisites
- **Target Invariant**: Résolution intégrale des 3 vulnérabilités de Sécurité et des 3 goulots de Performance sans régression de type ou de linter (0 erreur TypeScript, 0 erreur ESLint, tests unitaires verts).
- **Pre-requisites**: Codebase stable (`npx tsc --noEmit` à 0 erreur).

## 🛠️ Step-by-Step Sequence

### Step 1: Sécurité — Confinement strict Bac à Sable dans ASTTools
- [x] **Action**: Modifier `src/plugins/base/dev_tools/ASTTools.ts` pour valider que tous les chemins (relatifs et absolus) sont inclus dans `permissionManager.sandboxDir` via `permissionManager.isInSandbox()`.
- [x] **Verify**: `npx tsc --noEmit && npx eslint src/plugins/`

### Step 2: Sécurité — Sécurisation de l'Exécution Git Pull dans system plugin
- [x] **Action**: Modifier `src/plugins/base/system/index.ts` pour remplacer `execAsync('git pull')` par `execFileAsync('git', ['pull'])` sans processeur shell arbitraire.
- [x] **Verify**: `npx tsc --noEmit && npx eslint src/plugins/`

### Step 3: Sécurité — Assainissement des Arguments d'Éditeur Externe dans editorUtils
- [x] **Action**: Modifier `src/tui/ui/utils/editorUtils.ts` pour valider et échapper les arguments passés à `spawn` / `spawnSync`.
- [x] **Verify**: `npx tsc --noEmit && npx eslint src/tui/`

### Step 4: Performance — Éradication des Requêtes N+1 dans KnowledgeWeaver & GraphMemory
- [x] **Action**: Ajouter `upsertEntitiesBatch` et `addRelationshipsBatch` par lot dans `src/services/graphMemory.ts` et refondre la boucle dans `src/services/knowledgeWeaver.ts`.
- [x] **Verify**: `npx tsc --noEmit && npx eslint src/services/`

### Step 5: Performance — Parallélisation du Contrôle de Santé Modèles dans QuotaManager
- [x] **Action**: Refondre `filterHealthyModels` dans `src/services/quotaManager.ts` avec `Promise.all` pour évaluer l'état des modèles en parallèle.
- [x] **Verify**: `npx tsc --noEmit && npm run test:unit`
- **Verification Proof**:
```text
```

## ⚠️ Mitigations & Edge Cases
- **Risk**: Des répertoires légitimes hors du bac à sable par défaut pourraient être rejetés par `ASTTools`.
- **Mitigation**: Utiliser `permissionManager.isPathAllowed()` qui prend en compte les répertoires autorisés explicitement.
