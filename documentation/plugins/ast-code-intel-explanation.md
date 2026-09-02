# AST Code Intelligence & Embedded LSP Subsystem (SS-24) — Architecture & Principes de Fonctionnement

Le sous-système **AST Code Intelligence & Embedded LSP** confère à HIVE-MIND une compréhension structurelle et sémantique profonde du code source, réduisant de 80% à 95% la consommation de jetons de contexte par rapport à la lecture brute de fichiers.

## 1. Contexte & Problématique d'Ingénierie

Dans les architectures d'agents logiciels autonomes, la consultation naïve de fichiers entiers via des commandes de type `read_file` engendre deux écueils structurels majeurs :

1. **Saturation rapide de la fenêtre de contexte** : L'injection de fichiers complets (souvent de 500 à 3 000 lignes) pour ne modifier ou inspecter qu'une seule fonction de 20 lignes consomme inutilement des milliers de jetons, accélère l'atteinte des plafonds d'attention et augmente drastiquement le coût d'inférence.
2. **Ambiguïté et faux positifs de navigation** : L'utilisation de recherche textuelle brute (`grep` ou expressions régulières) pour localiser des définitions de classes, méthodes ou références de symboles produit de nombreux faux positifs dans les commentaires, les chaînes littérales et les variables locales homonymes.

Pour surmonter ces contraintes, HIVE-MIND intègre un moteur d'analyse syntaxique arborescente (AST) multi-langages fondé sur WebAssembly (`web-tree-sitter`) couplé à un serveur LSP embarqué, permettant l'extraction de squelettes condensés, l'isolation chirurgicale de méthodes et la navigation sémantique précise.

## 2. Modèle Mental & Architecture Conceptuelle

Le sous-système transforme le code source en un arbre syntaxique concret (CST/AST) et applique des requêtes formelles en S-expressions (Tree-Sitter Queries) pour capturer les déclarations structurelles (classes, interfaces, fonctions, types) sans charger le corps des blocs d'implémentation.

```
                      FICHIER SOURCE SUR DISQUE
                                  │
                                  ▼
                    [ TreeSitterService.ts ]
                                  │
        ┌─────────────────────────┴─────────────────────────┐
        ▼                                                   ▼
[ WASM Parser (web-tree-sitter) ]          [ Regex Fallback Parser ]
(Grammaires .wasm compilées)               (Activé si WASM absent/corrompu)
        │                                                   │
        └─────────────────────────┬─────────────────────────┘
                                  │
                                  ▼
                [ S-Expression Queries (queries.ts) ]
             Capture des définitions et des références
                                  │
                                  ▼
        ┌───────────────────────────────────────────────────┐
        │              SERVICES D'INTELLIGENCE              │
        ├─────────────────────────┬─────────────────────────┤
        │  getFileSkeleton()      │ Vue structurelle -90%   │
        │  getFunction()          │ Isolation chirurgicale  │
        │  findSymbolReferences() │ Définitions/Usages      │
        └─────────────────────────┴─────────────────────────┘
                                  │
        ┌─────────────────────────┴─────────────────────────┐
        ▼                                                   ▼
[ ASTTools (dev_tools_ast) ]                 [ LSPTool (dev_tools_lsp) ]
- get_file_skeleton                         - lsp_query: goToDefinition
- get_function                              - lsp_query: findReferences
- find_symbol_references                    - lsp_query: hover
                                            - lsp_query: documentSymbol
```

### Décomposition des Flux

1. **Initialisation Paresseuse & Chargement WASM** : Lors du premier appel, `Parser.init()` charge le binaire WASM de base de `web-tree-sitter`. Les grammaires de chaque langage (`tree-sitter-typescript.wasm`, `tree-sitter-python.wasm`, etc.) sont ensuite chargées à la demande et mises en cache dans une `Map<string, Language>`.
2. **Extraction de Squelette Structurel (`getFileSkeleton`)** : L'arbre syntaxique est interrogé pour capturer uniquement les déclarations de types, en-têtes de fonctions et signatures de méthodes. Les corps d'implémentation (`{ ... }`) sont omis, réduisant la taille du texte d'environ 90% tout en conservant le compte exact des lignes masquées (`(45 lines)`).
3. **Extraction Chirurgicale (`getFunction`)** : Localise la fonction par nom qualifié (`ClassName.methodName`), extrait précisément ses bornes (`startLine` à `endLine`), et annote les lignes extraites avec leurs mots-ancres via le sous-système SS-23.
4. **Navigation Sémantique LSP (`lsp_query`)** : Résout les opérations classiques de développement : localisation de la définition originale d'un symbole (`goToDefinition`), recherche de toutes ses occurrences effectives (`findReferences`), affichage de la signature au survol (`hover`), et catalogue hiérarchique des symboles d'un fichier (`documentSymbol`).

