# Execution Plan: SonarCloud P1 — 5 Bugs de Fiabilité + 9 Vulnérabilités GitHub Actions

## 📋 Target Invariant & Pre-requisites
- **Target Invariant**: Les deux gardes d'autorisation (`isGlobalAdmin`, handlers LSP) doivent effectivement bloquer/attraper les opérations asynchrones ; les workflows ne doivent plus exécuter de code résolu dynamiquement (`npx` non épinglé) ni de scripts de cycle de vie non maîtrisés — sans casser la CI (aucune dépendance native ni navigateur requis par `npm run test:unit`).
- **Pre-requisites**: Branche `fix/sonar-p1-bugs-and-workflow-vulns` depuis `master` (`fb49778`). Source des défauts : `SONAR_ISSUES_AUDIT.md` (projet `leandre755_HIVE-MIND2`, extraction du 2026-09-14, branche `master`).

## 🛠️ Step-by-Step Sequence

### Step 1: Correction des 5 bugs de fiabilité (S6544, S4822, S2871 ×3)
- [x] **Action**: `src/core/index.ts` (`_handleShutdown` : `await adminService.isGlobalAdmin`), `src/plugins/base/dev_tools/LSPTool.ts` (`execute` : `await` sur les 4 handlers), `src/plugins/tools/send_sticker/index.ts` (comparateur `localeCompare`), `src/scripts/generate-blueprint.js` (2 comparateurs)
- [x] **Verify**: `npm run build && npm run lint:fast`
- **Verification Proof**:
```text
> hive-mind@1.0.0 build
> tsc --noEmit

> hive-mind@1.0.0 lint:fast
> oxlint --deny-warnings src/

Found 0 warnings and 0 errors.
Finished in 239ms on 334 files with 96 rules using 4 threads.
```

### Step 2: Neutralisation des 9 vulnérabilités de supply-chain GitHub Actions (S6505, S8543)
- [x] **Action**: `.github/workflows/ci.yml` (`npm ci --ignore-scripts`), `.github/workflows/eslint.yml` (`--ignore-scripts` ×2 + `./node_modules/.bin/eslint`), `.github/workflows/release.yml` (`./node_modules/.bin/semantic-release` ×2)
- [x] **Verify**: `python3 .github/scripts/verify_workflows.py`
- **Verification Proof**:
```text
Avant (commit 12b122b) : workflow sonarcloud.yml -> 4 erreurs de pinning SHA, EXIT=1
Après correctifs :
Validation succeeded: 9 workflow(s) compliant.
EXIT=0
```

### Step 3: Validation intégrale et revue locale
- [x] **Action**: `npm run test:unit`, `npx prettier --check`, `npx eslint`
- [x] **Verify**: sortie brute des commandes ci-dessus
- **Verification Proof**:
```text
Test Suites: 77 passed, 77 total
Tests:       834 passed, 834 total
Snapshots:   0 total
Time:        79.211 s

npx eslint <4 fichiers modifiés> -> EXIT=0 (aucune sortie)

npx prettier --check <7 fichiers> :
[warn] .github/workflows/eslint.yml
```
Preuve de non-régression Prettier : l'écart est **préexistant**, indépendant du correctif — `diff` entre la version `HEAD` et sa sortie Prettier montre 4 divergences de guillemets aux lignes 14, 16, 18 et 49, hors des lignes modifiées (53, 54, 60) :
```text
14c14
<     branches: [ "master" ]
---
>     branches: ["master"]
16c16
<     branches: [ "master" ]
---
>     branches: ["master"]
18c18
<     - cron: '37 12 * * 0'
---
>     - cron: "37 12 * * 0"
49c49
<           cache: 'npm'
---
>           cache: "npm"
```

## ⚠️ Mitigations & Edge Cases
- **Risk**: `npm ci --ignore-scripts` casse les modules natifs (hnswlib-node, bufferutil, utf-8-validate) ou l'installation de Chromium (postinstall `npx playwright install chromium`).
- **Mitigation**: Vérifié empiriquement — `hnswlib-node@3.0.0` n'expose aucun hook `install`/`postinstall` (seulement `prepare: husky install`, `build`, `rebuild`) : son binaire `build/Release/addon.node` provient du tarball npm. `bufferutil`/`utf-8-validate` sont des accélérateurs optionnels de `ws` (repli JS natif). Aucun test unitaire ne lance de navigateur (`BrowserService.test.ts` et `browserTools.test.ts` n'ont aucune référence à `playwright`/`chromium`/`launch(` ; `TlsImpersonator.test.ts` ne teste que le chiffrement TLS).
- **Risk**: Le remplacement de `npx <bin>` par le binaire local échoue si le paquet n'est pas installé.
- **Mitigation**: `eslint` est une `devDependency` déclarée ; les étapes `semantic-release` de `release.yml` sont déjà conditionnées à `steps.config.outputs.enabled == 'true'`, lui-même dérivé de la présence de `semantic-release` dans `package.json` (actuellement absent, donc jamais exécutées).
- **Hors périmètre signalé (non corrigé)**: `eslint.yml` épingle `node-version: 20` alors que `package.json` exige `>=22.0.0` (même dette que celle corrigée pour `release.yml`) ; et le `postinstall` du projet (`npx playwright install chromium`) contient un `npx` non épinglé, non listé parmi les 9 findings.
