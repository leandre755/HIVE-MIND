# Execution Plan: Issue Triage Format Validation & Needs-Triage Handling

## 📋 Target Invariant & Pre-requisites
- **Target Invariant**: Les issues valides et complètes selon les gabarits officiels (`[BUG]`, `[FEATURE]`, `[DOCS]`) voient l'étiquette `needs-triage` retirée lors du passage de l'action de triage, tandis que les issues incomplètes, non formatées ou avec des textes indicatifs non modifiés conservent ou reçoivent `needs-triage`. Les workflows GitHub Actions restent 100% conformes à `.github/scripts/verify_workflows.py`.
- **Pre-requisites**: Templates officiels dans `.github/ISSUE_TEMPLATE/*.md`, environnement Node.js >= 22, suite de tests Jest.

## 🛠️ Step-by-Step Sequence

### Step 1: Création du module de validation de format d'issue `.github/scripts/triage_issue.cjs`
- [x] **Action**: Créer `.github/scripts/triage_issue.cjs` avec les fonctions `evaluateIssueFormat` et `runTriage`.
- [x] **Verify**: `node -e "require('./.github/scripts/triage_issue.cjs')"`
- **Verification Proof**:
```text
Loaded functions: [
  'normalizeHeader',
  'extractSections',
  'validateSectionContent',
  'validateBugTemplate',
  'validateFeatureTemplate',
  'validateDocsTemplate',
  'evaluateIssueFormat',
  'buildTriageCommentBody',
  'runTriage'
]
```

### Step 2: Création de la suite de tests unitaires Jest `src/tests/unit/github/issueTriage.test.ts`
- [x] **Action**: Créer la suite de tests couvrant bug valide, bug incomplet/placeholders, feature valide/incomplète (y compris critères remplis), doc valide/incomplète (mot example préservé), issues non formatées, priorité et sécurité, et simulation complète de l'API GitHub (`runTriage`, `process.env.ISSUE_NUMBER`, 404/500, update/create comment, non-retrait sur issue invalide, cohérence de payload number).
- [x] **Verify**: `npm test -- src/tests/unit/github/issueTriage.test.ts`
- **Verification Proof**:
```text
PASS src/tests/unit/github/issueTriage.test.ts (9.133 s)
  Issue Triage - extractSections
    ✓ should extract and normalize h2 headers and content (5 ms)
    ✓ should not break section extraction when code block contains markdown h2 headers (1 ms)
    ✓ should normalize headers without emojis or special characters
    ✓ should ignore markdown h2 headers inside an unclosed code block (1 ms)
    ✓ should handle empty or null body gracefully (1 ms)
  Issue Triage - evaluateIssueFormat Bug & Features
    ✓ should validate a complete and properly filled bug report and remove needs-triage (2 ms)
    ✓ should validate bug report where Actual Behavior contains only a stack trace inside a code block (1 ms)
    ✓ should mark bug report invalid if scroll down placeholder is left in steps
    ✓ should mark bug report invalid if required section is missing or title empty
    ✓ should validate a complete feature request and remove needs-triage (1 ms)
    ✓ should validate feature request where Acceptance Criteria has filled "- Criterion 1: ..." lines (1 ms)
    ✓ should mark feature request invalid if Use Case only contains example scenario markdown (1 ms)
  Issue Triage - evaluateIssueFormat Docs & Freeform
    ✓ should accept issue retaining guide prompts when substantive answer is written below (1 ms)
    ✓ should mark docs report invalid if Affected Section only contains default guide text (1 ms)
    ✓ should not strip user text containing the word example in documentation issue (1 ms)
    ✓ should assign needs-triage to freeform issue without recognized template prefix (1 ms)
    ✓ should detect critical priority and security keywords and handle empty inputs (1 ms)
    ✓ should prioritize security and priority-high over thematic labels in freeform issues (2 ms)
  Issue Triage - runTriage Labels & Comments
    ✓ should remove needs-triage and add bug label for valid bug report (4 ms)
    ✓ should handle 404 on removeLabel gracefully and log warning on 500 error (2 ms)
    ✓ should fetch issue via REST API when context.payload.issue is undefined (workflow_dispatch) (1 ms)
    ✓ should update existing triage comment if marker is found (1 ms)
    ✓ should update existing comment regardless of user.type when marker is present (1 ms)
    ✓ should keep needs-triage and never call removeLabel for an invalid bug report (1 ms)
    ✓ should not re-add needs-triage on edit if needs-triage was not present in existing labels (1 ms)
  Issue Triage - runTriage Guard Conditions & Environment
    ✓ should fail cleanly if target is a pull request and avoid adding labels (1 ms)
    ✓ should read ISSUE_NUMBER from process.env when issueNumber argument is omitted (1 ms)
    ✓ should reject invalid or malformed ISSUE_NUMBER from process.env (1 ms)
    ✓ should fetch issue via REST API if context.payload.issue has a mismatched number (1 ms)
    ✓ should fail cleanly if issueNumber argument is invalid or negative (1 ms)
    ✓ should tolerate comments with null or undefined body without crashing (1 ms)
  Issue Triage - buildTriageCommentBody
    ✓ should generate valid markdown comment for compliant issue with removed needs-triage (1 ms)
    ✓ should generate warning markdown comment for invalid issue with maintained needs-triage
    ✓ should generate warning markdown comment without mentioning needs-triage when needs-triage is not in labelsToAdd (1 ms)

Test Suites: 1 passed, 1 total
Tests:       34 passed, 34 total
Snapshots:   0 total
Time:        8.613 s
Ran all test suites matching src/tests/unit/github/issueTriage.test.ts.
```

