# Stateful Hash-Anchored Line Editing Engine (SS-23) — Référence Technique

Description factuelle et spécification d'interface du moteur d'édition de code par ancres de hachage déterministes.

- **Fichiers sources :** `src/services/anchor/AnchorStateManager.ts`, `src/services/anchor/lineHashing.ts`, `src/services/anchor/hashDictionary.ts`, `src/plugins/base/dev_tools/FileEditTool.ts`
- **Conteneur IoC :** Instanciation statique autonome (`AnchorStateManager`), outil enregistré dans `PluginLoader` sous le nom `dev_tools_file_edit`.
- **Dépendances majeures :** `diff` (`diffArrays`), `crypto` (`randomInt`), `src/utils/safeFs.ts`, `src/core/security/PermissionManager.ts`.

## 1. Interfaces & Types TypeScript

```typescript
export const ANCHOR_DELIMITER = '§';

export interface TrackedDocument {
  /** Empreintes numériques FNV-1a pour chaque ligne du fichier */
  readonly hashes: Uint32Array;
  /** Liste des mots-ancres associés 1:1 à chaque ligne */
  readonly anchors: readonly string[];
  /** Ensemble des mots actuellement alloués dans ce fichier */
  readonly usedWords: Set<string>;
  /** Réserve de mots mnémoniques disponibles (brassée par Fisher-Yates) */
  availablePool: string[];
}

export interface EditItem {
  /** Type d'opération de mutation */
  edit_type: 'replace' | 'insert_after' | 'insert_before';
  /** Ancre de début (mot seul ou ligne complète préfixée) */
  anchor: string;
  /** Ancre de fin (requise uniquement pour 'replace') */
  end_anchor?: string;
  /** Nouveau contenu textuel à insérer */
  text: string;
}

export interface FileEntry {
  /** Chemin relatif ou absolu du fichier cible */
  path: string;
  /** Liste des opérations d'édition ordonnées à appliquer */
  edits: EditItem[];
}

export interface EditResult {
  /** Indicateur de succès global de la mutation */
  success: boolean;
  /** Nombre d'éditions effectivement appliquées */
  editsApplied: number;
  /** Message d'information ou diagnostic d'erreur */
  message: string;
}

export interface ResolvedEdit {
  type: string;
  startIdx: number;
  endIdx: number;
  text: string;
}
```

## 2. Classes & Signatures de Méthodes

### `AnchorStateManager`

Classe statique singleton gérant le suivi et la réconciliation des ancres avec éviction LRU.

#### Méthode `reconcile(absolutePath, currentLines, taskId?)`

```typescript
public static reconcile(
  absolutePath: string,
  currentLines: readonly string[],
  taskId?: string
): string[]
```

Exécute la réconciliation complète d'un fichier avec son état antérieur.

**Paramètres :**

| Paramètre      | Type                | Obligatoire | Défaut      | Description                                            |
| :------------- | :------------------ | :---------- | :---------- | :----------------------------------------------------- |
| `absolutePath` | `string`            | Oui         | —           | Chemin absolu normalisé du fichier sur disque.         |
| `currentLines` | `readonly string[]` | Oui         | —           | Tableau des lignes du fichier (découpé par `\n`).      |
| `taskId`       | `string`            | Non         | `'default'` | Identifiant de contexte pour l'isolation multi-agents. |

**Valeur de retour :**

- `string[]` : Tableau des mots-ancres garantis uniques, correspondant 1:1 avec `currentLines`.

#### Méthode `getAnchors(absolutePath, taskId?)`

```typescript
public static getAnchors(
  absolutePath: string,
  taskId?: string
): string[] | null
```

Récupère les ancres en mémoire pour un fichier donné.

**Paramètres :**

| Paramètre      | Type     | Obligatoire | Défaut      | Description                          |
| :------------- | :------- | :---------- | :---------- | :----------------------------------- |
| `absolutePath` | `string` | Oui         | —           | Chemin absolu du fichier.            |
| `taskId`       | `string` | Non         | `'default'` | Identifiant de contexte de la tâche. |

**Valeur de retour :**

- `string[] | null` : Tableau des ancres actuelles ou `null` si le fichier n'est pas encore suivi.

#### Méthode `isTracking(absolutePath, taskId?)`

```typescript
public static isTracking(absolutePath: string, taskId?: string): boolean
```

Indique si un fichier possède un état actif dans le cache de la tâche.

#### Méthode `clearState(absolutePath, taskId?)`

```typescript
public static clearState(absolutePath: string, taskId?: string): void
```

Supprime l'entrée de cache associée à un fichier pour une tâche spécifique.

#### Méthode `reset(taskId?)`

```typescript
public static reset(taskId?: string): void
```

Réinitialise toutes les entrées de cache pour une tâche donnée, ou l'intégralité du stockage si `taskId` est omis.

---

### Fonctions Utilitaires (`lineHashing.ts`)

#### `formatLineWithHash(content, anchor)`

```typescript
export function formatLineWithHash(content: string, anchor: string): string;
```

Formate une ligne sous la forme `${anchor}§${content}`.

#### `stripHashes(content)`

```typescript
export function stripHashes(content: string): string;
```

