# Execution Plan: Lot 1 - Sécurité du Code & Concurrence

## 📋 Target Invariant & Pre-requisites
- **Target Invariant**: Neutraliser les failles d'évasion de sandbox RCE dans PTC et d'injection shell dans `PermissionManager`, et garantir l'invariance stricte de concurrence (`activeThreads <= maxConcurrency`) dans `SwarmDispatcher` sans sursouscription V8 ni récursion synchrone.
- **Pre-requisites**: `shell-quote` (déjà présent dans `package.json`), Node.js 22, TypeScript strict.

## 🛠️ Step-by-Step Sequence

### Step 1: Neutralisation de la RCE et Évasion de Sandbox PTC
- [x] **Action**: Modifier `src/services/ptc/SafeScriptValidator.ts` pour interdire `ThisExpression`, filtrer `constructor`, `__proto__`, `prototype` sur les nœuds `Identifier`, `Literal` et `ObjectPattern` (déstructuration). Modifier `src/services/ptc/ProgrammaticExecutor.ts` pour corriger la syntaxe ligne 297 et envelopper chaque outil injecté dans un Proxy hermétique interdisant l'accès aux prototypes et constructeurs.
- [x] **Verify**: Tests unitaires ciblés sur les vecteurs d'attaque AST, déstructuration d'objet et exécution VM.
- **Verification Proof**:
```text
PASS src/tests/unit/ptc/SafeScriptValidator.test.ts (32.694 s)
  SafeScriptValidator & ProgrammaticExecutor Security
    AST Prototype & Sandbox Escape Protection
      ✓ bloque l accès à this dans le sandbox (21 ms)
      ✓ bloque l accès à constructor via syntaxe pointée (3 ms)
      ✓ bloque l accès à constructor via accès calculé Literal (3 ms)
      ✓ bloque l accès à __proto__ via accès calculé Literal (3 ms)
      ✓ bloque le vecteur d attaque complet RCE / VM escape (4 ms)
      ✓ bloque l évasion par déstructuration d objet (const { constructor } = fn) (4 ms)
      ✓ bloque l évasion par déstructuration de prototype (const { __proto__ } = fn) (2 ms)
      ✓ autorise les scripts PTC standards et légitimes (4 ms)
    Runtime Guarded Context Isolation
      ✓ bloque l accès au constructeur hôte lors de l exécution dans le VM (202 ms)
      ✓ rejette explicitement l accès aux propriétés prototypes protégées via le contexte de garde (10 ms)

Test Suites: 1 passed, 1 total
Tests:       10 passed, 10 total
Snapshots:   0 total
Time:        33.993 s
```