## 3. Choix de Conception & Raisons d'Ingénierie

- **Portabilité WebAssembly (`web-tree-sitter`)** : L'utilisation de binaires WASM précompilés élimine le besoin de chaîne de compilation C/C++ native sur la machine hôte. Le sous-système s'exécute de manière identique sur conteneur Docker minimal, machine de développement macOS, Linux ou Windows.
- **Requêtes S-Expressions Déclaratives (`queries.ts`)** : La séparation nette entre le moteur de parsing et les motifs de capture Tree-Sitter permet d'ajouter ou d'ajuster le support syntaxique d'un langage sans modifier la logique d'exécution TypeScript.
- **Mécanisme de Repli Robuste par Regex (`parseDefinitionsRegexFallback`)** : Si un binaire WASM est manquant, corrompu ou si le fichier source présente des erreurs de syntaxe sévères, le service bascule automatiquement sur un parseur d'expressions régulières tolérant aux pannes, garantissant zéro interruption du démon.
- **Mise en Cache des Objets `Query` et `Language`** : Les instances `Language` et les objets `Query` compilés sont conservés en mémoire vive (`languageCache`, `queryCache`), rendant les parsings ultérieurs quasi-instantanés ($< 5\text{ ms}$).

## 4. Analyse Comparative & Alternatives Écartées

| Approche Alternative                                          | Avantages Théoriques                                           | Inconvénients / Raisons du Rejet par HIVE-MIND                                                                                                               |
| :------------------------------------------------------------ | :------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Serveurs LSP distants complets (tsserver, pyright, gopls)** | Typage strict et résolution sémantique cross-package complète. | Consommation excessive de mémoire vive (plusieurs centaines de Mo par serveur de langage), temps d'initialisation long, inadapté à un hôte à 2 cœurs / 8 Go. |
| **Regex brutes globales (`grep` / `ripgrep`)**                | Vitesse d'exécution pure, zéro dépendance WASM.                | Faux positifs massifs dans les commentaires, chaînes et variables locales ; incapable d'extraire la signature complète d'une fonction multiligne.            |
| **AST Babel / TypeScript Compiler API natif**                 | Richesse du modèle objet AST TypeScript.                       | Limité à l'écosystème JS/TS, nécessite un compilateur dédié par langage (Python, Go, Rust), architecture hétérogène et lourde.                               |

## 5. Frontières Architecturales & Invariants

### Périmètre Strict (Dans le Sous-Système)

- Parsing syntaxique WASM et construction d'arbres syntaxiques Tree-Sitter.
- Compilation et exécution de requêtes S-expression pour TypeScript, TSX, JavaScript, JSX, Python.
- Extraction de squelettes, signatures, fonctions et symboles.
- Serveur LSP léger en mémoire pour navigation intra-espace de travail.
- Parseur de repli basé sur regex.

### Hors Périmètre (Délégué aux Couches Adjacentes)

- **Vérification des chemins et accès bac à sable** : Déléguée à `PermissionManager` (SS-09).
- **Lecture sécurisée des fichiers** : Déléguée à `safeFs.ts` (SS-26).
- **Attribution d'ancres de hachage sur les fonctions extraites** : Déléguée à `lineHashing.ts` / `AnchorStateManager` (SS-23).

### Invariants Opérationnels

1. **Invariant de Continuité d'Exécution** : Le service ne propage jamais d'exception non gérée vers l'orchestrateur ; toute défaillance de parsing Tree-Sitter active le parseur de repli regex ou retourne `null`/liste vide de manière propre.
2. **Invariant de Bornage d'Exploration** : L'expansion récursive de répertoires pour la recherche de références (`expandDirectory`) est strictement bornée à une profondeur de 3 (`-maxdepth 3`) et un maximum de 100 fichiers pour préserver le CPU.

## 6. Liens & Navigation

- **Référence Technique :** [`ast-code-intel-reference.md`](./ast-code-intel-reference.md)
- **Guide Pratique d'Intégration :** [`ast-code-intel-howto.md`](./ast-code-intel-howto.md)
- **Index du Domaine Plugins :** [`index.md`](./index.md)
- **Index Général :** [`../00_index.md`](../00_index.md)
