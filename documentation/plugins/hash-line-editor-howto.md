# Comment Intégrer et Utiliser le Moteur d'Édition par Ancres Hash (SS-23)

Ce guide pratique détaille la procédure pas-à-pas pour annoter un fichier source avec des ancres de hachage déterministes, soumettre des modifications ciblées sans dérive d'indices et valider les mutations dans une suite de tests unitaires.

## Prérequis

- Node.js >= 22 (ESM natif) et TypeScript configuré.
- Dépendance `diff` installée (`npm install diff @types/diff`).
- Wrappers du système de fichiers `src/utils/safeFs.ts` accessibles.

## Étapes de Réalisation

### 1. Annoter le Fichier Source avec des Mots-Ancres Déterministes

Importez `AnchorStateManager` et `formatLineWithHash`. Lisez le fichier cible et générez la liste des lignes préfixées pour l'agent LLM.

```typescript
import { safeReadFileSync } from '../src/utils/safeFs.js';
import { AnchorStateManager } from '../src/services/anchor/AnchorStateManager.js';
import { formatLineWithHash } from '../src/services/anchor/lineHashing.js';

export function getAnnotatedSource(filePath: string, taskId = 'default'): string {
  const rawContent = safeReadFileSync(filePath, 'utf8');
  const lines = rawContent.split('\n');

  // Réconciliation et génération des mots-ancres
  const anchors = AnchorStateManager.reconcile(filePath, lines, taskId);

  // Construction de la vue annotée avec délimiteur §
  return lines.map((line, index) => formatLineWithHash(line, anchors[index]!)).join('\n');
}
```

### 2. Formater et Soumettre une Requête de Mutation par Ancres

Construisez la structure de mutation conforme à `FileEditTool` en référençant les ancres retournées à l'étape 1.

```typescript
import type { FileEntry } from '../src/plugins/base/dev_tools/FileEditTool.js';

export function buildEditPayload(filePath: string): FileEntry {
  return {
    path: filePath,
    edits: [
      {
        edit_type: 'replace',
        anchor: 'Castle§  const timeout = 1000;',
        end_anchor: 'Castle§  const timeout = 1000;',
        text: '  const timeout = 5000;\n  const maxRetries = 3;',
      },
      {
        edit_type: 'insert_after',
        anchor: 'Falcon§  return result;',
        text: '  console.log("Operation finished");',
      },
    ],
  };
}
```

### 3. Exécuter l'Édition et Réconcilier le Cache

Invoquez le plugin `FileEditTool` ou appliquez la réconciliation directement via `AnchorStateManager`.

```typescript
import { pluginLoader } from '../src/plugins/loader.js';

export async function applyFileEdits(editPayload: FileEntry, chatId: string) {
  const result = await pluginLoader.execute(
    'edit_file',
    { files: [editPayload] },
    { chatId, sourceChannel: 'cli' },
  );

  if (!result.success) {
    throw new Error(`Échec de l'édition : ${result.message}`);
  }

  return result;
}
```

## Cas Particuliers & Variantes

### Variante A : Éditions Multi-Fichiers Atomiques Groupées

Lorsque plusieurs fichiers doivent être modifiés conjointement, regroupez-les dans le tableau `files` :

```typescript
const multiFilePayload = {
  files: [
    {
      path: 'src/config.ts',
      edits: [
        {
          edit_type: 'replace',
          anchor: 'Alpha§PORT = 8080',
          end_anchor: 'Alpha§PORT = 8080',
          text: 'PORT = 9090',
        },
      ],
    },
    {
      path: 'src/server.ts',
      edits: [
        {
          edit_type: 'insert_before',
          anchor: 'Beta§server.listen(PORT)',
          text: 'logger.info("Starting server...");',
        },
      ],
    },
  ],
};
await pluginLoader.execute('edit_file', multiFilePayload, { chatId: 'admin_session' });
```

### Variante B : Nettoyage Manuel du Cache lors d'une Suppression de Fichier

Lorsqu'un fichier est supprimé du disque par l'agent, libérez immédiatement sa mémoire :

```typescript
AnchorStateManager.clearState('/path/to/deleted_file.ts', 'session_task_id');
```

## Vérification & Validation

Exécutez la suite de tests unitaires dédiée pour valider l'intégrité de la réconciliation d'ancres et le comportement face aux diffs :

```bash
npx jest src/tests/unit/services/anchor/AnchorStateManager.test.ts --runInBand
```

Résultat attendu dans le terminal :

```text
PASS src/tests/unit/services/anchor/AnchorStateManager.test.ts
  AnchorStateManager (SS-23: Hash-Anchored Edit)
    Réconciliation Initiale
      ✓ génère des ancres uniques et stables pour toutes les lignes (4 ms)
      ✓ retourne les ancres en cache si le contenu des lignes est identique (1 ms)
    Stabilité des Ancres à travers les Diff
      ✓ préserve les ancres des lignes inchangées lors d insertions et modifications (3 ms)
      ✓ gère la suppression de lignes en préservant le contexte environnant (2 ms)
    Cas Limites & Isolation Multi-Tâches
      ✓ bascule en mode repli L1, L2 si le fichier dépasse MAX_TRACKED_LINES (50 000) (15 ms)
      ✓ fournit getAnchors et clearState par fichier (2 ms)
      ✓ isole strictement l état par taskId (2 ms)

Test Suites: 1 passed, 1 total
Tests:       7 passed, 7 total
Snapshots:   0 total
Time:        0.824 s
```

## Guide de Dépannage (Troubleshooting)

| Symptôme / Message d'Erreur                     | Cause Probable                                                                          | Solution Immédiate                                                                                               |
| :---------------------------------------------- | :-------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------- |
| `Anchor not found: "X"`                         | Le fichier a été modifié sur disque ou l'ancre n'a jamais été générée pour ce `taskId`. | Relire le fichier avec `read_file` ou appeler `AnchorStateManager.reconcile()` pour régénérer la table d'ancres. |
| `Overlapping edits detected`                    | Deux opérations de modification dans le même lot ciblent des plages qui se croisent.    | Scinder les modifications en plusieurs appels séquentiels ou fusionner les deux blocs en un seul `replace`.      |
| `SECURITY_ERROR: File modified since last read` | L'horodatage `mtimeMs` du fichier a changé depuis la dernière lecture enregistrée.      | Réexécuter `read_file` pour synchroniser le cache de sécurité `fileState` avant d'appliquer les mutations.       |
