# Tasks: Extraction & Découplage de la TUI dans un Dépôt Autonome

## Phase 1: Core Transport Decoupling & Isolation

### Task 1: Relocaliser HiveTransport dans le Core et mettre à jour les imports
**Description:** Déplacer `src/tui/transport/HiveTransport.ts` vers `src/core/transport/tui/HiveTransport.ts` et mettre à jour les imports dans `TuiServerTransport.ts`, `TransportManager.ts` et `PermissionManager.ts` pour que le Core ne dépende plus du dossier `src/tui/`.
**Acceptance criteria:**
- [ ] `src/core/transport/tui/HiveTransport.ts` est créé avec les types d'événements WebSocket (`HiveTransportEvents`, `PresencePayload`, etc.).
- [ ] `src/core/transport/TuiServerTransport.ts`, `TransportManager.ts` et `PermissionManager.ts` pointent vers `./tui/HiveTransport.js`.
- [ ] Aucun fichier sous `src/core/` n'importe de fichier sous `src/tui/`.
**Verification:**
- [ ] Tests pass: `npx jest src/tests/unit/core/ --runInBand`
- [ ] Build succeeds: `npx tsc --noEmit`
- [ ] Manual check: `grep -rn "src/tui" src/core/` ne retourne aucune occurrence.
**Dependencies:** None
**Files likely touched:**
- `src/core/transport/tui/HiveTransport.ts`
- `src/core/transport/TuiServerTransport.ts`
- `src/core/transport/TransportManager.ts`
- `src/core/security/PermissionManager.ts`
**Estimated scope:** S (4 files)
**Teamwork Role:** Worker Alpha (Core Transport Specialist)

### Task 2: Réaligner le test d'intégration WebSocket du Core
**Description:** Mettre à jour `src/tests/integration/tui_websocket.test.ts` pour importer `HiveTransport` et les types WebSocket depuis `src/core/transport/tui/` et remplacer l'import de `UIStateContext` par un type local ou énumération déportée.
**Acceptance criteria:**
- [ ] `tui_websocket.test.ts` n'importe aucun fichier situé dans `src/tui/`.
- [ ] La suite de tests d'intégration WebSocket démarre le serveur, connecte un mock client et valide les événements.
**Verification:**
- [ ] Tests pass: `NODE_OPTIONS='--experimental-vm-modules' npx jest src/tests/integration/tui_websocket.test.ts --forceExit`
- [ ] Build succeeds: `npx tsc --noEmit`
**Dependencies:** Task 1
**Files likely touched:**
- `src/tests/integration/tui_websocket.test.ts`
**Estimated scope:** S (1 file)
**Teamwork Role:** Worker Alpha / Critic 1 (Core Integrity Critic)

### Checkpoint 1: Isolation du Core HIVE-MIND
- [ ] `npx tsc --noEmit` propre (0 erreurs).
- [ ] `NODE_OPTIONS='--experimental-vm-modules' npx jest src/tests/integration/tui_websocket.test.ts --forceExit` réussi (100%).
- [ ] Validation par Critic 1 avant de passer à la Phase 2.

---

## Phase 2: Standalone TUI Repository Construction

