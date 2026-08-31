# Execution Plan: Commits Atomiques par Nature (`fix`)

## 📋 Target Invariant & Pre-requisites
- **Target Invariant**: Valider et enregistrer les 702 fichiers modifiés en 6 commits atomiques sémantiques (utilisant le type `fix` selon les règles du projet). Le dépôt doit être 100% propre après les 6 commits et `npx tsc --noEmit` doit passer avec 0 erreur.
- **Pre-requisites**: `git status`, `npx tsc --noEmit`.

## 🛠️ Step-by-Step Sequence

### Commit 1: Configuration & Outillage
- [ ] **Action**: `git add package.json package-lock.json eslint.config.js tsconfig.json .prettierrc .prettierignore .husky/ .github/ jsconfig.json railpack.json .commandcode/ .vscode/ .GCC/`
- [ ] **Commit**: `build(config): update tooling, linters and project configurations`
- [ ] **Verify**: `git status`

### Commit 2: Core, Services, Utils & Providers (`fix`)
- [ ] **Action**: `git add src/utils/ src/core/ src/services/ src/providers/ src/config/ src/bin/ src/scheduler/`
- [ ] **Commit**: `fix(core): resolve TypeScript errors and linter issues in core and services`
- [ ] **Verify**: `git status`

### Commit 3: TUI Backend & Utilitaires (`fix`)
- [ ] **Action**: `git add src/tui/utils/ src/tui/config/ src/tui/services/ src/types/`
- [ ] **Commit**: `fix(tui-core): resolve TypeScript types and utility errors in TUI backend`
- [ ] **Verify**: `git status`

### Commit 4: Interface Utilisateur TUI (`fix`)
- [ ] **Action**: `git add src/tui/ui/`
- [ ] **Commit**: `fix(tui-ui): resolve TypeScript errors and prop types across TUI UI components`
- [ ] **Verify**: `git status`

### Commit 5: Plugins & Scripts (`fix`)
- [ ] **Action**: `git add src/plugins/ src/scripts/`
- [ ] **Commit**: `fix(plugins): resolve type safety and linting issues in plugins and scripts`
- [ ] **Verify**: `git status`

### Commit 6: Tests & Documentation
- [ ] **Action**: `git add src/tests/ documentation/ *.md`
- [ ] **Commit**: `test(docs): update test suites and documentation for zero-slop baseline`
- [ ] **Verify**: `git status && npx tsc --noEmit`

## ⚠️ Mitigations & Edge Cases
- **Risk**: Fichiers résiduels oubliés ou mauvaise catégorisation.
- **Mitigation**: Vérification stricte via `git status` avant chaque commit et bilan final 0 fichier non commité.
