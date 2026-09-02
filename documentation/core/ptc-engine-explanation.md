# Programmatic Tool Calling (PTC) Engine & WakeSystem — Architecture & Principes de Fonctionnement

Le sous-système **PTC Engine** (*Programmatic Tool Calling*) et son composant de réveil asynchrone **HiveWakeSystem** réinventent l'exécution d'outils agentiques en remplaçant la boucle ReAct multi-tours classique par la génération et l'exécution d'un script JavaScript unifié au sein d'une machine virtuelle sandboxée (`node:vm`).

## 1. Contexte & Problématique d'Ingénierie

Dans le paradigme ReAct traditionnel, lorsqu'un agent doit invoquer plusieurs outils (ex: scraper 5 pages web, analyser 10 fichiers ou croiser des données météo sur 3 villes), chaque outil nécessite un aller-retour complet avec le modèle de langage :
- **Inflation géométrique des jetons (*Token Inflation*)** : À chaque tour de boucle $k$, la totalité du contexte antérieur $T_{\text{base}}$ ainsi que la somme cumulée des résultats intermédiaires $\sum_{j=1}^{k-1} T(\text{Res}_j)$ sont réinjectés dans l'invite.
- **Latence cumulative prohibitive** : $N$ appels d'outils séquentiels imposent $N$ requêtes réseau complètes vers l'API LLM, multipliant le temps total par 5 à 10.
- **Fragilité sur le traitement de listes et d'itérations** : Les LLMs peinent à maintenir la cohérence de boucles itératives longues en langage naturel pur.

`PTC Engine` élimine ces inefficacités en traitant les outils non pas comme des déclarations passives en langage naturel, mais comme de véritables fonctions JavaScript asynchrones exécutées directement dans un environnement d'exécution sécurisé.

## 2. Modèle Mental & Architecture Conceptuelle

Le fonctionnement du moteur PTC s'articule autour de 5 piliers :

1. **Meta-Tool `code_execution`** : L'agent reçoit une définition d'outil globale lui permettant de rédiger un bloc de code JavaScript orchestrant $N$ outils via des structures de contrôle standards (`Promise.all`, `for...of`, `map`, `filter`).
2. **Analyse Statique d'AST & Auto-Réparation (`SafeScriptValidator`)** : Avant toute évaluation, le code source est analysé par l'analyseur syntaxique Acorn. Les primitives dangereuses (`require`, `import`, `eval`, `fetch`, `process`) sont formellement rejetées. Les erreurs de syntaxe courantes (ex: passage de multiples arguments au lieu d'un objet de paramètres) sont automatiquement réparées.
3. **Environnement Sandboxé & Helpers Défensifs (`node:vm`)** : Le script est exécuté dans un contexte V8 étanche où les outils sont injectés sous forme de fonctions globales asynchrones. Un ensemble de fonctions de garde (`toArray`, `safeGet`, `safeMap`, `isSuccess`, `extractText`) est injecté pour absorber les valeurs `null` ou `undefined`.
4. **Scope Guard Proxy** : Un proxy JavaScript intercepte les accès aux variables non déclarées pour empêcher les plantages par `ReferenceError`.
5. **Suspension & Réveil Contextuel (`HiveWakeSystem`)** : Le pont `HIVE.sleepAndWake(delayMs, prompt)` permet à l'agent de suspendre son exécution et de programmer un réveil automatique sans consommer de ressources CPU.

```
 [LLM Prompt] ──► Génère Script JS d'orchestration
                        │
                        ▼
            [SafeScriptValidator (Acorn AST)]
            - Vérifie l'absence de require / eval / process
            - Auto-répare les syntaxes d'outils
                        │
                        ▼
            [Node.js vm Sandbox]
            ├─ Injection Helpers (toArray, safeGet, isSuccess)
            ├─ Injection Outils (Map<string, ToolFunction>)
            ├─ Scope Guard Proxy (piège ReferenceError)
            └─ Pont HiveWakeBridge (HIVE.sleepAndWake)
                        │
                        ▼
            Seul le Résultat Final est retourné au LLM !
            (Économie de 80% à 95% des jetons intermédiaires)
```

## 3. Formulation Théorique de l'Économie de Jetons (FinOps)

Soit un plan composé de $N$ appels d'outils, un contexte de base $T_{\text{base}}$ et une taille de sortie pour le $i$-ème outil $T(\text{Res}_i)$.

### Consommation selon le paradigme ReAct standard :
$$\text{Tokens}_{\text{ReAct}} = \sum_{k=1}^{N} \left( T_{\text{base}} + \sum_{j=1}^{k-1} T(\text{Res}_j) \right) = N \cdot T_{\text{base}} + \sum_{k=1}^{N} \sum_{j=1}^{k-1} T(\text{Res}_j)$$

### Consommation selon le paradigme PTC :
$$\text{Tokens}_{\text{PTC}} = T_{\text{base}} + T(\text{Code}_{\text{script}}) + T(\text{Résultat}_{\text{final}})$$

### Gain d'économie net :
$$\Delta_{\text{Tokens}} \approx (N - 1) \cdot T_{\text{base}} + \sum_{i=1}^{N-1} T(\text{Res}_i)$$

Pour $N \ge 3$, l'économie dépasse couramment 80% de la bande passante de contexte, réduisant drastiquement les coûts d'API et la latence.

## 4. Analyse Comparative & Alternatives Écartées

| Approche Alternative | Avantages Théoriques | Inconvénients / Raisons du Rejet par HIVE-MIND |
| :--- | :--- | :--- |
| **Boucle ReAct Traditionnelle** | Standardisé, supporté nativement par tous les SDKs. | Coût en jetons explosif ($O(N^2)$ sur les données cumulées), latence linéaire élevée. |
| **Conteneurs Docker / MicroVMs isolés** | Confinement système absolu. | Surcoût d'instanciation (~1s par exécution), consommation RAM prohibitive pour des opérations fréquentes. |
| **Interpréteur JS pur en mémoire (QuickJS / Boa)** | Aucun accès aux primitives Node.js. | Complexité d'interfaçage asynchrone avec les promesses TypeScript du runtime HIVE-MIND. |

## 5. Frontières Architecturales & Invariants

- **Dans le périmètre de `PTC Engine`** :
  - Validation syntaxique et sécuritaire des scripts générés.
  - Exécution sandboxée dans `node:vm` avec timeout de 30 secondes.
  - Calcul et traçabilité des métriques d'économie de jetons.
  - Gestion des programmations de réveil via `HiveWakeSystem`.
- **Exclu du périmètre** :
  - Génération du code source JavaScript (assurée par le modèle LLM).
  - Gestion des accès fichiers ou commandes système réelles (déléguée aux outils individuels et à `PermissionManager`).

## 6. Liens & Navigation

- **Référence Technique :** [`ptc-engine-reference.md`](./ptc-engine-reference.md)
- **Guide Pratique d'Intégration :** [`ptc-engine-howto.md`](./ptc-engine-howto.md)
- **Index du Domaine Core :** [`index.md`](./index.md)
