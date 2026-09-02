# Comment Valider des Actions Sensibles et Gérer l'Approbation HITL avec PermissionManager

Ce guide pratique décrit comment sécuriser les opérations sur les fichiers, intercepter les commandes système potentiellement dangereuses et solliciter une validation humaine (*Human-In-The-Loop* - HITL) avant toute exécution critique.

## Prérequis
- Node.js >= 22 (ESM natif) et TypeScript configuré.
- Dépendances du projet installées (`npm install`).
- Répertoires `Sandbox1/` et `storage_hm/` configurés.

## Étapes de Réalisation

### 1. Importer `permissionManager`

Dans votre outil de manipulation de fichiers ou d'exécution de commandes shell :

```typescript
import { permissionManager } from '../../src/core/security/PermissionManager.js';
```

### 2. Valider les chemins d'écriture de fichiers

Avant d'écrire ou de modifier un fichier, vérifiez qu'il se situe à l'intérieur du bac à sable autorisé :

```typescript
function writeSafeFile(targetPath: string, content: string): void {
  const check = permissionManager.validateFileWrite(targetPath);

  if (!check.result) {
    throw new Error(`[Security] Écriture interdite en dehors du bac à sable : ${check.reason}`);
  }

  // Écriture sécurisée dans Sandbox1/ ou storage_hm/
  console.log(`[SafeFs] Écriture autorisée dans ${targetPath}`);
}
```

### 3. Intercepter et valider les commandes shell

Avant de lancer un processus enfant (`child_process.spawn`) :

```typescript
async function executeBashSafe(chatId: string, command: string): Promise<string> {
  // 1. Validation statique
  const validation = permissionManager.validateBashCommand(command);

  if (!validation.result) {
    throw new Error(`[Security] Commande formellement interdite : ${validation.reason}`);
  }

  // 2. Si la commande requiert une approbation humaine (HITL)
  if (validation.requiresPermission) {
    console.log(`[HITL] Demande d'autorisation pour la commande : ${command}`);
    
    const decision = await permissionManager.askPermission(
      chatId,
      `Exécution de la commande shell : \`${command}\``
    );

    if (!decision.granted) {
      const feedback = decision.feedback ? ` (Conseil : ${decision.feedback})` : '';
      throw new Error(`[Security] Action rejetée par l'administrateur${feedback}`);
    }
  }

  // 3. Exécution de la commande après validation
  return `Commande "${command}" exécutée avec succès.`;
}
```

### 4. Traiter les réponses administratives dans les passerelles de transport

Lorsque le bot reçoit un message sur le canal de transport :

```typescript
function onMessageReceived(text: string): boolean {
  // Tente de résoudre une commande .approve ou .reject
  const handledByAdmin = permissionManager.handleAdminCommand(text);
  if (handledByAdmin) {
    console.log('[Security] Commande administrative traitée.');
    return true;
  }

  // Tente de résoudre une confirmation textuelle utilisateur
  return permissionManager.handleUserResponse(text);
}
```

## Cas Particuliers & Variantes

### Variante A : Configuration personnalisée des répertoires de stockage

Vous pouvez spécifier des chemins de sanctuarisation personnalisés via variables d'environnement :

```bash
export SANDBOX_DIR="/opt/hive_sandbox"
export STORAGE_DIR="/var/data/hive_storage"
export SECURITY_HUB_ID="12036304@g.us"
```

## Vérification & Validation

Exécutez la suite de tests unitaires dédiée au `PermissionManager` :

```bash
npx jest src/tests/unit/core/permissionManager.test.ts --runInBand
```

Résultat attendu dans le terminal :
```text
PASS src/tests/unit/core/permissionManager.test.ts
  PermissionManager
    ✓ should allow writes inside Sandbox1 and storage_hm (15 ms)
    ✓ should block path traversal and symlink escapes (22 ms)
    ✓ should ban sudo and inline code execution flags (10 ms)
    ✓ should fail closed on HITL timeout (18 ms)

Test Suites: 1 passed, 1 total
Tests:       4 passed, 4 total
Snapshots:   0 total
Time:        1.250 s
```

## Guide de Dépannage (Troubleshooting)

| Symptôme / Message d'Erreur | Cause Probable | Solution Immédiate |
| :--- | :--- | :--- |
| `[Security] Écriture interdite en dehors du bac à sable` | Le chemin spécifié se situe en dehors de `Sandbox1/` ou `storage_hm/`. | Utiliser un chemin relatif préfixé par `Sandbox1/` ou `storage_hm/`. |
| La demande `askPermission()` expire systématiquement au bout de 10 minutes | Aucun administrateur n'a répondu via `.approve <id>` ou le canal d'administration `SECURITY_HUB_ID` est mal configuré. | Répondre dans le délai imparti ou vérifier la configuration du groupe d'administration. |
| `[Security] Commande formellement interdite : Banned command: sudo` | Tentative d'utilisation d'une commande d'élévation de privilèges (`su`, `sudo`). | Retirer `sudo` ; les processus doivent s'exécuter avec les privilèges utilisateur normaux de l'hôte. |
