# Stateful Hash-Anchored Line Editing Engine (SS-23) — Architecture & Principes de Fonctionnement

Le sous-système **Stateful Hash-Anchored Line Editing Engine** constitue le moteur de manipulation de code source déterministe de HIVE-MIND, éliminant les dérives d'indexation numérique et les ambiguïtés de motif textuel lors des modifications automatisées par modèles de langage.

## 1. Contexte & Problématique d'Ingénierie

L'édition de code par un modèle de langage (LLM) dans un harnais d'exécution autonome est traditionnellement confrontée à deux modes de défaillance majeurs :

1. **La dérive des numéros de ligne (_Line Drift_)** : Lorsqu'un agent applique plusieurs modifications séquentielles à un fichier, l'insertion ou la suppression de lignes décale instantanément tous les numéros de ligne subséquents. Dès la deuxième opération, les coordonnées fournies par le modèle pointent vers des lignes erronées, provoquant des corruptions de syntaxe.
2. **L'ambiguïté des motifs textuels (_Search-and-Replace Ambiguity_)** : Le remplacement par chaîne exacte (`old_string` $\to$ `new_string`) échoue sur les lignes redondantes (ex. `return true;`, `}`, `break;`, lignes vides) dès lors qu'un fichier contient des occurrences multiples identiques. Forcer le modèle à fournir un contexte étendu augmente le coût en jetons et introduit des risques de discordance d'indentation ou d'espacement.

Pour résoudre ces contraintes sous un budget mémoire strict et sans dépendance externe lourde, HIVE-MIND implémente un système d'ancrage stateful par mots mnémoniques et hachage FNV-1a à 32 bits, couplé à une réconciliation par algorithme de Myers (_Myers Diff_).

## 2. Modèle Mental & Architecture Conceptuelle

Le principe fondamental repose sur l'attribution d'un mot-ancre unique, stable et persistant à chaque ligne d'un fichier source. Lors de la lecture initiale (`read_file`), chaque ligne est préfixée par son ancre séparée par le délimiteur invariant `§` (ex. `AppleBanana§const port = 3000;`).

Lorsque l'agent soumet des modifications via `edit_file`, il référence les lignes par leurs mots-ancres. Le moteur réconcilie l'état du fichier en recalculant les différences sur les empreintes numériques.

```
                  LECTURE DU FICHIER SOURCE
                             │
                             ▼
              [ FNV-1a Hash (Uint32Array) ]
                             │
                             ▼
         [ Attribution / Réconciliation d'Ancres ]
        (Myers Diff sur entiers de hachage O(N))
                             │
                             ▼
         [ Formatage Lignes : "AnchorWord§Contenu" ]
                             │
                             ▼
                  PROMPT / OUTIL AGENT
                             │
                  MUTATION PROPOSÉE PAR L'AGENT
              (replace, insert_after, insert_before)
                             │
                             ▼
               [ Résolution des Ancres en Index ]
                             │
                             ▼
             [ Tri Bottom-Up & Vérification Overlap ]
                             │
                             ▼
            [ Application Atomique dans le Buffer ]
                             │
                             ▼
               [ Écriture Disque via safeFs ]
                             │
                             ▼
             [ Réconciliation Cache LRU (taskId) ]
```

### Décomposition des Flux

1. **Flux de Lecture & Ancrage** : Les lignes du fichier sont transformées en un tableau d'entiers non signés `Uint32Array`. Si le fichier est inconnu, un pool de mots mnémoniques (issu du dictionnaire `hashDictionary.ts` brassé par Fisher-Yates) est distribué ligne par ligne.
2. **Flux de Réconciliation (Myers Diff)** : Lors d'une relecture ou après une modification, `diffArrays` compare le tableau d'entiers précédent avec le nouveau. Les lignes inchangées conservent strictement leur mot-ancre historique, les lignes insérées reçoivent une nouvelle ancre depuis la réserve disponible, et les lignes supprimées libèrent leur ancre.
3. **Flux de Mutation Atomique** : Les opérations de mutation (`replace`, `insert_after`, `insert_before`) sont résolues en indices numériques, validées contre les collisions ou chevauchements (_overlapping edits_), puis triées par ordre décroissant d'indice (_bottom-up_). L'application se fait en mémoire avant l'écriture atomique sur disque.

## 3. Choix de Conception & Raisons d'Ingénierie