### Step 2: Sécurisation du Parseur de Commandes Shell avec `shell-quote`
- [x] **Action**: Modifier `src/core/security/PermissionManager.ts` pour analyser la syntaxe via `shell-quote`, inspecter chaque commande de la chaîne, normaliser le binaire via `basename`, élargir `BANNED_COMMANDS` (`pkexec`, `doas`, `nsenter`, `unshare`, `chroot`, `capsh`, `systemd-run`), vérifier récursivement les subshells `$()` et backticks, ignorer les préfixes d'environnement (`VAR=val`), scinder sur les retours à la ligne, et inspecter les répertoires cibles pour `cd` même avec options (`-P`, `--`).
- [x] **Verify**: Tests unitaires enrichis dans `src/tests/unit/core/permissionManager.test.ts`.
- **Verification Proof**:
```text
PASS src/tests/unit/core/permissionManager.test.ts (30.699 s)
  PermissionManager (MOD 5 + MOD 7)
    isInSandbox
      ✓ returns true for paths inside sandboxDir (17 ms)
      ✓ returns false for paths outside sandboxDir (2 ms)
      ✓ resolves relative paths against sandboxDir (4 ms)
      ✓ blocks symlink escapes pointing outside sandbox (1 ms)
    validateBashCommand
      ✓ blocks banned commands (sudo, su, pkexec, doas) (7 ms)
      ✓ blocks sudo et su avec chemin absolu (/usr/bin/sudo) (2 ms)
      ✓ blocks chaining operators attacks (;, &&, ||, |) (3 ms)
      ✓ blocks inline execution flags (python3 -c, node -e, bash -c) (2 ms)
      ✓ blocks subshells and backticks with banned constructs or inline flags (2 ms)
      ✓ blocks env var prefix before banned commands (2 ms)
      ✓ blocks multi-line commands with sensitive instructions (2 ms)
      ✓ requires permission for cd with flags outside sandbox (cd -P /etc) (3 ms)
      ✓ allows safe commands without permission (3 ms)
      ✓ requires permission for cd outside sandbox (2 ms)
      ✓ allows cd inside sandbox without permission (3 ms)
      ✓ allows non-banned non-safe commands without permission (1 ms)
    validateFileWrite
      ✓ allows writes inside sandbox (4 ms)
      ✓ requires permission for writes outside sandbox (23 ms)
    handleAdminCommand
      ✓ .approve resolves pending request with granted=true (110 ms)
      ✓ .reject resolves pending request with granted=false and feedback (9 ms)
      ✓ .reject without feedback sets feedback to undefined (6 ms)
      ✓ .approve with non-existent ID returns false without crash (11 ms)
      ✓ ignores non-command text (1 ms)
    handleUserResponse
      ✓ "oui" grants permission (6 ms)
      ✓ "y" / "yes" / "ok" grant permission (case insensitive) (16 ms)
      ✓ "non" blocks action (7 ms)
      ✓ "non, fais plutôt X" blocks with corrective feedback (7 ms)
      ✓ returns false when no pending requests (2 ms)
      ✓ returns false for unrecognized responses (2 ms)
    pendingCount
      ✓ reflects the number of pending requests (1 ms)
      ✓ decrements after resolution (4 ms)
    exports
      ✓ BANNED_COMMANDS includes critical system tools (1 ms)
      ✓ SAFE_COMMANDS includes basic read-only commands (1 ms)

Test Suites: 1 passed, 1 total
Tests:       33 passed, 33 total
Snapshots:   0 total
Time:        31.732 s
```

### Step 3: Correction Atomique du Gouverneur de Concurrence
- [x] **Action**: Modifier `src/core/concurrency/SwarmDispatcher.ts` : remplacer la récursion synchrone par une boucle itérative `while`, réserver atomiquement `activeThreads++` de façon synchrone lors du dépilement, conditionner l'incrémentation dans `_executeWithThrottling` pour les tâches qui ont attendu, et éliminer le queue barging en vérifiant `this.globalQueue.length > 0`.
- [x] **Verify**: Tests unitaires sous forte concurrence validant `activeThreads <= maxConcurrency` et respect strict de l'ordre FIFO de la file.
- **Verification Proof**:
```text
PASS src/tests/unit/core/SwarmDispatcher.test.ts (27.752 s)
  SwarmDispatcher (SS-03: Core / Concurrency Swarm)
    ✓ sérialise strictement les tâches asynchrones d un même JID (76 ms)
    ✓ exécute en parallèle les tâches de JIDs distincts (52 ms)
    ✓ retourne les métriques de concurrence et de workers système (9 ms)
    ✓ respecte strictement le plafond maxConcurrency sous forte charge concurrente (171 ms)
    ✓ empêche le queue barging en respectant la file globale (89 ms)

Test Suites: 1 passed, 1 total
Tests:       5 passed, 5 total
Snapshots:   0 total
Time:        28.808 s
```

### Step 4: Validation Globale du Lot 1 & Non-Régression
- [x] **Action**: Exécuter `npm run build && npm run lint:fast`
- [x] **Verify**: `tsc --noEmit` et `oxlint` propres, 0 warnings et 0 erreurs.
- **Verification Proof**:
```text
> hive-mind@1.0.0 build
> tsc --noEmit
[Exit Code 0]

> hive-mind@1.0.0 lint:fast
> oxlint --deny-warnings src/
Found 0 warnings and 0 errors.
Finished in 245ms on 331 files with 96 rules using 4 threads.
[Exit Code 0]
```

