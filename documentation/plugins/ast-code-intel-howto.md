# Comment Exploiter l'Analyseur AST et le Serveur LSP Embarqué (SS-24)

Ce guide pratique détaille comment extraire des squelettes structurels de code source, cibler des fonctions par leur nom qualifié et effectuer des requêtes sémantiques de type LSP avec validation par tests unitaires.

## Prérequis

- Node.js >= 22 (ESM natif) et TypeScript configuré.
- Dépendances `web-tree-sitter` et `tree-sitter-wasms` installées (`npm install`).
- Fichiers WASM accessibles dans `node_modules/tree-sitter-wasms/out/`.

## Étapes de Réalisation

### 1. Extraire le Squelette d'un Fichier pour Économiser les Jetons

Utilisez `getFileSkeleton` avant toute lecture complète de fichier afin de donner au modèle de langage une cartographie compacte du module sans son implémentation.

```typescript
import { resolveWithinRoot } from '../src/utils/safeFs.js';
import { getFileSkeleton } from '../src/services/ast/TreeSitterService.js';

export async function inspectFileStructure(relativeFilePath: string): Promise<string> {
  const rootDir = process.cwd();
  const absolutePath = resolveWithinRoot(rootDir, relativeFilePath);

  const skeleton = await getFileSkeleton(absolutePath);
  if (!skeleton) {
    throw new Error(`Impossible d'extraire le squelette pour : ${relativeFilePath}`);
  }

  return skeleton;
}
```

### 2. Isoler et Extraire Chirurgicalement une Fonction

Extrayez uniquement le code d'une méthode spécifique pour cibler précisément la modification ou l'analyse sans charger le reste du fichier.

```typescript
import { getFunction } from '../src/services/ast/TreeSitterService.js';
import { hashLines } from '../src/services/anchor/index.js';

export async function fetchFunctionCode(absolutePath: string, qualifiedName: string) {
  // qualifiedName peut être "myFunction" ou "ClassName.methodName"
  const funcData = await getFunction(absolutePath, qualifiedName);
  if (!funcData) {
    return null;
  }

  // Optionnel : formater les lignes avec les ancres pour édition immédiate
  const hashedContent = hashLines(absolutePath, funcData.content);
  return {
    startLine: funcData.startLine,
    endLine: funcData.endLine,
    code: hashedContent,
  };
}
```

### 3. Effectuer des Requêtes LSP (Aller à la Définition & Trouver les Références)

Invoquez le plugin `LSPTool` pour naviguer sémantiquement dans le projet.

```typescript
import { pluginLoader } from '../src/plugins/loader.js';

export async function executeLspLookup(filePath: string, symbolName: string) {
  // 1. Recherche de la définition
  const defResult = await pluginLoader.execute(
    'lsp_query',
    {
      operation: 'goToDefinition',
      file_path: filePath,
      symbol_name: symbolName,
    },
    { chatId: 'dev_session' },
  );

  // 2. Recherche de toutes les références
  const refsResult = await pluginLoader.execute(
    'lsp_query',
    {
      operation: 'findReferences',
      file_path: filePath,
      symbol_name: symbolName,
    },
    { chatId: 'dev_session' },
  );

  return {
    definition: defResult.message,
    references: refsResult.message,
  };
}
```

## Cas Particuliers & Variantes

### Variante A : Inspection Complète des Symboles d'un Document (`documentSymbol`)

Pour obtenir le catalogue hiérarchique de toutes les fonctions, classes, interfaces et types déclarés dans un fichier :

```typescript
const result = await pluginLoader.execute(
  'lsp_query',
  {
    operation: 'documentSymbol',
    file_path: 'src/services/ast/TreeSitterService.ts',
  },
  { chatId: 'audit_session' },
);
console.log(result.message);
```

### Variante B : Exécution en Mode Repli Regex

Si votre environnement ne dispose pas de support WebAssembly ou si les fichiers WASM sont absents, le service bascule automatiquement sur `parseDefinitionsRegexFallback` sans aucune modification de votre code d'appel.

## Vérification & Validation

Exécutez la suite de tests unitaires ciblant les fonctionnalités LSP et l'analyse AST :

```bash
npx jest src/tests/unit/plugins/LSPTool.test.ts --runInBand
```

Résultat attendu dans le terminal :

```text
PASS src/tests/unit/plugins/LSPTool.test.ts
  LSPTool (SS-24: AST Code Intelligence & LSP)
    Opérations de base
      ✓ documentSymbol extrait correctement les symboles définis (8 ms)
      ✓ goToDefinition résout la définition locale d'une classe ou fonction (6 ms)
      ✓ findReferences localise les usages du symbole dans les chemins cibles (12 ms)
      ✓ hover retourne la signature et les métadonnées de ligne (5 ms)
    Gestion des erreurs & cas limites
      ✓ gère gracieusement les symboles introuvables sans lever d'exception (3 ms)
      ✓ rejette les requêtes avec paramètres obligatoires manquants (2 ms)

Test Suites: 1 passed, 1 total
Tests:       6 passed, 6 total
Snapshots:   0 total
Time:        1.120 s
```

## Guide de Dépannage (Troubleshooting)

| Symptôme / Message d'Erreur              | Cause Probable                                                                        | Solution Immédiate                                                                                                      |
| :--------------------------------------- | :------------------------------------------------------------------------------------ | :---------------------------------------------------------------------------------------------------------------------- |
| `[AST] WASM non trouvé pour: typescript` | Les binaires WASM sont absents du dossier `node_modules/tree-sitter-wasms/out`.       | Vérifier l'installation du package ou laisser le repli Regex traiter la requête de manière transparente.                |
| `Function "X" not found in file`         | Le nom qualifié de la méthode ne correspond pas exactement à la signature dans l'AST. | Exécuter `get_file_skeleton` ou `documentSymbol` au préalable pour vérifier l'arborescence exacte (`ClassName.method`). |
| `Unsupported language: .xyz`             | L'extension du fichier cible n'est pas répertoriée dans `LANGUAGE_MAP`.               | Vérifier que le fichier est en TypeScript (`.ts`, `.tsx`), JavaScript (`.js`, `.jsx`) ou Python (`.py`).                |
