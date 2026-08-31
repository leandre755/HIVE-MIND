# Execution Plan: Éradication Intégrale ESLint, SonarJS, SAST & Quality (Zero-Slop Codebase)

## 📋 Target Invariant & Pre-requisites
- **Target Invariant**: Mettre la codebase à 0 erreur TypeScript, 0 erreur ESLint, 0 alerte SAST Semgrep critique, 0 violation d'architecture `dependency-cruiser`, et 100% de tests unitaires passants sans aucun commentaire d'inhibition (`eslint-disable`, `@ts-ignore`, `@ts-nocheck`).
- **Pre-requisites**: `npx tsc --noEmit`, `npx oxlint src/`, `npx depcruise --validate .dependency-cruiser.cjs src`, `npm run test:unit`.

## 🛠️ Step-by-Step Sequence

### Step 1: Correctif de la Configuration du Résolveur ESLint (`eslint.config.js`)
- [x] **Action**: Installer `eslint-import-resolver-typescript` et configurer le résolveur TypeScript pour `eslint-plugin-import-x` dans `eslint.config.js` (`importPlugin.flatConfigs.typescript` activé).
- [x] **Verify**: `npx eslint src/utils/safeFs.ts src/tui/utils/resolvePath.ts` -> 0 erreur de résolution `import-x`.
- **Verification Proof**:
```text
npm install -D eslint-import-resolver-typescript
npx eslint src/utils/safeFs.ts src/tui/utils/resolvePath.ts src/tui/utils/sessionCleanup.ts
Exit Code: 0
Output: (0 errors, 0 warnings)
```

### Step 2: Assainissement des Erreurs SonarJS & Qualité dans `src/utils/`
- [x] **Action**:
  - `src/utils/fuzzyMatcher.ts` : Réduire la complexité cognitive des fonctions (de 20/26 à <= 15) et corriger `prefer-const`.
  - `src/utils/helpers.ts` : Éliminer la classe de caractères en double dans la regex (l.233) et l'argument inutilisé `match`.
  - `src/utils/responseSanitizer.ts` : Simplifier la regex complexe (l.218) et supprimer la variable inutilisée `escapeRegex`.
- [x] **Verify**: `npx eslint src/utils/fuzzyMatcher.ts src/utils/helpers.ts src/utils/responseSanitizer.ts && npx tsc --noEmit`
- **Verification Proof**:
```text
npx eslint src/utils/fuzzyMatcher.ts src/utils/helpers.ts src/utils/responseSanitizer.ts && npx tsc --noEmit
Exit Code: 0
Output: (0 errors, 0 warnings)
TSC Status: 0 errors
```

### Step 3: Traitement des Signalements SAST Semgrep
- [x] **Action**:
  - `src/utils/logger.ts`, `src/utils/dnsHelpers.ts`, `src/tui/utils/hiveMd.ts`, `src/services/voice/voiceProvider.ts` : Corriger l'interpolation directe dans les fonctions de log (`unsafe-formatstring`).
  - `src/tui/ui/utils/editorUtils.ts` : Sécuriser l'option `shell` sur `spawn`/`spawnSync` et corriger les escapes superflus.
  - `src/utils/toolValidator.ts` : Remplacer `allErrors: true` par `allErrors: false` contre les DoS et corriger l'import d'Ajv.
- [x] **Verify**: `npx eslint src/utils/logger.ts src/utils/dnsHelpers.ts src/tui/utils/hiveMd.ts src/services/voice/voiceProvider.ts src/tui/ui/utils/editorUtils.ts src/utils/toolValidator.ts && npx tsc --noEmit`
- **Verification Proof**:
```text
npx eslint src/utils/logger.ts src/utils/dnsHelpers.ts src/tui/utils/hiveMd.ts src/services/voice/voiceProvider.ts src/tui/ui/utils/editorUtils.ts src/utils/toolValidator.ts && npx tsc --noEmit
Exit Code: 0
Output: (0 errors, 0 warnings)
TSC Status: 0 errors
```

### Step 4: Assainissement des Composants UI du TUI (`src/tui/ui/`)
- [ ] **Action**: Corriger les avertissements et erreurs de hooks React, d'imports non utilisés et de types dans `src/tui/ui/components/`, `src/tui/ui/hooks/`, et `src/tui/ui/contexts/`.
- [ ] **Verify**: `npx eslint src/tui/ui/ && npx tsc --noEmit`
- **Verification Proof**:
```text
[A coller au moment de l'exécution]
```

### Step 5: Normalisation du Formatage de Code (Prettier)
- [ ] **Action**: Harmoniser le formatage de l'ensemble de la codebase via Prettier pour aligner le style de code.
- [ ] **Verify**: `npx prettier --write "src/**/*.{ts,tsx,json,md}" && npx prettier --check "src/**/*.{ts,tsx,json,md}"`
- **Verification Proof**:
```text
[A coller au moment de l'exécution]
```

### Step 6: Validation Globale Zero-Slop
- [ ] **Action**: Exécuter la suite complète des 8 couches du pre-commit et les tests unitaires.
- [ ] **Verify**: `npx tsc --noEmit && npx oxlint src/ && npx depcruise --validate .dependency-cruiser.cjs src && npm run test:unit -- --maxWorkers=3`
- **Verification Proof**:
```text
[A coller au moment de l'exécution]
```

## ⚠️ Mitigations & Edge Cases
- **Risk**: Casse de résolution d'imports si `eslint-import-resolver-typescript` est mal configuré dans ESLint 9 Flat Config.
- **Mitigation**: Valider chaque modification de `eslint.config.js` sur un fichier échantillon (`safeFs.ts`) avec `npx tsc --noEmit` et `npx eslint`.