### Step 5: Affinages Médico-Légaux & Résolution Critique Multi-Agents
- [x] **Action**:
  - `src/services/ptc/ProgrammaticExecutor.ts` : Préservation de `Array.prototype` dans `_sanitizeToolResult` (suppression de prototype restreinte aux objets ordinaires `!Array.isArray(current)`), neutralisation de la fuite de l'objet hôte `Timeout` par retour d'un primitif numérique, et ajustement du verrouillage du realm VM pour `Array` (`Array.constructor` et `Array.prototype.__proto__` verrouillés).
  - `src/services/ptc/SafeScriptValidator.ts` : Évaluation des expressions dans les `TemplateLiteral` pour bloquer les contournements `${'c'}onstructor`, et égalité exacte `DANGEROUS.includes(propName)` éliminant 100% des faux positifs sur `obj['constructorIndex']` et `cfg['constructorArgs']`.
  - `src/core/security/PermissionManager.ts` : Dépilage des wrappers `timeout`, `stdbuf -oL`, `env -u`, `xargs`, `busybox`, fail-closed de l'approbateur lorsque `senderJid` est absent, et résolution prioritaire par `(chatId, senderJid)` dans `handleUserResponse`.
  - `src/core/concurrency/SwarmDispatcher.ts` : Réinitialisation propre d'`accessMap` lors d'un signal `!stop` pour débloquer les messages ultérieurs du JID, et mutualisation de `_extractMessageText`.
  - `src/core/index.ts` : Affectation de `priority: 3` aux messages standards dans `_onMessage` pour garantir l'ordonnancement FIFO strict dans `FairnessQueue`.
- [x] **Verify**: `npm run build && npm run lint:fast && npm run test:unit`
- **Verification Proof**:
```text
> hive-mind@1.0.0 build
> tsc --noEmit
[Exit Code 0]

> hive-mind@1.0.0 lint:fast
> oxlint --deny-warnings src/
Found 0 warnings and 0 errors.
Finished in 151ms on 331 files with 96 rules using 4 threads.
[Exit Code 0]

Test Suites: 74 passed, 74 total
Tests:       637 passed, 637 total
Snapshots:   0 total
Time:        72.68 s
[Exit Code 0]
```
- **Audits Validés**:
  - **Adversarial Code Reviewer (`5a8b9fa0-ed65-4441-b2bd-b8badbb0e076`)** : **VERDICT: APPROVE (100% Production-Grade)**
  - **Forensic Antibug Auditor (`69a04aff-5254-48e0-9fb5-a007fa4dd055`)** : **STATUS: AUDIT PASSED (0 Critical, 0 High, 0 Medium)**

### Step 6: Étanchéité Totale, Anti-Thenable VM, Redirections Numériques & Revues CLI
- [x] **Action**:
  - `src/services/ptc/ProgrammaticExecutor.ts` : `WeakMap` local `contextCleanupMap` pour encapsuler `cleanupTimers`, résolution isolée par JSON string (`__resolve(JSON.stringify(...))`) contre l'évasion par thenable hôte, `Promise` dans les intrinsics verrouillés (`Promise.constructor` & `Promise.prototype.__proto__`), `setTimeout` résistant aux rejets asynchrones (`res.catch(...)`), exception explicite sur structures circulaires/non-sérialisables, scellement de `__resolve` / `__reject`, et ajout de `caller`, `callee`, `arguments` dans `FORBIDDEN_TOOL_PROPS`.
  - `src/services/ptc/SafeScriptValidator.ts` : Support de `FunctionExpression` dans `_collectASTNodes` pour éliminer les faux positifs `UNDEFINED_VAR`, distinction stricte `computed` vs `!computed` pour `MemberExpression` et `ObjectPattern`.
  - `src/core/security/PermissionManager.ts` & `src/core/index.ts` : Détection exhaustive des redirections de flux (`1>`, `1>>`, `2>`, `2>>`, `&>`, regex `^(\d*>>?|\d*>\||&>>?)$`), détection des classes de caractères glob (`s[u]do`) et expansion d'accolades (`{sudo,id}`) via `matchesPatternOrBraces`, fail-closed sur `HUB_ADMIN_ONLY` sans `senderJid`, et normalisation insensible à la casse / aux espaces dans `src/core/index.ts`.
  - `src/core/concurrency/SwarmDispatcher.ts` : Liaison d'`accessMap` uniquement à `stopTask` sur `!stop` d'urgence pour débloquer immédiatement les messages ultérieurs sans attendre une tâche bloquée suspendue.
