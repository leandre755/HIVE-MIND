# PermissionManager — Référence Technique

Le module `PermissionManager` est le contrôleur de sécurité pré-action, d'isolation du système de fichiers et de gestion des approbations humaines (*Human-In-The-Loop* - HITL) de HIVE-MIND.

- **Fichier source :** `src/core/security/PermissionManager.ts`
- **Dépendances :** `path`, `src/utils/safeFs.ts`, `src/core/transport/TransportManager.ts`, `src/services/adminService.ts`
- **Instance exportée :** `permissionManager` (singleton)

## 1. Interfaces & Constantes de Sécurité

```typescript
export const BANNED_COMMANDS = ['su', 'sudo'];

export const SAFE_COMMANDS = new Set([
  'git status',
  'git diff',
  'git log',
  'git branch',
  'pwd',
  'tree',
  'date',
  'which',
  'ls',
  'echo',
  'cat',
  'node --version',
  'npm --version',
]);

export interface PermissionResult {
  readonly granted: boolean;
  readonly feedback?: string;
}
```

## 2. Classes & Signatures de Méthodes

### `PermissionManager`

#### Propriétés Publiques
```typescript
public sandboxDir: string;  // Chemin absolu vers Sandbox1/
public storageDir: string;  // Chemin absolu vers storage_hm/
```

#### Constructeur
```typescript
constructor()
```
Initialise les répertoires physiques `Sandbox1/` et `storage_hm/` s'ils n'existent pas, et charge les variables d'environnement de sécurité.

---

#### Méthode `isInSandbox(targetPath, currentCwd)`
```typescript
public isInSandbox(targetPath: string, currentCwd?: string): boolean
```

Vérifie si un chemin cible résolu (en tenant compte des liens symboliques et des chemins relatifs) se situe strictement à l'intérieur de `Sandbox1/` ou `storage_hm/`.

**Paramètres :**
| Paramètre | Type | Obligatoire | Défaut | Description |
| :--- | :--- | :--- | :--- | :--- |
| `targetPath` | `string` | Oui | — | Chemin du fichier cible. |
| `currentCwd` | `string` | Non | `process.cwd()` | Répertoire de travail actif. |

**Valeur de retour :**
- `boolean` : `true` si le chemin est sécurisé dans le bac à sable, sinon `false`.

---

#### Méthode `validateBashCommand(command, currentCwd)`
```typescript
public validateBashCommand(
  command: string,
  currentCwd?: string
): {
  result: boolean;
  requiresPermission: boolean;
  reason?: string;
}
```

Analyse statiquement une commande shell pour déterminer si elle est bannie, sûre ou si elle requiert une autorisation humaine HITL.

**Paramètres :**
| Paramètre | Type | Obligatoire | Défaut | Description |
| :--- | :--- | :--- | :--- | :--- |
| `command` | `string` | Oui | — | Commande shell complète à exécuter. |
| `currentCwd` | `string` | Non | `process.cwd()` | Répertoire d'exécution prévu. |

**Valeur de retour :**
- `{ result: boolean; requiresPermission: boolean; reason?: string }` : Décision de conformité.

---

#### Méthode `validateFileWrite(filePath, currentCwd)`
```typescript
public validateFileWrite(
  filePath: string,
  currentCwd?: string
): {
  result: boolean;
  requiresPermission: boolean;
  reason?: string;
}
```

Vérifie si une opération d'écriture de fichier est autorisée dans les dossiers sanctuarisés.

**Paramètres :**
| Paramètre | Type | Obligatoire | Défaut | Description |
| :--- | :--- | :--- | :--- | :--- |
| `filePath` | `string` | Oui | — | Chemin du fichier à créer ou modifier. |
| `currentCwd` | `string` | Non | `process.cwd()` | Répertoire de travail courant. |

**Valeur de retour :**
- `{ result: boolean; requiresPermission: boolean; reason?: string }` : Résultat de la validation.

---

#### Méthode `askPermission(chatId, actionDescription, sourceChannel, senderJid)`
```typescript
public async askPermission(
  chatId: string,
  actionDescription: string,
  sourceChannel?: string,
  senderJid?: string
): Promise<PermissionResult>
```

Déclenche le protocole HITL à 3 voies (Local TUI $\rightarrow$ Admin Hub $\rightarrow$ In-Band) et attend la réponse humaine avec un disjoncteur temporel de 10 minutes (*Fail-Closed*).

**Paramètres :**
| Paramètre | Type | Obligatoire | Défaut | Description |
| :--- | :--- | :--- | :--- | :--- |
| `chatId` | `string` | Oui | — | Identifiant du canal de provenance. |
| `actionDescription` | `string` | Oui | — | Description claire de l'action sensible requérant validation. |
| `sourceChannel` | `string` | Non | `'whatsapp'` | Canal de communication (`'whatsapp'`, `'discord'`, etc.). |
| `senderJid` | `string` | Non | `chatId` | Identifiant de l'utilisateur ayant initié la requête. |

**Valeur de retour :**
- `Promise<PermissionResult>` : `{ granted: boolean, feedback?: string }`.

---

#### Méthodes de Réponse d'Approbation

##### `handleAdminCommand(text)`
```typescript
public handleAdminCommand(text: string): boolean
```
Traite les commandes `.approve <id>` ou `.reject <id> [feedback]` reçues sur le canal administrateur. Retourne `true` si la commande correspondait à une requête en attente.

##### `handleUserResponse(text)`
```typescript
public handleUserResponse(text: string): boolean
```
Traite les réponses conversationnelles en langage naturel dans le fil de discussion actif.

## 3. Variables d'Environnement

| Variable d'Environnement | Type | Défaut | Description |
| :--- | :--- | :--- | :--- |
| `SANDBOX_DIR` | `string` | `./Sandbox1` | Chemin absolu ou relatif vers le dossier de travail volatile. |
| `STORAGE_DIR` | `string` | `./storage_hm` | Chemin absolu ou relatif vers le dossier de stockage persistant. |
| `SECURITY_HUB_ID` | `string` | `""` | Identifiant du groupe de sécurité d'administration (Logique 1). |
| `SECURITY_TRANSPORT` | `string` | `"whatsapp"` | Transport utilisé pour notifier le hub d'administration. |

## 4. Exemple d'Utilisation Minimal

```typescript
import { permissionManager } from '../../src/core/security/PermissionManager.js';

// 1. Validation de chemin
const isSafe = permissionManager.isInSandbox('Sandbox1/output.txt');
console.log('Chemin autorisé:', isSafe); // true

// 2. Validation de commande
const check = permissionManager.validateBashCommand('npm test');
console.log('Autorisé:', check.result, 'HITL requis:', check.requiresPermission);

// 3. Demande d'autorisation humaine
const decision = await permissionManager.askPermission(
  'chat_user_1',
  'Exécution de la commande sensible : npm run build',
  'whatsapp'
);

if (decision.granted) {
  console.log('[Security] Action autorisée par l’administrateur.');
} else {
  console.log('[Security] Action refusée. Motif :', decision.feedback);
}
```

## 5. Limitations & Invariants Opérationnels

- **Principe Fail-Closed :** Tout timeout (10 min) ou échec de communication réseau avec l'administrateur entraîne un refus automatique (`granted: false`).
- **Résolution Canonique :** Neutralisation systématique des attaques par symlinks et chemins relatifs grâce à `safeRealPathSync`.
