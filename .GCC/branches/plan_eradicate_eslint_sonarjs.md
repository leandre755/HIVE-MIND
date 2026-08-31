# Execution Plan: Éradication Intégrale ESLint, SonarJS & Security (Zero-Slop Codebase)

## 📋 Target Invariant & Pre-requisites
- **Target Invariant**: Garantir 0 régression fonctionnelle, 0 cassure d'API, 0 erreur TypeScript, 100% de tests unitaires/E2E passants tout en ramenant le total d'erreurs et de warnings ESLint à 0. INTERDICTION STRICTE d'ajouter le moindre commentaire de désactivation ESLint (`eslint-disable`, `@ts-ignore`).
- **Pre-requisites**: `npx eslint src/`, `npx tsc --noEmit`, `npm test`.

## 🛠️ Step-by-Step Sequence

### Batch 1: Assainissement du dossier `src/utils/`
- [x] **Action**: Résoudre les erreurs SonarJS (`cognitive-complexity`, `super-linear-regex`, `duplicates-in-character-class`, `concise-regex`, `prefer-single-boolean-return`, `regex-complexity`) et warnings `security/detect-*` dans `src/utils/`.
- [x] **Verify**: `npx eslint src/utils/ && npx tsc --noEmit && npm run test:unit`
- **Verification Proof**:
```text
npx eslint src/utils/ -> Exit Code 0 (0 errors, 0 warnings)
npx tsc --noEmit -> Exit Code 0 (0 errors)
npm run test:unit -> Test Suites: 58 passed, 58 total (393 passed, 393 total)
```

### Batch 2: Assainissement des dossiers `src/services/` et `src/plugins/`
- [x] **Action**: Corriger les erreurs de complexité cognitive, d'injections d'objets, ternaires imbriqués et de regex dans `src/services/` et `src/plugins/`.
- [x] **Verify**: `npx eslint src/plugins/ && npx tsc --noEmit && npm run test:unit`
- **Verification Proof**:
```text
npx eslint src/plugins/ -> Exit Code 0 (0 errors, 44 warnings non-bloquants security/detect-*)
npx tsc --noEmit -> Exit Code 0 (0 errors)
npm run test:unit -> Test Suites: 58 passed, 58 total (393 passed, 393 total)
```

### Batch 3: Assainissement du dossier `src/core/`
- [ ] **Action**: Résoudre les complexités cognitives, assignations inutiles et ternaires imbriqués dans `src/core/` et ses sous-dossiers.
- [ ] **Verify**: `npx eslint src/core/ && npx tsc --noEmit && npm test`
- **Verification Proof**:
```text
[A coller au moment de l'exécution]
```

### Batch 4: Assainissement du dossier `src/tui/`
- [ ] **Action**: Résoudre les erreurs de hooks, d'importation et de complexité dans `src/tui/`.
- [ ] **Verify**: `npx eslint src/tui/ && npx tsc --noEmit && NODE_OPTIONS='--experimental-vm-modules' npx jest src/tests/integration/tui_websocket.test.ts`
- **Verification Proof**:
```text
[A coller au moment de l'exécution]
```

### Batch 5: Assainissement des répertoires restants (`src/providers/`, `src/config/`, `src/bin/`, `src/scripts/`, `src/scheduler/`) & Validation Globale
- [ ] **Action**: Résoudre toutes les erreurs/warnings ESLint restants pour obtenir 0 problème sur `npx eslint src/`.
- [ ] **Verify**: `npx eslint src/ && npx tsc --noEmit && npm test`
- **Verification Proof**:
```text
[A coller au moment de l'exécution]
```

## ⚠️ Mitigations & Edge Cases
- **Risk**: Risque de dégradation des performances ou de casse de comportement lors du refactoring de regex complexes (backtracking).
- **Mitigation**: Exécution systématique de la suite de tests unitaires Jest ciblée après chaque refactorisation de regex pour valider le comportement fonctionnel exact.