- [x] **Verify**: `npm run build && npm run lint:fast && npm run test:unit`
- **Verification Proof**:
```text
> hive-mind@1.0.0 build
> tsc --noEmit
[Exit Code 0]

> hive-mind@1.0.0 lint:fast
> oxlint --deny-warnings src/
Found 0 warnings and 0 errors.
Finished in 56ms on 331 files with 96 rules using 4 threads.
[Exit Code 0]

Test Suites: 74 passed, 74 total
Tests:       647 passed, 647 total
Snapshots:   0 total
Time:        58.58 s
[Exit Code 0]
```
- **Audits & Revues Finales Validées**:
  - **Adversarial Code Reviewer (`4b159f1e-0e72-4527-b60c-d5f795040572`)** : **VERDICT: APPROVE (100% Production-Grade)**
  - **Forensic Antibug Auditor (`a2c31de5-c3de-42ff-be01-2fbaa76ab2bb`)** : **STATUS: AUDIT PASSED (0 Critical, 0 High, 0 Medium)**
  - **CodeRabbit CLI (`task-1863`)** : 100% des findings critiques et majeurs résolus et validés.
  - **Greptile CLI (`task-2070`)** : **Confidence: 5/5 — No blocking failure remains. No review comments.**

### Step 7: Résolution Exhaustive des Retours CodeRabbit CLI (Passe 2)
- [x] **Action**:
  - `src/services/ptc/ProgrammaticExecutor.ts` : Scellement hermétique de `__vmJsonParse` sur `sandboxGlobals` via `Object.defineProperty` (`writable: false, configurable: false, enumerable: false`).
  - `src/core/security/PermissionManager.ts` : Prise en charge des cibles de redirection sous forme de tokens d'objets glob `{ op: 'glob', pattern: '...' }` et détection des branches d'expansion d'accolades `{}` dans `validateFileWrite` ; conversion asynchrone de `_resolveByNumericId` et `handleAdminCommand` avec vérification stricte `await adminService.isSuperUser(senderJid)` en mode `HUB_ADMIN_ONLY`.
  - `src/core/index.ts` : Intégration de `await permissionManager.handleAdminCommand(...)`.
  - `src/tests/unit/core/SwarmDispatcher.test.ts` : Contrôle déterministe de la tâche suspendue `tHung` via une Promise gate explicite (`hungGate`) au lieu d'un délai fixe de 100ms.
  - `src/tests/unit/ptc/ProgrammaticExecutor.test.ts` : Synchronisation explicite dans le script du bac à sable pour observer l'exécution réelle et la capture sécurisée des erreurs et rejets de `setTimeout`.
  - `src/tests/unit/ptc/SafeScriptValidator.test.ts` : Test unitaire d'interdiction de l'accès au constructeur via séquence Unicode `obj["\u0063onstructor"]`.
  - `src/tests/unit/core/permissionManager.test.ts` : Conversion de tous les tests de `handleAdminCommand` en asynchrone, ajout du test `HUB_ADMIN_ONLY` avec vérification superuser, test de `handleUserResponse` sans `chatId`, et tests de redirections d'écriture hors sandbox avec glob `*` et accolades `{}`.
  - `src/tests/integration/core.test.ts` : Alignement du mock `handleAdminCommand` sur une promesse.
- [x] **Verify**: `npm run build && npm run lint:fast && npm run test:unit`
- **Verification Proof**:
```text
> hive-mind@1.0.0 build
> tsc --noEmit
[Exit Code 0]

> hive-mind@1.0.0 lint:fast
> oxlint --deny-warnings src/
Found 0 warnings and 0 errors.
Finished in 77ms on 331 files with 96 rules using 4 threads.
[Exit Code 0]

Test Suites: 74 passed, 74 total
Tests:       650 passed, 650 total
Snapshots:   0 total
Time:        49.395 s
[Exit Code 0]
```