### Task 3: Initialiser le dépôt `/home/omni/Code/HIVE-MIND-TUI` et copier les sources
**Description:** Créer le répertoire `/home/omni/Code/HIVE-MIND-TUI`, initialiser git, copier l'arborescence `src/tui/` vers `src/`, et générer la configuration npm (`package.json`, `tsconfig.json`, `eslint.config.js`, `.gitignore`).
**Acceptance criteria:**
- [ ] Le répertoire `/home/omni/Code/HIVE-MIND-TUI` existe avec `git init`.
- [ ] Les 136 fichiers sources de la TUI sont copiés dans `HIVE-MIND-TUI/src/`.
- [ ] `package.json` est configuré avec React 19, `@jrichman/ink`, `ws`, scripts `start`, `build`, `lint`, `test`.
**Verification:**
- [ ] Manual check: `test -d /home/omni/Code/HIVE-MIND-TUI/src` et `test -f /home/omni/Code/HIVE-MIND-TUI/package.json`.
**Dependencies:** None (peut s'exécuter en parallèle de la Phase 1)
**Files likely touched:**
- `/home/omni/Code/HIVE-MIND-TUI/package.json`
- `/home/omni/Code/HIVE-MIND-TUI/tsconfig.json`
- `/home/omni/Code/HIVE-MIND-TUI/eslint.config.js`
- `/home/omni/Code/HIVE-MIND-TUI/.gitignore`
- `/home/omni/Code/HIVE-MIND-TUI/README.md`
**Estimated scope:** M (5 config files + 136 copied files)
**Teamwork Role:** Worker Beta (TUI Standalone Scaffolder)

### Task 4: Injecter les utilitaires autonomes `safeFs.ts` et `errors.ts`
**Description:** Créer `src/utils/safeFs.ts` et `src/utils/errors.ts` dans le dépôt TUI pour éliminer les imports relatifs sortants (`../../utils/safeFs.js`, `../../utils/errors.js`).
**Acceptance criteria:**
- [ ] `HIVE-MIND-TUI/src/utils/safeFs.ts` expose `safeReadFileSync`, `safeWriteFileSync`, `safeMkdirSync`, `safeExistsSync`, etc.
- [ ] `HIVE-MIND-TUI/src/utils/errors.ts` expose `debugLogger`, `FatalToolExecutionError`, `getErrorMessage`.
**Verification:**
- [ ] Build succeeds: `cd /home/omni/Code/HIVE-MIND-TUI && npx tsc --noEmit`
**Dependencies:** Task 3
**Files likely touched:**
- `HIVE-MIND-TUI/src/utils/safeFs.ts`
- `HIVE-MIND-TUI/src/utils/errors.ts`
**Estimated scope:** S (2 files)
**Teamwork Role:** Worker Gamma (TUI Decoupling Specialist)

### Task 5: Corriger les imports internes et découpler `providerStatus.ts`
**Description:** Mettre à jour les imports dans tous les fichiers TUI pour pointer vers les utilitaires internes, et réécrire `providerStatus.ts` pour ne plus importer `providerRouter` et `envResolver` du backend.
**Acceptance criteria:**
- [ ] `providerStatus.ts` ne contient aucun import de `src/providers` ou `src/services`.
- [ ] Tous les imports relatifs sortants (`../../utils/safeFs.js`) sont réalignés sur `./utils/safeFs.js` ou `../utils/safeFs.js`.
- [ ] Aucun import cassé résiduel dans le nouveau dépôt.
**Verification:**
- [ ] Build succeeds: `cd /home/omni/Code/HIVE-MIND-TUI && npx tsc --noEmit`
**Dependencies:** Task 4
**Files likely touched:**
- `HIVE-MIND-TUI/src/ui/utils/providerStatus.ts`
- `HIVE-MIND-TUI/src/core/connection.ts`
- `HIVE-MIND-TUI/src/config/settings.ts`
**Estimated scope:** M (5 files)
**Teamwork Role:** Worker Gamma (TUI Decoupling Specialist)

### Task 6: Installer les dépendances et valider le build/lint du dépôt TUI
**Description:** Exécuter `npm install` dans `HIVE-MIND-TUI` et passer l'analyse statique complète (TypeScript + ESLint).
**Acceptance criteria:**
- [ ] `npm install` termine avec succès (0 erreurs).
- [ ] `npx tsc --noEmit` termine avec code 0 (0 erreurs).
- [ ] `npx eslint src/` termine avec code 0 (0 erreurs, 0 warnings).
**Verification:**
- [ ] Build succeeds: `cd /home/omni/Code/HIVE-MIND-TUI && npm run build`
- [ ] Linter passes: `cd /home/omni/Code/HIVE-MIND-TUI && npm run lint`
**Dependencies:** Task 5
**Files likely touched:**
- `HIVE-MIND-TUI/package.json`
- `HIVE-MIND-TUI/package-lock.json`
**Estimated scope:** S (Configuration & validation)
**Teamwork Role:** Critic 2 (TUI Build & Lint Critic)

### Checkpoint 2: Dépôt TUI Standalone Opérationnel
- [ ] Dépôt `/home/omni/Code/HIVE-MIND-TUI` autonome avec 0 erreurs TypeScript et 0 warnings ESLint.
- [ ] Validation par Critic 2 avant de supprimer la TUI de HIVE-MIND.

---

## Phase 3: Monorepo Pruning & Dependency Cleanup

### Task 7: Supprimer le dossier `src/tui/` de HIVE-MIND
**Description:** Supprimer définitivement le dossier `src/tui/` du dépôt principal HIVE-MIND après avoir vérifié qu'aucun fichier restant ne l'importe.
**Acceptance criteria:**
- [ ] Le dossier `src/tui/` est supprimé.
- [ ] `npx tsc --noEmit` dans HIVE-MIND reste propre à 100%.
**Verification:**
- [ ] Build succeeds: `npx tsc --noEmit`
- [ ] Manual check: `test ! -d src/tui`
**Dependencies:** Checkpoint 1 & Checkpoint 2
**Files likely touched:**
- `src/tui/` (suppression de 136 fichiers)
**Estimated scope:** S (Suppression propre)
**Teamwork Role:** Worker Delta (HIVE-MIND Dependency Stripper)

### Task 8: Alléger les dépendances Ink/React de `package.json` dans HIVE-MIND
**Description:** Désinstaller les dépendances spécifiques à la TUI (`@jrichman/ink`, `ink`, `ink-gradient`, `ink-spinner`, `ink-text-input`, `react`, `@xterm/headless`, `lowlight`, `clipboardy`) de HIVE-MIND et adapter les scripts npm.
**Acceptance criteria:**
- [ ] `package.json` et `package-lock.json` sont nettoyés des paquets d'UI Ink/React.
- [ ] Le script `"tui"` dans `package.json` affiche un message explicatif orientant vers le nouveau dépôt ou lance le binaire externe.
- [ ] Les tests et la compilation du Core restent 100% verts.
**Verification:**
- [ ] Tests pass: `npm test`
- [ ] Build succeeds: `npx tsc --noEmit`
- [ ] Linter passes: `npx eslint src/ --max-warnings=0`
**Dependencies:** Task 7
**Files likely touched:**
- `package.json`
- `package-lock.json`
**Estimated scope:** S (2 files)
**Teamwork Role:** Worker Delta / Critic 3 (Core Dependency & Regression Auditor)

### Checkpoint 3: HIVE-MIND Core Allégé & Intègre
- [ ] `npx tsc --noEmit` (0 erreurs), `npx eslint src/` (0 warnings).
- [ ] `npm test` vert (toutes les suites passent sans régression).
- [ ] Validation par Critic 3.

---

## Phase 4: Cross-Repository E2E & Final Verification

### Task 9: Valider la communication WebSocket E2E entre HIVE-MIND et HIVE-MIND-TUI
**Description:** Démarrer le Core HIVE-MIND en tâche de fond (création de `tui-connection.json`), lancer le client `HIVE-MIND-TUI` autonome, et vérifier la connexion, le streaming et les événements de statut.
**Acceptance criteria:**
- [ ] Le serveur `TuiServerTransport` démarre et écrit `tui-connection.json`.
- [ ] `HIVE-MIND-TUI` lit `tui-connection.json`, s'authentifie avec succès et affiche le statut « Connecté ».
- [ ] Un message utilisateur envoyé depuis la TUI reçoit la réponse du Core et les événements de présence.
**Verification:**
- [ ] Manual check: Session interactive live confirmée.
- [ ] Integration test passes: `tui_websocket.test.ts`
**Dependencies:** Checkpoint 3
**Estimated scope:** M (Validation runtime multi-process)
**Teamwork Role:** Worker Epsilon (E2E Integration Specialist)

### Checkpoint 4: Validation Finale & Décharge
- [ ] Audit dual-repo par le Global Adversarial Critic.
- [ ] Mise à jour de `.GCC/main.md`, `.GCC/branches/test.md` et `.GCC/resume.md`.
- [ ] Clôture et approbation utilisateur.
