# AST Code Intelligence & Embedded LSP Subsystem (SS-24) — Référence Technique

Description factuelle et spécification d'interface du moteur d'analyse de code par arbre syntaxique abstrait (AST) et serveur LSP embarqué.

- **Fichiers sources :** `src/services/ast/TreeSitterService.ts`, `src/services/ast/queries.ts`, `src/plugins/base/dev_tools/ASTTools.ts`, `src/plugins/base/dev_tools/LSPTool.ts`
- **Conteneur IoC :** Fonctions modulaires exportées (`TreeSitterService`), outils enregistrés dans `PluginLoader` sous `dev_tools_ast` et `dev_tools_lsp`.
- **Dépendances majeures :** `web-tree-sitter`, `tree-sitter-wasms`, `src/utils/safeFs.ts`, `src/services/anchor/lineHashing.ts`.

## 1. Interfaces & Types TypeScript

```typescript
export interface SymbolDefinition {
  /** Nom du symbole (ex. "processData", "UserService") */
  name: string;
  /** Catégorie du symbole ('function' | 'method' | 'class' | 'interface' | 'enum' | 'type') */
  kind: string;
  /** Nom du symbole parent pour les méthodes imbriquées (ex. "UserService") */
  parent?: string;
  /** Ligne de début (index 0) dans le fichier */
  startLine: number;
  /** Ligne de fin (index 0) dans le fichier */
  endLine: number;
  /** Nombre total de lignes occupées par la définition */
  lineCount: number;
  /** Texte exact de la ligne de signature */
  signatureLine: string;
  /** Indentation d'origine de la définition */
  indentation: string;
}

export interface SymbolReference {
  /** Nom du symbole recherché */
  name: string;
  /** Chemin absolu du fichier contenant l'occurrence */
  filePath: string;
  /** Numéro de ligne (index 0) */
  line: number;
  /** Contenu textuel de la ligne contenant l'occurrence */
  lineText: string;
  /** Indique s'il s'agit d'une définition (true) ou d'une utilisation (false) */
  isDefinition: boolean;
}

export type SymbolFindType = 'definition' | 'reference' | 'both';

export interface LspQueryArgs {
  operation?: 'goToDefinition' | 'findReferences' | 'hover' | 'documentSymbol';
  file_path?: string;
  symbol_name?: string;
  search_paths?: string[];
}
```

## 2. Fonctions & Signatures Publiques (`TreeSitterService.ts`)

#### `parseDefinitions(absolutePath)`

```typescript
export async function parseDefinitions(absolutePath: string): Promise<SymbolDefinition[] | null>;
```

Parse un fichier source via Tree-Sitter WASM et extrait la liste ordonnée des définitions de symboles.

**Paramètres :**

| Paramètre      | Type     | Obligatoire | Défaut | Description                                 |
| :------------- | :------- | :---------- | :----- | :------------------------------------------ |
| `absolutePath` | `string` | Oui         | —      | Chemin absolu du fichier source à analyser. |

**Valeur de retour :**

- `Promise<SymbolDefinition[] | null>` : Liste des symboles détectés, ou `null` si le langage n'est pas supporté ou en cas de fichier introuvable.

---

#### `getFileSkeleton(absolutePath)`

```typescript
export async function getFileSkeleton(absolutePath: string): Promise<string | null>;
```

Génère une vue compacte du fichier source listant les signatures sans les corps de fonctions.

**Valeur de retour :**

- `Promise<string | null>` : Chaîne formatée représentant le squelette du fichier avec le nombre de lignes masquées entre parenthèses, ou `null`.

---

#### `getFunction(absolutePath, functionName)`

```typescript
export async function getFunction(
  absolutePath: string,
  functionName: string,
): Promise<{ content: string; startLine: number; endLine: number } | null>;
```

Extrait chirurgicalement le code source complet d'une fonction ou méthode donnée.

**Paramètres :**

| Paramètre      | Type     | Obligatoire | Défaut | Description                                                         |
| :------------- | :------- | :---------- | :----- | :------------------------------------------------------------------ |
| `absolutePath` | `string` | Oui         | —      | Chemin absolu du fichier source.                                    |
| `functionName` | `string` | Oui         | —      | Nom simple (`"myFunction"`) ou qualifié (`"ClassName.methodName"`). |

**Valeur de retour :**

- `Promise<{ content: string; startLine: number; endLine: number } | null>` : Objet contenant le contenu textuel extrait et les indices de lignes, ou `null` si non trouvé.

---

#### `findSymbolReferences(filePaths, symbolName, findType?)`

```typescript
export async function findSymbolReferences(
  filePaths: string[],
  symbolName: string,
  findType: SymbolFindType = 'both',
): Promise<SymbolReference[]>;
```

Recherche toutes les occurrences (définitions, usages ou les deux) d'un symbole à travers un ensemble de fichiers.

## 3. Outils Agentiques Exposés

### 1. `dev_tools_ast` (`ASTTools.ts`)