### Step 3: Adaptation du workflow `.github/workflows/issue-triage.yml`
- [x] **Action**: Ajouter l'étape `actions/checkout` épinglée (`3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1`) et câbler l'exécution de `.github/scripts/triage_issue.cjs`.
- [x] **Verify**: `python3 .github/scripts/verify_workflows.py .github/workflows`
- **Verification Proof**:
```text
Validation succeeded: 7 workflow(s) compliant.
```

### Step 4: Validation de l'intégrité globale du codebase
- [x] **Action**: Exécuter la suite complète de validation (`build`, `lint:fast`, `verify_workflows.py`, `test:unit`).
- [x] **Verify**: `npm run build && npm run lint:fast && npm run test:unit`
- **Verification Proof**:
```text
> hive-mind@1.0.0 build
> tsc --noEmit
[Exit Code 0]

> hive-mind@1.0.0 lint:fast
> oxlint --deny-warnings src/
Found 0 warnings and 0 errors.
Finished in 107ms on 332 files with 96 rules using 4 threads.

Validation succeeded: 7 workflow(s) compliant.

Test Suites: 75 passed, 75 total
Tests:       695 passed, 695 total
Snapshots:   0 total
Time:        66.685 s
Ran all test suites matching src/tests/unit.
```

### Step 5: Intégration des Retours de Review PR #39 (CodeRabbit & Greptile)
- [x] **Action**:
  1. **Greptile P1 (fences tildes)** : conformité CommonMark dans `extractSections` (`parseOpeningFence`, `isClosingFence`), matching strict de délimiteur (tildes `~~~` et backticks ```` ``` ````).
  2. **CodeRabbit Finding (fences vides)** : implémentation de `filterNonFenceLines` sans regex fragile pour supprimer les blocs vides y compris avec espaces avant l'info string (ex. ```` ``` markdown ````), évitant de retenir les mots-clés de langage comme texte substantiel.
  3. **Greptile P1 (authentification bot)** : vérification stricte de l'auteur dans `upsertTriageComment` (`comment.user?.login === 'github-actions[bot]' || comment.user?.type === 'Bot'`) pour empêcher l'usurpation du commentaire de diagnostic par un tiers.
  4. **CodeRabbit Finding ([DOC] non officiel)** : restriction stricte au préfixe officiel `[DOCS]`. Les issues titrées `[DOC]` sont traitées en freeform et conservent `needs-triage`.
  5. **CodeRabbit Finding (propagation d'échec de suppression de label)** : arrêt propre et appel `core.setFailed` dans `runTriage` lorsqu'une erreur non-404 survient sur `removeLabel`, garantissant la cohérence d'état de l'issue.
  6. **Script PR Reviews** : création de `scripts/fetch_pr_reviews.js` pour automatiser la récupération de 100% des revues, commentaires inline et suggestions sur toute PR via GitHub CLI.
- [x] **Verify**: `npm test -- src/tests/unit/github/issueTriage.test.ts && npm run build && npm run lint:fast`
- **Verification Proof**:
```text
PASS src/tests/unit/github/issueTriage.test.ts
Test Suites: 1 passed, 1 total
Tests:       49 passed, 49 total
```

## ⚠️ Mitigations & Edge Cases
- **Risk**: Erreur de l'API GitHub lors de la tentative de suppression de `needs-triage` si le label n'était pas présent sur l'issue (HTTP 404).
- **Mitigation**: Protection `try/catch` fail-safe avec contrôle de `err.status === 404` pour ignorer silencieusement l'absence du label, tout en propageant les erreurs non-404 à `core.setFailed`.
- **Risk**: Usurpation du commentaire automatique de triage par un utilisateur insérant `TRIAGE_MARKER`.
- **Mitigation**: Filtrage explicite sur l'identité de l'automatisation (`github-actions[bot]` ou `user.type === 'Bot'`) dans `upsertTriageComment`.
- **Risk**: Faux négatif de conformité sur un template ayant de légères variations d'espaces ou d'émojis dans les titres de section.
- **Mitigation**: Découpage ligne par ligne avec détection `line.startsWith('## ')` dans `extractSections` et normalisation sémantique des en-têtes via `normalizeHeader`.