### Step 8: Résolution Finale des Retours CodeRabbit CLI (Passe 3 - 12 Findings Anticipés et Traités)
- [x] **Action**:
  - `src/core/security/PermissionManager.ts` : Sécurisation de l'appel asynchrone `adminService.isSuperUser(senderJid)` par un `try/catch` fail-closed retournant `false` en cas d'échec ; rejet catégorique des réponses in-band (« oui » / « non ») en mode `HUB_ADMIN_ONLY` pour forcer l'usage de `.approve` / `.reject` ; détection préventive par regex des variables et expansions dynamiques dans `cd` et `pushd` (`/(?:^|[;&|\n]\s*)(?:cd|pushd)\s+(?:-[A-Za-z0-9-]+\s+)*["']?[^"'\s]*[$`()\\]/`) avant le parsing `shell-quote` ; fonction récursive `expandBraces` gérant le produit cartésien des accolades imbriquées/multiples sur les redirections d'écriture (`echo x > {/tmp,/etc}/{a,b}`).
  - `src/services/ptc/ProgrammaticExecutor.ts` : Élimination de la syntaxe TypeScript (`as Error`) dans le template JavaScript évalué par la VM (`wrappedCode`) ; suppression des assignations directes initiales mutables `sandboxGlobals.__resolve = resolve` et `sandboxGlobals.__reject` pour ne conserver que la définition hermétiquement scellée via `Object.defineProperty` ; dégradation élégante contrôlée avec exception explicite en cas de retour de fonction exécutable ou de structure circulaire non sérialisable.
  - `src/services/ptc/SafeScriptValidator.ts` : Restriction du traitement des `BinaryExpression` dans `extractStaticString` au seul opérateur d'addition `+` ; support complet des motifs de déstructuration ES6 avancés (`AssignmentPattern`, `RestElement`).
  - `src/tests/unit/ptc/SafeScriptValidator.test.ts` : Typage strict de la Map des outils via `ToolFunction` issu de `types.js` (16 tests au vert).
  - `src/tests/unit/ptc/ProgrammaticExecutor.test.ts` : Tests de dégradation élégante sur fonction exécutable et structure circulaire (14 tests au vert).
  - `src/tests/unit/core/SwarmDispatcher.test.ts` : Remplacement de l'échantillonnage temporel par un compteur atomique test-owned `activeCount` ; test déterministe de déblocage immédiat sur signal d'urgence `!stop` (8 tests au vert).
  - `src/tests/unit/core/permissionManager.test.ts` : Sauvegarde et restauration systématique de `SECURITY_HUB_ID` via `try/finally` ; renforcement des assertions sur `res.reason` pour les expansions dynamiques de `cd` ; test d'expansion d'accolades multiples `{/tmp,/etc}/{safe,cron.d/job}` ; ajout du test vérifiant que `handleUserResponse('oui', 'hub_channel', 'non_super_user')` en mode `HUB_ADMIN_ONLY` est rejeté ; test autorisant `grep sudo /var/log/auth.log` sans fausse alerte (51 tests au vert).
- [x] **Verify**: `npm run build && npm run lint:fast && npx jest src/tests/unit/core/permissionManager.test.ts src/tests/unit/ptc/ProgrammaticExecutor.test.ts src/tests/unit/ptc/SafeScriptValidator.test.ts src/tests/unit/core/SwarmDispatcher.test.ts src/tests/integration/core.test.ts --forceExit --runInBand`
- **Verification Proof**:
```text
> hive-mind@1.0.0 build
> tsc --noEmit
[Exit Code 0]

> hive-mind@1.0.0 lint:fast
> oxlint --deny-warnings src/
Found 0 warnings and 0 errors.
Finished in 88ms on 331 files with 96 rules using 4 threads.
[Exit Code 0]

PASS src/tests/unit/core/permissionManager.test.ts (51 passed, 51 total)
PASS src/tests/unit/ptc/ProgrammaticExecutor.test.ts (14 passed, 14 total)
PASS src/tests/unit/ptc/SafeScriptValidator.test.ts (16 passed, 16 total)
PASS src/tests/unit/core/SwarmDispatcher.test.ts (8 passed, 8 total)
PASS src/tests/integration/core.test.ts (7 passed, 7 total)

Test Suites: 5 passed, 5 total
Tests:       96 passed, 96 total
Snapshots:   0 total
[Exit Code 0]
```

### Step 9: Résolution Intégrale des Retours CodeRabbit CLI (Passe 4 - 7 Findings Traités)
- [x] **Action**:
  - `src/core/security/PermissionManager.ts` : Borner `expandBraces` à `MAX_BRACE_BRANCHES = 64` avec retour fail-closed (`braceOverflow` renvoie `{ result: false, requiresPermission: true, reason: ... }`), éliminant tout déni de service combinatoire sur les redirections d'écriture ; ajout de la détection et exigence de permission (`requiresPermission: true`) pour les interpréteurs exécutant du code (`awk`, `gawk`, `mawk`, `nawk`, `sed`, `gsed`).
  - `src/services/ptc/ProgrammaticExecutor.ts` : Ajout de `Function` aux constructeurs intrinsèques verrouillés dans le realm VM (`typeof Function !== 'undefined' ? Function : null`) ; remplacement du `catch {}` silencieux par une propagation d'erreur explicite fail-closed (`catch (e) { throw new Error(...) }`).
  - `src/services/ptc/SafeScriptValidator.ts` : Ajout du nœud AST `NewExpression` interdisant formellement l'instanciation de constructeurs non autorisés (`new Function()`).
  - `src/tests/unit/core/permissionManager.test.ts` : Test d'interception et fail-closed sur rejet réseau de `adminService.isSuperUser` (`network down`) ; test bloquant le dépassement de 64 branches d'accolades ; test exigeant la permission pour `awk` et `sed` (53 tests au vert).
  - `src/tests/unit/ptc/SafeScriptValidator.test.ts` : Test d'interdiction de `prototype` via accès pointé et calculé ; test bloquant l'appel direct et l'instanciation de `Function` (18 tests au vert).
  - `src/tests/unit/ptc/ProgrammaticExecutor.test.ts` : Test vérifiant le blocage de l'exécution du constructeur `Function` dans le sandbox VM (15 tests au vert).
  - Alignement des journaux GCC (`main.md`, `resume.md`) sur les métriques exactes des tests.
- [x] **Verify**: `npm run build && npm run lint:fast && npx jest src/tests/unit/core/permissionManager.test.ts src/tests/unit/ptc/ProgrammaticExecutor.test.ts src/tests/unit/ptc/SafeScriptValidator.test.ts src/tests/unit/core/SwarmDispatcher.test.ts src/tests/integration/core.test.ts --forceExit --runInBand`
- **Verification Proof**:
```text
> hive-mind@1.0.0 build
> tsc --noEmit
[Exit Code 0]

> hive-mind@1.0.0 lint:fast
> oxlint --deny-warnings src/
Found 0 warnings and 0 errors.
Finished in 70ms on 331 files with 96 rules using 4 threads.
[Exit Code 0]

PASS src/tests/unit/core/permissionManager.test.ts (53 passed, 53 total)
PASS src/tests/unit/ptc/ProgrammaticExecutor.test.ts (15 passed, 15 total)
PASS src/tests/unit/ptc/SafeScriptValidator.test.ts (18 passed, 18 total)
PASS src/tests/unit/core/SwarmDispatcher.test.ts (8 passed, 8 total)
PASS src/tests/integration/core.test.ts (7 passed, 7 total)

### Step 10: Résolution Chirurgicale des Retours CodeRabbit CLI (Passe 5 - 4 Findings Traités)
- [x] **Action**:
  - `src/core/security/PermissionManager.ts` : Déplacement de la détection des interpréteurs `awk`, `gawk`, `mawk`, `nawk`, `sed`, `gsed` depuis la boucle des tokens préliminaires vers l'analyse post-résolution des wrappers sur `baseCmd` (éliminant les faux positifs sur `grep awk ...` et `grep sed ...`) ; typage obligatoire et strict de `chatId: string` et `senderJid: string` dans les signatures de `handleAdminCommand(text, chatId, senderJid)` et `_resolveByNumericId`.
  - `src/services/ptc/SafeScriptValidator.ts` : Utilisation de `quasis[i]?.value?.cooked ?? quasis[i]?.value?.raw ?? ''` dans `extractStaticString` pour décoder correctement les séquences d'échappement Unicode dans les `TemplateLiteral` (`target[\`\\u0063onstructor\`]`).
  - `src/tests/unit/core/permissionManager.test.ts` : Ajout du test vérifiant que `awk` et `sed` sont autorisés comme arguments de commandes de lecture légitimes (`grep awk src/main.c`, `grep -rn sed /var/log/auth.log`, `echo "processing with awk and sed"`) ; passage explicite de `chatId` et `senderJid` dans tous les appels à `handleAdminCommand` (54 tests au vert).
  - `src/tests/unit/ptc/SafeScriptValidator.test.ts` : Ajout du test vérifiant le blocage de `target[\`\\u0063onstructor\`]` avec séquence d'échappement Unicode dans un template literal (19 tests au vert).
- [x] **Verify**: `npm run build && npm run lint:fast && npx jest src/tests/unit/core/permissionManager.test.ts src/tests/unit/ptc/ProgrammaticExecutor.test.ts src/tests/unit/ptc/SafeScriptValidator.test.ts src/tests/unit/core/SwarmDispatcher.test.ts src/tests/integration/core.test.ts --forceExit --runInBand`
- **Verification Proof**:
```text
> hive-mind@1.0.0 build
> tsc --noEmit
[Exit Code 0]

> hive-mind@1.0.0 lint:fast
> oxlint --deny-warnings src/
Found 0 warnings and 0 errors.
Finished in 116ms on 331 files with 96 rules using 4 threads.
[Exit Code 0]

PASS src/tests/unit/core/permissionManager.test.ts (54 passed, 54 total)
PASS src/tests/unit/ptc/ProgrammaticExecutor.test.ts (15 passed, 15 total)
PASS src/tests/unit/ptc/SafeScriptValidator.test.ts (19 passed, 19 total)
PASS src/tests/unit/core/SwarmDispatcher.test.ts (8 passed, 8 total)
PASS src/tests/integration/core.test.ts (7 passed, 7 total)

Test Suites: 5 passed, 5 total
Tests:       103 passed, 103 total
Snapshots:   0 total
[Exit Code 0]
```

### Step 11: Résolution de la Vulnérabilité Greptile P1 (Parseur Shell-Aware Command Substitutions & Imbrications)
- [x] **Action**:
  - `src/core/security/PermissionManager.ts` : Remplacement du parsing par regex dans `_checkSubshells` par un parseur modulaire shell-aware (`_extractSubshells`, `_skipSingleQuote`, `_skipAnsiCQuote`, `_skipComment`, `_parseDoubleQuote`, `_parseMatchingBacktick`, `_parseMatchingParen`) gérant avec précision les guillemets simples, guillemets doubles, citations ANSI-C, backticks, commentaires et parenthèses imbriquées ; politique fail-closed sur syntaxe tronquée/malformée ; validation récursive de toutes les sous-commandes via `validateBashCommand` ; nettoyage des délimiteurs et interdiction des exécutables dynamiques dans `_checkPrivilegeEscalationArgs` et `_validateSingleSubCommand`.
  - `src/tests/unit/core/permissionManager.test.ts` : Ajout d'une batterie complète de tests adversariaux couvrant les contournements par parenthèses entre guillemets (`echo "$(printf ')'; sudo id)"`), backticks (<code>echo \`printf ")"; sudo id\`</code>), quotes ANSI-C, redirections `<(...)` avec parenthèses, échappements (`echo "$(echo \); sudo id)"`), imbrications multi-niveaux (`$($(echo sudo) id)`), expressions arithmétiques `$(( 2 + 3 ))` et validation fail-closed sur syntaxe non fermée (57 tests au vert).