Supprime tous les préfixes d'ancres mnémoniques et le délimiteur `§` d'une chaîne de caractères via l'expression régulière `/\b[A-Z][a-zA-Z]*?§/g`.

#### `extractId(ref)`

```typescript
export function extractId(ref: string): string;
```

Extrait le mot-ancre pur à partir d'une référence textuelle (ex. `'AppleBanana§const x = 1;'` $\to$ `'AppleBanana'`).

#### `splitAnchor(rawAnchor)`

```typescript
export function splitAnchor(rawAnchor: string): { anchor: string; content: string };
```

Découpe une référence brute en ses deux composantes distinctes (`anchor` et `content`).

#### `contentHash(content)`

```typescript
export function contentHash(content: string): string;
```

Calcule le hachage FNV-1a 32-bit et le retourne sous forme d'une chaîne hexadécimale de 8 caractères.

## 3. Schéma de Configuration & Constantes Internes

| Constante           | Type                | Valeur    | Description                                                                     |
| :------------------ | :------------------ | :-------- | :------------------------------------------------------------------------------ |
| `MAX_TRACKED_LINES` | `number`            | `50_000`  | Seuil maximal de lignes par fichier avant basculement en mode dégradé `L1..LN`. |
| `MAX_TRACKED_FILES` | `number`            | `1024`    | Nombre maximal de fichiers conservés dans le cache LRU par tâche.               |
| `MAX_TRACKED_TASKS` | `number`            | `50`      | Nombre maximal de tâches simultanées dans le cache global.                      |
| `ANCHOR_DELIMITER`  | `string`            | `'§'`     | Caractère de séparation entre mot-ancre et code source.                         |
| `ANCHOR_WORDS`      | `readonly string[]` | 500+ mots | Dictionnaire statique de mots en casse Titre (`hashDictionary.ts`).             |

## 4. Codes d'Erreur & États Internes

| Message d'Erreur / Diagnostic                     | Condition de Déclenchement                                                           | Comportement Système                                                  |
| :------------------------------------------------ | :----------------------------------------------------------------------------------- | :-------------------------------------------------------------------- |
| `Anchor not found: "<anchorId>"`                  | Le mot-ancre spécifié dans l'édition n'existe pas dans le document.                  | Rejet de l'opération, invitation à relire le fichier via `read_file`. |
| `End anchor not found: "<endAnchorId>"`           | L'ancre de fin d'un remplacement `replace` est introuvable.                          | Rejet immédiat de l'opération, zéro mutation appliquée.               |
| `end_anchor must be AFTER anchor`                 | L'indice résolu de `end_anchor` est strictement inférieur à `anchor`.                | Rejet de la requête pour incohérence d'intervalle.                    |
| `Overlapping edits detected at lines X-Y and Z-W` | Deux modifications du même lot ciblent des plages de lignes qui se chevauchent.      | Annulation atomique de tout le lot pour prévenir la corruption.       |
| `SECURITY_ERROR: File modified since last read`   | Le fichier sur disque a été altéré par un processus tiers (`mtimeMs` désynchronisé). | Rejet de l'édition pour protéger les modifications externes.          |

## 5. Exemple d'Utilisation Minimal

```typescript
import { AnchorStateManager } from '../src/services/anchor/AnchorStateManager.js';
import { formatLineWithHash, extractId } from '../src/services/anchor/lineHashing.js';

// 1. Découpage du fichier et génération initiale des ancres
const fileContent = 'const a = 1;\nconst b = 2;\nconsole.log(a + b);';
const lines = fileContent.split('\n');
const filePath = '/app/src/index.ts';
const taskId = 'session_worker_1';

const anchors = AnchorStateManager.reconcile(filePath, lines, taskId);
const annotatedLines = lines.map((line, idx) => formatLineWithHash(line, anchors[idx]!));

console.log('Lignes annotées :\n', annotatedLines.join('\n'));
// Ex:
// Castle§const a = 1;
// Falcon§const b = 2;
// River§console.log(a + b);

// 2. Extraction d'identifiant et vérification
const targetRef = annotatedLines[1]!; // "Falcon§const b = 2;"
const anchorWord = extractId(targetRef); // "Falcon"
console.log('Ancre extraite :', anchorWord);
```

## 6. Limitations & Invariants Opérationnels

- **Concurrence & Thread-Safety** : Conçu pour l'environnement asynchrone monothreadé Node.js. Les mutations en mémoire sont synchrones au sein d'un tour de boucle d'événements.
- **Complexité Temporelle** :
  - Calcul de hachage : $O(N)$ où $N$ est le nombre de caractères total.
  - Réconciliation sans modification (cache hit) : $O(L)$ où $L$ est le nombre de lignes (comparaison rapide d'entiers `Uint32Array`).
  - Réconciliation avec modifications : $O(L \cdot D)$ via Myers Diff, où $D$ est la distance d'édition.
- **Complexité Spatiale** : Tableau compact `Uint32Array` consommant 4 octets par ligne, plus les références de chaînes pour les ancres actives.
- **Plafond de Résilience** : Au-delà de 50 000 lignes, le système se désactive sans planter, préservant la mémoire de l'hôte.