- **Hachage FNV-1a en `Uint32Array`** : L'algorithme FNV-1a (Fowler-Noll-Vo) opère par opérations bit à bit simples (XOR et multiplication modulo $2^{32}$) sans surcoût cryptographique. L'utilisation d'un `Uint32Array` réduit l'empreinte mémoire d'un facteur 4 par rapport à un tableau de chaînes hexadécimales standard et permet des comparaisons vectorielles $O(1)$ par élément.
- **Délimiteur `§` (Section Sign)** : Le caractère `§` est visuellement explicite et quasi-inexistant dans les syntaxes de programmation courantes (JS, TS, Python, Go, Rust, C++), évitant tout faux positif lors de l'extraction de l'ancre ou du découpage.
- **Application par Tri Bottom-Up** : En triant les modifications du bas du fichier vers le haut (indices décroissants), l'application de chaque `splice` modifie la longueur du tableau sans altérer les indices des modifications situées plus haut.
- **Double Cache LRU Partitionné par Tâche** : L'état des ancres est stocké dans une hiérarchie `Map<taskId, Map<filePath, TrackedDocument>>`. La capacité est bornée à 50 tâches simultanées et 1024 fichiers par tâche, avec éviction automatique des entrées les plus anciennes (_Least Recently Used_), protégeant la mémoire de l'hôte.

## 4. Analyse Comparative & Alternatives Écartées

| Approche Alternative                                     | Avantages Théoriques                                 | Inconvénients / Raisons du Rejet par HIVE-MIND                                                                                                 |
| :------------------------------------------------------- | :--------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------- |
| **Numéros de ligne bruts (`line: 42`)**                  | Simplicité conceptuelle, aucun état en mémoire vive. | Extrêmement fragile : toute modification décale les lignes subséquentes et provoque des éditions erronées en cascade.                          |
| **Remplacement par motif (`old_string` / `new_string`)** | Sans état, compréhensible par les LLM génériques.    | Ambigüe sur les lignes dupliquées (`return true;`, `}`), nécessite des contextes larges et coûteux en jetons.                                  |
| **Patchs standard Unidiff (`diff -u`)**                  | Format standardisé UNIX, portable.                   | Taux d'hallucination élevé des LLM sur les en-têtes d'offset (`@@ -12,4 +12,6 @@`) et les lignes de contexte exactes.                          |
| **Édition AST structurelle (Babel/jscodeshift)**         | Précision sémantique au niveau du nœud.              | Limité aux langages supportés par le parser, incapable de manipuler des fichiers non syntaxiquement valides ou du texte brut (Markdown, YAML). |

## 5. Frontières Architecturales & Invariants

### Périmètre Strict (Dans le Sous-Système)

- Calcul déterministe des empreintes FNV-1a sur chaînes de caractères.
- Gestion du dictionnaire de mots mnémoniques et brassage pseudo-aléatoire reproductible.
- Algorithme de réconciliation de Myers sur tableaux d'entiers.
- Détection des chevauchements d'intervalles lors d'éditions par lots.
- Maintien du cycle de vie du cache en mémoire vive (`AnchorStateManager`).

### Hors Périmètre (Délégué aux Couches Adjacentes)

- **Persistance et I/O disque** : Déléguées aux wrappers `safeFs.ts` (`safeReadFileSync`, `safeWriteFileSync`).
- **Contrôle d'accès et sandboxing** : Délégués à `PermissionManager` (SS-09 / SS-26).
- **Détection des modifications concurrentes hors-processus** : Déléguée à `fileStateCache` et `FileState`.

### Invariants Opérationnels

1. **Invariant de Plafond Mémoire** : Si un fichier dépasse `MAX_TRACKED_LINES = 50_000`, le gestionnaire bascule automatiquement en mode repli transparent générant des étiquettes `L1`, `L2`, ..., `LN` sans saturer la RAM.
2. **Invariant d'Idempotence** : L'appel à `AnchorStateManager.reconcile()` sur un contenu inchangé retourne immédiatement la référence en cache sans réallouer de structures.
3. **Invariant d'Isolation Multi-Tâches** : Deux sous-agents exécutant des tâches distinctes (`taskA`, `taskB`) sur un même fichier disposent de tables d'ancres indépendantes sans interférence mutuelle.

## 6. Liens & Navigation

- **Référence Technique :** [`hash-line-editor-reference.md`](./hash-line-editor-reference.md)
- **Guide Pratique d'Intégration :** [`hash-line-editor-howto.md`](./hash-line-editor-howto.md)
- **Index du Domaine Plugins :** [`index.md`](./index.md)
- **Index Général :** [`../00_index.md`](../00_index.md)
