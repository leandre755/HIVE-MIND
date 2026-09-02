# Hardening Foundations & Execution Utilities (SS-26) — Référence Technique

Description factuelle et spécification d'interface des utilitaires de sécurité système, de manipulation de fichiers durcie, de verrouillage distribué et d'impersonation réseau.

- **Fichiers sources :** `src/utils/safeFs.ts`, `src/utils/ResponseFormatEnforcer.ts`, `src/utils/TlsImpersonator.ts`, `src/services/state/LockManager.ts`, `src/plugins/base/dev_tools/PersistentShell.ts`
- **Conteneur IoC :** Modules utilitaires exportés directement, singleton `persistentShell` (`PersistentShell`).
- **Dépendances majeures :** `jsonrepair`, `redis` (`src/services/redisClient.ts`), `node:fs`, `node:https`, `node:child_process`, `node:crypto`.

## 1. Interfaces & Types TypeScript

```typescript
import * as fs from 'node:fs';
import * as https from 'node:https';
import { EventEmitter } from 'events';

export interface EnforceOptions<T> {
  /** Fonction de validation sémantique personnalisée */
  validate?: (parsed: T) => boolean | string;
  /** Nombre maximal de tentatives de réinjection (défaut : 2) */
  maxRetries?: number;
}

export interface EnforceResult<T> {
  success: boolean;
  data?: T;
  rawResponse: string;
  error?: string;
}

export interface ShellExecutionResult {
  stdout: string;
  exitCode: number;
}
```

## 2. Fonctions & Signatures Publiques

### 1. `safeFs.ts` (Isolation et Protection du Système de Fichiers)

#### `resolveWithinRoot(rootPath, childPath, basePath?)`

```typescript
export function resolveWithinRoot(
  rootPath: string,
  childPath: string,
  basePath: string = rootPath,
): string;
```

Résout un chemin cible et vérifie qu'il se trouve strictement sous `rootPath`.

**Paramètres :**

| Paramètre   | Type     | Obligatoire | Description                                                           |
| :---------- | :------- | :---------- | :-------------------------------------------------------------------- |
| `rootPath`  | `string` | Oui         | Répertoire racine limite autorisé (bac à sable).                      |
| `childPath` | `string` | Oui         | Chemin relatif ou absolu demandé.                                     |
| `basePath`  | `string` | Non         | Répertoire de base pour la résolution relative (défaut : `rootPath`). |

**Exceptions :**

- `Error('Path outside allowed root: <childPath>')` : Levée dès lors que le chemin tente de sortir de `rootPath`.

#### Méthodes de Manipulation de Fichiers

| Fonction                 | Signature                                                                                        | Description                                                |
| :----------------------- | :----------------------------------------------------------------------------------------------- | :--------------------------------------------------------- |
| `safeReadFile`           | `(filePath: string, encoding?: BufferEncoding) => Promise<string>`                               | Lecture asynchrone sécurisée de texte.                     |
| `safeReadFileBuffer`     | `(filePath: string) => Promise<Buffer>`                                                          | Lecture asynchrone binaire (pour flux audio/images).       |
| `safeReadFileSync`       | `(filePath: string, encoding?: BufferEncoding) => string`                                        | Lecture synchrone de texte.                                |
| `safeReadFileSyncBuffer` | `(filePath: string) => Buffer`                                                                   | Lecture synchrone binaire.                                 |
| `safeWriteFileSync`      | `(filePath: string, data: string \| Uint8Array, options?: fs.WriteFileOptions) => void`          | Écriture synchrone sur disque.                             |
| `safeWriteFile`          | `(filePath: string, data: string \| Uint8Array, options?: fs.WriteFileOptions) => Promise<void>` | Écriture asynchrone sur disque.                            |
| `safeAppendFile`         | `(filePath: string, data: string \| Uint8Array, options?: fs.WriteFileOptions) => Promise<void>` | Ajout asynchrone en fin de fichier.                        |
| `safeExistsSync`         | `(filePath: string) => boolean`                                                                  | Vérification synchrone d'existence.                        |
| `safeMkdirSync`          | `(filePath: string, options?: fs.MakeDirectoryOptions) => string \| undefined`                   | Création synchrone de répertoire.                          |
| `safeUnlinkSync`         | `(filePath: string) => void`                                                                     | Suppression synchrone de fichier.                          |
| `safeStatSync`           | `(filePath: string) => fs.Stats`                                                                 | Récupération des métadonnées de fichier (`mtimeMs`, etc.). |
| `safeReaddirSync`        | `(filePath: string) => string[]`                                                                 | Liste synchrone des entrées d'un répertoire.               |

---

### 2. `LockManager` (`src/services/state/LockManager.ts`)

Gestionnaire de verrous distribués Redlock sur Redis.

#### Constructeur

```typescript
constructor(resourcePrefix: string, ttlMs: number = 5000)
```

#### Méthode `acquire(key)`

```typescript
public async acquire(key: string): Promise<string | null>
```

Tente d'acquérir le verrou immédiatement (`PX ttl NX`). Retourne le `lockId` unique ou `null` si la ressource est occupée.

