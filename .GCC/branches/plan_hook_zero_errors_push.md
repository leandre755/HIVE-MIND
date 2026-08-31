# Execution Plan: Hook Zero Errors, Security Remediation & Push

## 📋 Target Invariant & Pre-requisites

- **Target Invariant**: Le code applicatif reste compilable, formaté, sans erreurs ESLint/Oxlint/architecture/Semgrep, avec une suite Jest verte; le commit et le push passent par `.husky/pre-commit` sans `--no-verify`.
- **Security Invariant**: Aucun `eslint-disable`, `@ts-ignore`, `@ts-nocheck`, exclusion Semgrep abusive ou désactivation de règle ne doit masquer un défaut réel.
- **Scope autorisé**: `src/`, `.github/workflows/pr-review.yml`, `documentations/tui/reference/core-connection.md`, `eslint.config.js`, `.husky/pre-commit` uniquement si une modification est techniquement nécessaire; `excalidraw/**` et `llm_as_*/**` restent exclus d'ESLint comme demandé.
- **Pre-requisites**: Node `v24.18.1`, npm `11.16.0`, dépendances présentes dans `node_modules`, réseau disponible pour `npm audit` et le téléchargement/caching Semgrep, mémoire disponible vérifiée par `free -m` avant les scans lourds.
- **Baseline mapping**: Graphify a reconstruit le graphe du dépôt avec `9317 nodes` et `29252 edges`; le graphe reste un outil de cartographie, pas une preuve de correction.

## 📌 État au moment de la relève

- `eslint.config.js` exclut désormais `excalidraw/**` et `llm_as_*/**`.
- `npx eslint . --max-warnings=0` → **EXIT 0**, `0` erreur, `0` warning.
- Les 3 fichiers Prettier ont été corrigés et le contrôle ciblé passe.
- Le conflit `SubagentActivityItem` de `src/tui/ui/contexts/UIStateContext.tsx` a été corrigé; `npx tsc --noEmit` → **EXIT 0**.
- Semgrep reste à `122 findings` répartis ainsi: `57` unsafe-formatstring, `51` path-traversal, `4` GitHub mutable-action-tag, `4` insecure-websocket, `2` express-res-sendfile, `2` spawn-shell-true, `1` ajv-allerrors-true, `1` incomplete-sanitization.
- La dernière suite Jest complète observée: `57 passed / 9 failed` suites, `405 passed / 49 failed` tests sur `454`.
- `npm audit --audit-level=high --omit=dev` → **EXIT 0**, `0` high/critical, `8` moderate à traiter séparément.
- Le répertoire de travail contenait déjà de nombreuses modifications avant ce chantier; ne pas écraser ni inclure automatiquement ces changements dans le commit final.

## 🛠️ Step-by-Step Sequence

### Step 1: Reproduire l’état courant avant chaque vague

- [x] **Action**: Vérifier `git status --short`, `git diff --stat`, `free -m`, puis mettre à jour la cartographie avec `graphify update . --no-cluster` si des fichiers structurels changent.
- [x] **Verify**: Comparer les sorties aux compteurs ci-dessus; aucun fichier utilisateur ne doit être réinitialisé.
- **Verification Proof**:

```text
[graphify watch] Rebuilt (no clustering): 9317 nodes, 29252 edges
Code graph updated. For doc/paper/image changes run /graphify --update in your AI assistant.
```

### Step 2: Stabiliser les couches statiques de base

- [x] **Action**: Corriger uniquement le formatage signalé dans `src/core/transport/baileys.ts`, `src/tui/ui/commands/hiveCommands.ts` et `src/tui/ui/contexts/UIStateContext.tsx`.
- [x] **Action**: Supprimer le doublon d'import/redéclaration `SubagentActivityItem` dans `src/tui/ui/contexts/UIStateContext.tsx`.
- [x] **Verify**: `npx prettier --check "src/**/*.{ts,tsx,json,md}" && npx tsc --noEmit`.
- **Verification Proof**:

```text
All matched files use Prettier code style!

npx tsc --noEmit
EXIT 0, aucun output
```

### Step 3: Maintenir le périmètre ESLint explicite

- [x] **Action**: Conserver `excalidraw/**` et `llm_as_*/**` dans les ignores de `eslint.config.js`.
- [x] **Action**: Utiliser les exports nommés de `typescript-eslint`, `eslint-plugin-sonarjs` et `eslint-plugin-import-x` afin de supprimer les warnings de configuration.
- [x] **Verify**: `npx eslint . --max-warnings=0`.
- **Verification Proof**:

```text
npx eslint . --max-warnings=0
EXIT 0, aucun output
```

