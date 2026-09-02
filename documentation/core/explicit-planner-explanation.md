# ExplicitPlanner — Architecture & Principes de Fonctionnement

Le sous-système **ExplicitPlanner** est le moteur de planification hiérarchique de HIVE-MIND. Il décompose les objectifs utilisateurs complexes en graphes orientés acycliques (DAG) d'appels d'outils, gère l'interpolation dynamique de variables entre étapes et supervise les boucles de replanification autonome (*Dynamic Replanning*).

## 1. Contexte & Problématique d'Ingénierie

Dans une boucle ReAct traditionnelle en allers-retours pas-à-pas, l'exécution de tâches multi-étapes complexes présente plusieurs faiblesses critiques :
- **Perte de vue de l'objectif global (*Goal Drift*)** : L'agent a tendance à bifurquer vers des actions exploratoires superflues sans vision d'ensemble du chemin critique.
- **Incapacité à chaîner les données hétérogènes** : Passer la sortie d'un outil de recherche (ex: un chemin de fichier ou une URL) aux arguments d'un outil d'analyse requiert des mécanismes d'interpolation robustes et résilients aux formats JSON imparfaits.
- **Fragilité face aux échecs d'outils** : Si un outil échoue en cours de route (ex: erreur 404, clé API expirée), une boucle naïve abandonne la tâche sans tenter de trouver un chemin alternatif.

`ExplicitPlanner` résout ces problématiques via un paradigme *Plan $\rightarrow$ Execute $\rightarrow$ Review* déterministe avec auto-correction en boucle fermée.

## 2. Modèle Mental & Architecture Conceptuelle

Le cycle de vie d'une tâche planifiée s'articule en 4 phases :

1. **Évaluation Prédictive (`needsPlanning`)** : Une heuristique rapide analyse l'instruction utilisateur et l'ensemble des outils disponibles pour décider si une planification formelle en DAG est requise ou si une exécution directe suffit.
2. **Génération & Validation du DAG (`plan`)** : Le LLM génère un plan composé d'étapes structurées (`PlanStep`) comportant des identifiants, des estimations de durée et un tableau explicite de dépendances (`depends_on: number[]`). La réponse est réparée et validée par rapport au schéma strict via `tryParseJson`.
3. **Exécution Ordonnée & Interpolation de Variables (`executePlan`)** : Les étapes sont exécutées dans le respect de l'ordonnancement topologique. Avant chaque appel d'outil, les paramètres contenant des balises de substitution (`{{step_1_result}}`, `{{filePath_from_step_2}}`) sont dynamiquement interpolés avec les résultats des étapes précédentes.
4. **Analyse d'Erreur & Replanification (`replanning`)** : En cas d'échec d'une étape, le planificateur analyse la cause racine, conserve les résultats partiels déjà acquis et génère un plan correctif ajusté (jusqu'à 5 itérations).

```
 [Objectif Utilisateur]
           │
           ▼
    needsPlanning() ──► NON ──► [Exécution Réactive Directe]
           │ (OUI)
           ▼
     plan() ──► Génération DAG JSON ──► Validation & Parsing Résilient
           │
           ▼
    executePlan()
           │
           ├─► Résolution dépendances (depends_on)
           ├─► Interpolation variables ({{step_N_result}})
           ├─► Exécution outil
           │
     Échec d'étape ?
      /           \
    OUI           NON
    /               \
   ▼                 ▼
Replanification   Étape suivante ──► [Plan Terminé]
(Max 5 itér.)                              │
                                           ▼
                                    ReviewResult & Métriques
```

## 3. Choix de Conception & Raisons d'Ingénierie

1. **Interpolation Typée et Lexicale Résiliente** :
   - *Raison* : Les sorties d'outils peuvent être des chaînes, des objets JSON imbriqués ou des tableaux. Le moteur d'interpolation résout les clés exactes ou applique des extracteurs sémantiques spécialisés (chemins de fichiers, URL, tableaux).
2. **Correction des Hallucinations de Noms d'Outils (`findClosestToolName`)** :
   - *Raison* : Si le modèle de langage orthographie légèrement mal un nom d'outil (ex: `read_file_tool` au lieu de `read_file`), un calcul de distance lexicale (distance de Levenshtein) réassocie automatiquement l'outil valide le plus proche sans planter le plan.
3. **Isolation de l'État d'Exécution (`ExecutionLog`)** :
   - *Raison* : L'état d'un plan en cours dispose de son propre identifiant unique `planId` et est stocké dans la mémoire d'action (`ActionMemory`), garantissant une traçabilité complète sans polluer la mémoire de travail globale.

## 4. Analyse Comparative & Alternatives Écartées

| Approche Alternative | Avantages Théoriques | Inconvénients / Raisons du Rejet par HIVE-MIND |
| :--- | :--- | :--- |
| **Boucle ReAct pure sans plan** | Démarrage immédiat sans coût de jetons initial. | Perte fréquente du contexte sur les tâches de plus de 5 étapes, dérive vers des boucles infinies. |
| **LangChain Plan-and-Solve standard** | Intégration prête à l'emploi. | Absence de tolérance aux pannes fine, replanification monolithique recommençant à zéro sans réutiliser les étapes acquises. |
| **Graphes statiques pré-compilés (LangGraph)** | Déterminisme absolu. | Manque d'adaptabilité face à des requêtes imprévisibles nécessitant une synthèse dynamique d'outils. |

## 5. Frontières Architecturales & Invariants

- **Dans le périmètre de `ExplicitPlanner`** :
  - Découpage en graphe DAG et ordonnancement des étapes.
  - Résolution des dépendances et interpolation des variables.
  - Boucle de replanification et calcul du bilan d'efficacité (`ReviewResult`).
- **Exclu du périmètre** :
  - Implémentation physique des outils (déléguée à `pluginLoader`).
  - Sélection du modèle de langage sous-jacent (déléguée à `providerRouter`).

## 6. Liens & Navigation

- **Référence Technique :** [`explicit-planner-reference.md`](./explicit-planner-reference.md)
- **Guide Pratique d'Intégration :** [`explicit-planner-howto.md`](./explicit-planner-howto.md)
- **Index du Domaine Core :** [`index.md`](./index.md)