#### Méthode `acquireWait(key, maxRetries?)`

```typescript
public async acquireWait(key: string, maxRetries: number = 10): Promise<string | null>
```

Tente d'acquérir le verrou en boucle avec une pause aléatoire entre 50 et 150 ms (_jitter_).

#### Méthode `release(key, lockId)`

```typescript
public async release(key: string, lockId: string): Promise<void>
```

Libère le verrou de manière atomique via un script Lua.

---

### 3. `ResponseFormatEnforcer.ts` (Parsing et Réparation Résiliente)

#### `tryParseJson<T>(content)`

```typescript
export function tryParseJson<T>(content: string): T;
```

Extrait les blocs candidats JSON et applique `jsonrepair` pour parser la structure. Lève une exception si aucun bloc valide n'est présent.

#### `enforceFormat<T>(executeCall, options?)`

```typescript
export async function enforceFormat<T>(
  executeCall: (retryPromptModifier?: string) => Promise<string>,
  options?: EnforceOptions<T>,
): Promise<EnforceResult<T>>;
```

Exécute une fonction d'inférence en boucle avec réinjection corrective en cas de non-conformité JSON.

---

### 4. `TlsImpersonator.ts` (Impersonation d'Empreinte TLS JA3)

#### `getImpersonatedAgent(target?)`

```typescript
export function getImpersonatedAgent(target: 'chromium' | 'go' = 'go'): https.Agent;
```

Retourne un `https.Agent` configuré avec les suites de chiffrement et courbes elliptiques de la cible.

#### `impersonatedRequest(urlStr, options)`

```typescript
export function impersonatedRequest(
  urlStr: string,
  options: { method?: string; headers?: Record<string, string>; body?: string },
): Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
  json: () => Promise<unknown>;
}>;
```

Effectue une requête HTTPS native via l'agent personnalisé.

---

### 5. `PersistentShell` (`src/plugins/base/dev_tools/PersistentShell.ts`)

#### Méthode `execute(command, timeoutMs?)`

```typescript
public async execute(
  command: string,
  timeoutMs: number = 120000
): Promise<ShellExecutionResult>
```

Exécute une commande dans le shell persistant et attend la capture du jeton sentinelle.

#### Méthode `getCwd()`

```typescript
public getCwd(): string
```

Retourne le répertoire de travail actuel conservé par le shell interactif.

#### Méthode `shutdown()`

```typescript
public shutdown(): void
```

Termine le processus bash sous-jacent.

## 3. Codes d'Erreur & Diagnostics

| Exception / Erreur                                       | Contexte                                                                                       | Traitement Système                                                                |
| :------------------------------------------------------- | :--------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------- |
| `Error: Path outside allowed root`                       | Tentative d'accès à un fichier hors du périmètre racine autorisé (`..`).                       | Interruption immédiate de l'opération d'I/O pour prévenir toute fuite de données. |
| `Command timed out after Xms`                            | Une commande shell n'a pas produit de jeton sentinelle dans le délai imparti.                  | Envoi du signal `0x03` (Ctrl+C), purge du buffer et rejet de la promesse.         |
| `Response does not contain a valid JSON object or array` | Impossible de trouver une structure JSON même après tentative de réparation avec `jsonrepair`. | Déclenchement de la boucle de relance `[SYSTEM REJECTION]`.                       |
| `The shell is already executing a command`               | Tentative d'appel concurrent sur une même instance de `PersistentShell`.                       | Rejet de la commande pour garantir l'ordre séquentiel des commandes.              |

## 4. Exemple d'Utilisation Minimal

```typescript
import { resolveWithinRoot, safeWriteFileSync, safeReadFileSync } from '../src/utils/safeFs.js';
import { LockManager } from '../src/services/state/LockManager.js';
import { persistentShell } from '../src/plugins/base/dev_tools/PersistentShell.js';

// 1. Écriture sécurisée protégée contre le path-traversal
const root = process.cwd();
const targetPath = resolveWithinRoot(root, 'Sandbox1/output.log');
safeWriteFileSync(targetPath, 'Initialisation...', 'utf8');

// 2. Acquisition d'un verrou distribué
const locker = new LockManager('file_sync', 3000);
const lockId = await locker.acquire('output.log');
if (lockId) {
  try {
    // Opération protégée
    safeWriteFileSync(targetPath, 'Mise à jour sous verrou.', 'utf8');
  } finally {
    await locker.release('output.log', lockId);
  }
}

// 3. Exécution avec persistance du CWD
const res1 = await persistentShell.execute('cd Sandbox1 && touch test.txt');
console.log('Nouveau CWD :', persistentShell.getCwd());
const res2 = await persistentShell.execute('ls -la');
console.log('Sortie commande :\n', res2.stdout);
```

## 5. Limitations & Invariants Opérationnels

- **Isolation Mono-Processus Shell** : L'instance `persistentShell` est séquentielle ; un seul processus bash interactif est partagé.
- **Dépendance Redis Optionnelle pour LockManager** : En l'absence de client Redis actif, `LockManager` bascule sur le mode dégradé `'no-lock-fallback'` pour permettre l'exécution hors-ligne.