### Step 4: Corriger les 57 unsafe-formatstring

- [ ] **Action**: Remplacer les templates dynamiques passés comme premier argument à `console.*` par des formats statiques (`%s`, `%d`) et des arguments séparés; préserver le contenu et le niveau de log.
- [ ] **Scope**: `src/config`, `src/core`, `src/plugins`, `src/providers`, `src/services`, `src/scripts`, `src/tui` et `src/utils` selon le rapport JSON Semgrep.
- [ ] **Invariant**: Aucun identifiant, message d'erreur ou contexte de log ne doit être perdu; ne pas remplacer par un log silencieux.
- [ ] **Verify**: Rejouer Semgrep ciblé sur `unsafe-formatstring`, puis `npx eslint . --max-warnings=0`, `npx tsc --noEmit` et les tests des modules touchés.
- **Verification Proof**:

```text
[à remplir après exécution]
```

### Step 5: Corriger les 51 détections path-traversal

- [ ] **Action**: Pour chaque `path.join`/`path.resolve`, déterminer si l'entrée est constante, contrôlée par l'utilisateur ou issue d'une API. Les entrées contrôlables doivent être canonisées et vérifiées contre le répertoire autorisé avant toute lecture/écriture.
- [ ] **Réutilisation obligatoire**: Utiliser les validations existantes de `PermissionManager`, `SafeScriptValidator` et les helpers de chemin avant de créer un nouvel utilitaire.
- [ ] **Scope**: `src/config`, `src/core/security`, `src/core/transport`, `src/plugins/base/dev_tools`, `src/plugins/base/sys_interaction`, `src/plugins/loader.ts`, `src/plugins/tools/send_sticker`, `src/providers/adapters/geminiTTS.ts`, `src/services`, `src/scripts`.
- [ ] **Invariant**: Une entrée invalide doit être refusée explicitement; aucun chemin ne doit sortir de sa racine autorisée; les chemins de test doivent rester déterministes.
- [ ] **Verify**: Tests unitaires de sandbox/path, Semgrep ciblé, TypeScript, ESLint et tests des outils de fichiers.
- **Verification Proof**:

```text
[à remplir après exécution]
```

### Step 6: Corriger les findings sécurité haute confiance

- [ ] **GitHub Actions**: Remplacer les quatre références mutables de `.github/workflows/pr-review.yml` par des SHA complets vérifiés pour `actions/checkout`, `actions/setup-node`, `tj-actions/changed-files` et `sanjay3290/jules-pr-reviewer`.
- [ ] **WebSocket**: Corriger `src/tui/core/connection.ts` et `src/tui/utils/activityLogger.ts` sans casser le mode local; préférer une politique explicite `ws` local / `wss` distant avec validation de configuration. Mettre à jour la documentation correspondante.
- [ ] **Shell**: Corriger `src/tui/ui/utils/editorUtils.ts` pour éviter `shell: true`; si Windows impose une adaptation, utiliser une résolution d'exécutable et des arguments structurés plutôt qu'une concaténation shell.
- [ ] **Fichiers envoyés**: Sécuriser les appels `sendFile` de `src/core/transport/TransportManager.ts` et `src/plugins/tools/visual_reporter/index.ts` par canonicalisation + allowlist de répertoires.
- [ ] **Ajv**: Évaluer `allErrors: true` dans `src/services/agentic/Planner.ts`; limiter les erreurs ou désactiver ce mode si le contrat fonctionnel le permet, puis ajouter/adapter un test de validation.
- [ ] **Sanitization**: Remplacer le `replace(']', ...)` de `src/tui/ui/components/shared/text-buffer.ts` par une opération globale sûre et tester plusieurs occurrences.
- [ ] **Verify**: Semgrep, tests ciblés de sécurité, TypeScript, ESLint, Depcruise.
- **Verification Proof**:

```text
[à remplir après exécution]
```

### Step 7: Corriger les 9 suites Jest échouées

