# Comment Utiliser les Fondations de Durcissement et Utilitaires Système (SS-26)

Ce guide pratique détaille la mise en œuvre des bibliothèques de durcissement système pour sécuriser les opérations de fichiers contre les attaques par traversée de répertoires, poser des verrous distribués atomiques et réparer les flux JSON générés par les LLMs.

## Prérequis

- Node.js >= 22 (ESM natif) et TypeScript configuré.
- Dépendances du projet installées (`npm install jsonrepair redis`).
- Instance Redis active (optionnelle mais recommandée pour les verrous distribués).

## Étapes de Réalisation

### 1. Sécuriser les Entrées/Sorties de Fichiers avec `safeFs`

Remplacez systématiquement tout appel direct à `node:fs` par les wrappers sécurisés de `src/utils/safeFs.ts` en confinant les résolutions dans la racine autorisée.

```typescript
import { resolveWithinRoot, safeReadFileSync, safeWriteFileSync } from '../src/utils/safeFs.js';

export function securelyUpdateConfig(relativeFilePath: string, newContent: string): void {
  const allowedRoot = process.env.SANDBOX_DIR || process.cwd();

  // 1. Résolution avec vérification de non-évasion
  const securePath = resolveWithinRoot(allowedRoot, relativeFilePath);

  // 2. Écriture atomique
  safeWriteFileSync(securePath, newContent, 'utf8');

  // 3. Relecture de confirmation
  const saved = safeReadFileSync(securePath, 'utf8');
  console.log(`Fichier écrit avec succès (${saved.length} caractères).`);
}
```

### 2. Poser un Verrou Distribué Redlock via `LockManager`

Protégez une ressource partagée contre les écritures concurrentes en mémoire distribuée.

```typescript
import { LockManager } from '../src/services/state/LockManager.js';

export async function executeCriticalSection(resourceId: string, task: () => Promise<void>) {
  const locker = new LockManager('critical_jobs', 5000); // TTL 5000ms

  // Tentative avec réessais et gigue aléatoire (jitter)
  const lockId = await locker.acquireWait(resourceId, 5);
  if (!lockId) {
    throw new Error(`Impossible d'acquérir le verrou pour la ressource : ${resourceId}`);
  }

  try {
    await task();
  } finally {
    // Libération atomique garantie par script Lua
    await locker.release(resourceId, lockId);
  }
}
```

### 3. Forcer et Réparer les Réponses JSON avec `ResponseFormatEnforcer`

Encapsulez les appels au modèle de langage pour garantir que le résultat final correspond strictement au schéma attendu.

```typescript
import { enforceFormat } from '../src/utils/ResponseFormatEnforcer.js';

interface ExpectedOutput {
  plan: string[];
  complexity: 'low' | 'medium' | 'high';
}

export async function queryStructuredLlm(
  prompt: string,
  llmCaller: (p: string) => Promise<string>,
): Promise<ExpectedOutput> {
  const result = await enforceFormat<ExpectedOutput>(
    async (retryModifier) => {
      const fullPrompt = retryModifier ? `${prompt}\n\n${retryModifier}` : prompt;
      return await llmCaller(fullPrompt);
    },
    {
      validate: (parsed) => {
        if (!Array.isArray(parsed.plan)) return 'Le champ "plan" doit être un tableau.';
        if (!['low', 'medium', 'high'].includes(parsed.complexity)) return 'Complexité invalide.';
        return true;
      },
      maxRetries: 2,
    },
  );

  if (!result.success || !result.data) {
    throw new Error(`Échec de validation du format JSON : ${result.error}`);
  }

  return result.data;
}
```

### 4. Exécuter des Commandes dans une Session Bash Persistante

Maintenez l'état du répertoire de travail et des variables d'environnement entre plusieurs commandes successives :

```typescript
import { persistentShell } from '../src/plugins/base/dev_tools/PersistentShell.js';

export async function runMultiStepBuild() {
  // 1. Navigation dans un sous-dossier
  await persistentShell.execute('cd src/core && pwd');
  console.log('Répertoire actuel conservé :', persistentShell.getCwd());

  // 2. Exécution dans le même environnement
  const result = await persistentShell.execute('ls -l');
  console.log('Fichiers du dossier courant :\n', result.stdout);
}
```

## Cas Particuliers & Variantes

### Variante A : Requêtes HTTPS Légitimes avec Empreinte JA3 Alignée

Pour effectuer des requêtes sans déclencher les protections anti-bot des WAF :

```typescript
import { impersonatedRequest } from '../src/utils/TlsImpersonator.js';

const response = await impersonatedRequest('https://api.example.com/data', {
  method: 'GET',
  headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
});

if (response.ok) {
  const data = await response.json();
  console.log('Données récupérées :', data);
}
```

### Variante B : Interception des Tentatives de Traversée de Répertoire

Pour capturer et journaliser proprement une tentative d'évasion :

```typescript
try {
  const evilPath = resolveWithinRoot('/app/workspace', '../../../../etc/passwd');
} catch (error) {
  console.warn("Tentative d'évasion bloquée avec succès :", (error as Error).message);
}
```

## Vérification & Validation

Exécutez les suites de tests unitaires dédiées pour valider le parseur JSON résilient et l'impersonateur TLS :

```bash
npx jest src/tests/unit/utils/ResponseFormatEnforcer.test.ts --runInBand
npx jest src/tests/unit/utils/TlsImpersonator.test.ts --runInBand
```

Résultat attendu dans le terminal :

```text
PASS src/tests/unit/utils/ResponseFormatEnforcer.test.ts
  ResponseFormatEnforcer
    ✓ should successfully parse valid JSON on the first attempt (3 ms)
    ✓ should successfully repair slightly malformed JSON (2 ms)
    ✓ should retry when JSON is unparseable, and succeed on retry (3 ms)
    ✓ should retry when validation fails, and fail if retries exhausted (2 ms)

PASS src/tests/unit/utils/TlsImpersonator.test.ts
  TlsImpersonator
    getImpersonatedAgent
      ✓ should return a valid https.Agent (4 ms)
      ✓ should return agent with chromium ciphers when chromium target is selected (1 ms)
    impersonatedRequest
      ✓ should perform HTTPS request with correct settings (3 ms)
      ✓ should fallback to GET method when method option is omitted (1 ms)

Test Suites: 2 passed, 2 total
Tests:       8 passed, 8 total
Snapshots:   0 total
Time:        1.240 s
```

## Guide de Dépannage (Troubleshooting)

| Symptôme / Message d'Erreur                | Cause Probable                                                                                        | Solution Immédiate                                                                                                                |
| :----------------------------------------- | :---------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------- |
| `Path outside allowed root: ../...`        | L'agent a généré un chemin relatif qui tente de remonter au-dessus du répertoire de travail sécurisé. | Confiniez les requêtes dans `process.env.SANDBOX_DIR` ou utilisez des chemins relatifs stricts sans `..`.                         |
| `The shell is already executing a command` | Deux commandes ont été envoyées simultanément à l'instance partagée `persistentShell`.                | Chaîner les commandes avec `await` ou exécuter les commandes en séquence.                                                         |
| `Redis not ready, proceeding without lock` | Le service Redis est éteint ou inaccessible.                                                          | `LockManager` bascule automatiquement en mode dégradé local ; démarrer Redis pour activer les verrous distribués multi-processus. |