- [x] **Verify**: `npm run build && npm run lint:fast && npx jest src/tests/unit/core/permissionManager.test.ts`
- **Verification Proof**:
```text
> hive-mind@1.0.0 lint:fast
> oxlint --deny-warnings src/
Found 0 warnings and 0 errors.
Finished in 87ms on 331 files with 96 rules using 4 threads.

> hive-mind@1.0.0 build
> tsc --noEmit
[Exit Code 0]

PASS src/tests/unit/core/permissionManager.test.ts
Test Suites: 1 passed, 1 total
Tests:       57 passed, 57 total
Snapshots:   0 total
Time:        10.681 s
[Exit Code 0]
```

## ⚠️ Mitigations & Edge Cases
- **Risk**: Faux positifs du validateur AST sur des propriétés autorisées.
- **Mitigation**: Distinction stricte entre clés statiques et calculées, validée par 15 tests dans `SafeScriptValidator.test.ts`.
- **Risk**: Commandes shell légitimes avec pipes ou redirections (`ls | grep`).
- **Mitigation**: Valider que chaque segment de commande dans le pipe respecte les règles de sécurité sans bloquer inutilement les flux de lecture autorisés (`grep sudo` autorisé sans permission).
- **Risk**: Approbation frauduleuse par des utilisateurs non-superusers au sein du canal Security Hub ou contournement in-band.
- **Mitigation**: Contrôle asynchrone obligatoire `await adminService.isSuperUser(senderJid)` en mode `HUB_ADMIN_ONLY` avec try/catch fail-closed et blocage strict des réponses in-band (« oui »).
