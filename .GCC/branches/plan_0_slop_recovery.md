# Execution Plan: Resolution Des Erreurs Simples TypeScript & ESLint

## 📋 Target Invariant & Pre-requisites

- **Target Invariant**: Résoudre toutes les erreurs de type simples (annotations, imports, types manquants, casts) et de linting simple sans refactoriser de fonctions complètes ni dégrader les tests existants.
- **Pre-requisites**: `eslint-config-prettier` configuré, `npx tsc --noEmit` opérationnel.

## 🛠️ Step-by-Step Sequence

### Step 1: Diagnostic Initial et Inventaire des Erreurs
- [ ] **Action**: Exécuter `npx tsc --noEmit` et `npx eslint src/` pour capturer la liste exacte des erreurs.
- [ ] **Verify**: Rapport factual des erreurs TypeScript et ESLint.
- **Verification Proof**:

```text
[En cours d'exécution...]
```

### Step 2: Correction des Erreurs TypeScript Simples (src/tui & src/utils)
- [ ] **Action**: Appliquer les typages et correctifs simples dans `src/tui/ui/` et `src/utils/`.
- [ ] **Verify**: `npx tsc --noEmit`

### Step 3: Correction des Erreurs ESLint et Oxlint Simples
- [ ] **Action**: Corriger les erreurs ESLint/Oxlint ne nécessitant pas de refactoring de fonctions.
- [ ] **Verify**: `npx oxlint src/` et `npx eslint src/`

### Step 4: Formatage Prettier & Validation du Pre-commit Hook
- [ ] **Action**: Lancer `npx prettier --write src/` et vérifier que le pre-commit passe.
- [ ] **Verify**: `./.husky/pre-commit` ou `ALLOW_CONFIG_EDIT=1 git commit`

## ⚠️ Mitigations & Edge Cases

- **Risk**: Blocage des commits par le pre-commit hook en raison de fichiers de config modifiés.
- **Mitigation**: Utiliser `ALLOW_CONFIG_EDIT=1` si nécessaire pour valider les modifications de config protégées.