| Nom d'Outil              | Paramètres Requis                                                                                | Description                                                                                 |
| :----------------------- | :----------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------ |
| `get_file_skeleton`      | `paths: string[]`                                                                                | Extrait le squelette structurel d'un ou plusieurs fichiers (~90% d'économie de jetons).     |
| `get_function`           | `file_path: string`, `function_name: string`                                                     | Extrait le corps complet d'une fonction ciblée annoté avec ses mots-ancres.                 |
| `find_symbol_references` | `symbol_name: string`, `search_paths: string[]`, `find_type?: 'definition'\|'reference'\|'both'` | Localise les déclarations et références d'un symbole via l'AST sans faux positifs textuels. |

### 2. `dev_tools_lsp` (`LSPTool.ts`)

| Nom d'Outil | Opérations Supportées                                         | Description                                                     |
| :---------- | :------------------------------------------------------------ | :-------------------------------------------------------------- |
| `lsp_query` | `goToDefinition`, `findReferences`, `hover`, `documentSymbol` | Point d'accès unifié pour les requêtes sémantiques de type IDE. |

## 4. Schéma de Configuration & Cartographie des Langages (`LANGUAGE_MAP`)

| Extension | Nom Langage Tree-Sitter | Fichier Binaire WASM Associé  | Motifs de Capture S-Expression                                                               |
| :-------- | :---------------------- | :---------------------------- | :------------------------------------------------------------------------------------------- |
| `.ts`     | `typescript`            | `tree-sitter-typescript.wasm` | `typescriptQuery` (fonctions, méthodes, classes, interfaces, enums, types, arrow functions)  |
| `.tsx`    | `tsx`                   | `tree-sitter-typescript.wasm` | `typescriptQuery` (support complet JSX/TSX)                                                  |
| `.js`     | `javascript`            | `tree-sitter-javascript.wasm` | `javascriptQuery` (fonctions, méthodes, générateurs, classes ES6, déclarations de variables) |
| `.jsx`    | `javascript`            | `tree-sitter-javascript.wasm` | `javascriptQuery` (support JSX standard)                                                     |
| `.py`     | `python`                | `tree-sitter-python.wasm`     | `pythonQuery` (classes, méthodes, fonctions de premier niveau, fonctions décorées)           |

## 5. Codes d'Erreur & Diagnostics

| Message d'Erreur                                    | Condition Déclenchante                                                                  | Traitement Système                                                                        |
| :-------------------------------------------------- | :-------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------- |
| `[AST] WASM non trouvé pour: <lang>`                | Le binaire `.wasm` correspondant est introuvable dans `node_modules/tree-sitter-wasms`. | Journalisation d'un avertissement et basculement immédiat vers le parseur de repli regex. |
| `Unsupported language: .<ext>`                      | L'extension du fichier demandé n'est pas déclarée dans `LANGUAGE_MAP`.                  | Retour d'un résultat d'échec propre avec la liste des extensions supportées.              |
| `Function "<name>" not found in <file>`             | Le symbole demandé n'existe pas dans le fichier analysé.                                | Retour d'un message conseillant l'usage préalable de `get_file_skeleton`.                 |
| `Access denied: path is outside authorized sandbox` | Le chemin ciblé sort du répertoire sandbox autorisé.                                    | Levée d'une exception de sécurité via `PermissionManager`.                                |

## 6. Exemple d'Utilisation Minimal

```typescript
import { getFileSkeleton, getFunction, findSymbolReferences } from '../src/services/ast/index.js';

const filePath = '/app/src/services/auth.ts';

// 1. Extraction du squelette structurel
const skeleton = await getFileSkeleton(filePath);
console.log('Squelette du fichier :\n', skeleton);
// Ex:
// export class AuthService
//   constructor(config: AuthConfig) (5 lines)
//   public async login(user: string, pass: string): Promise<Session> (24 lines)
//   private validateToken(token: string): boolean (12 lines)

// 2. Extraction ciblée d'une méthode
const funcData = await getFunction(filePath, 'AuthService.login');
if (funcData) {
  console.log(`Lignes ${funcData.startLine + 1} à ${funcData.endLine + 1} :`);
  console.log(funcData.content);
}

// 3. Recherche des références
const references = await findSymbolReferences(['/app/src/services/auth.ts'], 'AuthService', 'both');
console.log(`Trouvé ${references.length} occurrences.`);
```

## 7. Limitations & Invariants Opérationnels

- **Bornage de l'Arborescence** : La recherche de fichiers pour les références récursives est limitée à une profondeur maximale de 3 répertoires (`-maxdepth 3`) et 100 fichiers analysés pour prévenir la saturation CPU.
- **Support des Langages** : Orienté nativement vers TypeScript, JavaScript et Python. Les langages non déclarés dans `LANGUAGE_MAP` sont ignorés de façon sécurisée.
- **Gestion Mémoire** : Les grammaires WASM résident en mémoire après leur premier chargement. L'empreinte mémoire totale pour les 3 grammaires standard est inférieure à 15 Mo.