- [ ] **MediaDB**: Dans `MultimodalEmbeddingService`, `MediaIndexer` et `MediaSearch`, isoler chaque test avec un répertoire temporaire unique, réinitialiser l'état HNSW/JSON et supprimer récursivement les fixtures après chaque test; supprimer la collision de timestamp observée.
- [ ] **Smart Router**: Corriger le chargement/mocking des adapters `.ts`/`.js` dans `src/tests/smart_router_v2.test.ts` et vérifier la cascade de modèles sans dépendre de fichiers compilés absents.
- [ ] **TieredContextLoader**: Rétablir l'injection attendue des métadonnées `<survie-skills>` sans réintroduire de contenu de skill complet.
- [ ] **TUI WebSocket**: Rendre le test indépendant de l'interdiction sandbox `listen EPERM` ou exécuter la validation dans un environnement autorisant le loopback; ne pas masquer un échec réseau réel.
- [ ] **Response sanitizer**: Corriger les motifs `triple_quote_tool_call`, `code_execution` et `tool_browser_screenshot` afin que le texte nettoyé et `strippedItems` respectent les contrats existants.
- [ ] **Visual reporter**: Corriger le mock `safeFs`/`safeExistsSync` et vérifier la génération + l'envoi du PDF.
- [ ] **Audio cleanup**: Aligner la normalisation des chemins entre `cleanupTempFiles` et les assertions, sans supprimer un fichier hors racine autorisée.
- [ ] **Verify**: Lancer d'abord chaque suite ciblée, puis `npm test -- --runInBand`.
- **Verification Proof**:

```text
[à remplir après exécution]
```

### Step 8: Rejouer tout le pipeline sans contournement

- [ ] **Action**: Vérifier la mémoire avec `free -m`; arrêter tout serveur/watch actif; lancer `sh .husky/pre-commit`.
- [ ] **Verify**: Le hook doit atteindre et valider les 8 couches: secrets, npm audit, Oxlint, Prettier, TypeScript, Depcruise, ESLint, Semgrep.
- [ ] **Commandes complémentaires**: `npx depcruise --validate .dependency-cruiser.cjs src`, `npx eslint . --max-warnings=0`, `npx tsc --noEmit`, `npm test -- --runInBand`.
- **Verification Proof**:

```text
[à remplir avec la sortie brute du hook]
```

### Step 9: Revue du commit et push normal

- [ ] **Action**: Examiner `git diff --stat`, `git diff --check` et `git status --short`; séparer les modifications de ce chantier des modifications préexistantes.
- [ ] **Action**: Stager explicitement les fichiers validés; ne pas inclure `.GCC/main.md`, `.GCC/resume.md`, `.commandcode/settings.json` ou d'autres changements préexistants sans décision explicite.
- [ ] **Verify avant commit**: `git diff --cached --check` puis `sh .husky/pre-commit` avec les fichiers staged.
- [ ] **Commit**: Utiliser un message Conventional Commit décrivant la correction réelle, sans `--no-verify`.
- [ ] **Push**: `git push origin <branche-courante>`; si le réseau exige une autorisation, demander l'escalade plutôt que contourner le hook.
- **Verification Proof**:

```text
[à remplir: hash du commit, sortie pre-commit, sortie git push]
```

## ⚠️ Mitigations & Edge Cases

- **Risque**: Les règles Semgrep `unsafe-formatstring` et `path-traversal` sont heuristiques; une correction mécanique peut changer les logs ou casser un chemin valide.
  - **Mitigation**: Corriger par lots fonctionnels, conserver les contrats de sortie, tester chaque lot et ne jamais désactiver la règle pour faire passer le hook.
- **Risque**: Les tests MediaDB partagent actuellement un chemin temporaire et un état persistant.
  - **Mitigation**: Répertoire UUID par test + teardown récursif borné à `/tmp`/fixture; valider l'absence de fuite après la suite.
- **Risque**: Le test WebSocket est bloqué par la sandbox (`listen EPERM`).
  - **Mitigation**: Distinguer test unitaire du transport et test d'intégration loopback; demander une exécution escaladée uniquement pour la preuve réseau.
- **Risque**: Le dépôt possède de nombreuses modifications préexistantes non commitées.
  - **Mitigation**: Ne jamais utiliser `git add .` sans revue; stage explicite et conserver un inventaire des fichiers touchés.
- **Risque**: `npm audit` peut échouer avant analyse sur DNS/cache.
  - **Mitigation**: Rejouer avec autorisation réseau/cache; consigner séparément les vulnérabilités moderate des high/critical bloquantes.

## 👉 Handover Directives

1. Ouvrir `.GCC/branches/plan_hook_zero_errors_push.md` puis vérifier `git status --short`.
2. Commencer à **Step 4**: les étapes formatage, TypeScript et ESLint sont déjà validées.
3. Lire `/tmp/semgrep-current.json` si disponible; sinon relancer le scan JSON avec `uv run --with semgrep semgrep scan --config auto --json --error`.
4. Après chaque lot de corrections: exécuter la commande de vérification indiquée et coller sa sortie brute dans ce fichier avant le lot suivant.
5. Ne pousser qu'après succès de `sh .husky/pre-commit`; ne jamais utiliser `git commit --no-verify` ni `git push --no-verify`.
