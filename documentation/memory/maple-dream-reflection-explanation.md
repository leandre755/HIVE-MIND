# Moteur d'Apprentissage & Synthèse Cognitive (MAPLE & Dream) — Architecture & Principes de Fonctionnement

Le sous-système **Cognitive & Knowledge Synthesis Engine (SS-19)** orchestre l'extraction autonome de connaissances, le profilage cognitif non-supervisé de l'utilisateur (moteur MAPLE), l'auto-réflexion périodique par l'analyse d'erreurs (module Dream) et la construction continue d'un graphe de connaissances relationnel (`KnowledgeWeaver` & `GraphMemory`).

---

## 1. Contexte & Problématique d'Ingénierie

Les agents conversationnels conventionnels souffrent de trois limitations structurelles majeures :

1. **Amnésie Comportementale & Répétition d'Erreurs** : Sans mécanisme d'introspection post-exécution, un agent commet de manière récurrente les mêmes erreurs d'outils, d'arguments ou d'interprétation lorsqu'il est confronté aux mêmes situations.
2. **Profilage Utilisateur Naïf ou Inexistant** : L'adaptation au style, au niveau technique et aux préférences de l'utilisateur repose souvent sur des consignes figées dans le prompt système, ignorant les besoins implicites déductibles du dialogue (ex. préférence pour du code strict sans explications prolixes).
3. **Absence de Représentation Relationnelle Non-Linéaire** : La recherche vectorielle classique (RAG pur) retrouve des segments de texte par similarité cosinus mais échoue à capturer les liens topologiques complexes entre entités (ex. "Alex travaille sur le projet HIVE-MIND qui utilise PostgreSQL et Railway").

Le sous-système SS-19 résout ces écueils en combinant un extracteur d'insights cognitifs (MAPLE), un cycle d'introspection nocturne/inactif (Dream), un moteur d'extraction d'entités et d'arêtes (`KnowledgeWeaver`), et une modélisation de l'état émotionnel de l'agent (`ConsciousnessService`).

---

## 2. Modèle Mental & Architecture Conceptuelle

Le moteur d'apprentissage et de synthèse cognitive opère selon trois boucles d'assimilation :

```
+-----------------------------------------------------------------------------------------+
|                  MOTEUR D'APPRENTISSAGE & SYNTHÈSE COGNITIVE (SS-19)                   |
+-----------------------------------------------------------------------------------------+
                                             |
             +-------------------------------+-------------------------------+
             |                               |                               |
             v                               v                               v
+--------------------------+    +--------------------------+    +--------------------------+
|  1. PROFILAGE MAPLE      |    |  2. TISSAGE DE GRAPHE    |    |  3. CYCLE DE RÊVE        |
|     (LearningEngine)     |    |    (KnowledgeWeaver)     |    |     (DreamService)       |
+--------------------------+    +--------------------------+    +--------------------------+
| - Analyse non-supervisée |    | - Extraction JSON dédiée |    | - Déclenchement inactif  |
| - Taxonomie tripartite : |    |   (modèle kimi-for-coding|    | - Analyse des erreurs    |
|   * [fact] : faits fixes |    | - Entités typées         |    |   de l'AgentMemory       |
|   * [pref] : préférences |    | - Relations direction-   |    | - Rédaction de 3-5       |
|   * [goal] : objectifs   |    |   nelles pondérées       |    |   règles impératives     |
| - Routage dynamique des  |    | - Graphe vectorisé       |    | - Écriture atomique dans |
|   compétences expertes   |    |   dans 'entities' et     |    |   lessons_learned.md     |
|   (Skill Routing)        |    |   'relationships'        |    | - Sync tool embeddings   |
+--------------------------+    +--------------------------+    +--------------------------+
             |                               |                               |
             +-------------------------------+-------------------------------+
                                             |
                                             v
+-----------------------------------------------------------------------------------------+
|                    CONSCIENCE & ESPACE DE TRAVAIL GLOBAL (GWT)                          |
|                             (ConsciousnessService)                                      |
+-----------------------------------------------------------------------------------------+
| - Identité dynamique du persona (botIdentity)                                           |
| - Jauge d'agacement (Annoyance : 0 -> 100) & Humeurs (CALME, DÉRANGÉ, AGACÉ, FURIEUX)   |
| - Snapshot d'état cognitif global (GlobalState) injecté au démarrage de chaque tour     |
+-----------------------------------------------------------------------------------------+
```

### 2.1. Profilage Cognitif MAPLE (`LearningEngine`)
- **Taxonomie Tripartite** :
  - `[fact]` : Attributs statiques et faits invariants (rôle professionnel, pile technologique, localisation géographique). Clé stockée sous la forme `fact:nom_court`.
  - `[pref]` : Préférences comportementales de l'utilisateur (style de communication, verbosité, préférences esthétiques ou outillage). Clé stockée sous `pref:nom_court`.
  - `[goal]` : Objectifs implicites ou explicites à moyen et long terme. Clé stockée sous `goal:nom_court`.
- **Routage Dynamique de Compétences (`routeSkills`)** : Scanne les répertoires de compétences (`skills/*/SKILL.md`), extrait leurs frontmatters YAML, et interroge un modèle rapide (`FAST_CHAT` à température $0.1$) pour sélectionner la compétence experte optimale correspondant à la requête de l'utilisateur.
- **Conseils Contextuels Personnalisés (`getCommentsForSkill`)** : Filtre les préférences enregistrées sous `pref:*` pour formuler 1 à 2 directives spécifiques injectées à l'agent avant d'exécuter la compétence.

### 2.2. Introspection et Apprentissage par l'Échec (`DreamService`)
- **Phase de Rêve Nocturne / Hors-Ligne** : Déclenchée pendant les périodes de basse activité pour consolider les apprentissages sans pénaliser les temps de réponse interactifs.
- **Analyse des Échecs Récents** : Récupère les 10 dernières leçons et erreurs enregistrées dans `AgentMemory`.
- **Formulation Impérative** : Invoque la recette de service `DREAM_SERVICE` pour générer 3 à 5 directives d'action concises rédigées au mode infinitif ou impératif (ex. "Toujours vérifier le contenu d'un répertoire avec list_directory avant d'appeler read_file").
- **Persistance Atomique** : Écrit le fichier mis à jour dans `persona/lessons_learned.md`.
- **Synchronisation des Embeddings d'Outils (`syncToolEmbeddings`)** : Met à jour les vecteurs sémantiques des définitions d'outils dans la table Supabase `bot_tools` pour la sélection dynamique d'outils par RAG.

### 2.3. Tissage de Graphe de Connaissances (`KnowledgeWeaver` & `GraphMemory`)
- **Extraction Structurée Dédiée** : Invoque un modèle optimisé pour la production de JSON strict (`kimi-for-coding` à température $0.1$) pour identifier :
  - **Entités** : `Personne`, `Lieu`, `Organisation`, `Projet`, `Concept`, `Événement`, `Skill`.
  - **Relations** : `connait`, `travaille_sur`, `habite_a`, `est_lie_a`, `participe_a`, `utilise`, `expert_en`.
- **Indexation Vectorielle Hybride** : Chaque entité est stockée dans la table `entities` avec un vecteur sémantique calculé sur la concaténation `${name}: ${description}`.
- **Parcours de Graphe Topologique (`getNeighbors`)** : Interroge les arêtes de la table `relationships` pour naviguer dans le réseau relationnel d'une entité donnée avec coefficients de force pondérés.

### 2.4. Espace de Travail Global & Émotions (`ConsciousnessService`)
- Implémente une architecture inspirée de la théorie de l'espace de travail global (**Global Workspace Theory - GWT**).
- Centralise l'identité du bot, la mission assignée au groupe, les souvenirs récents et la jauge d'agacement (`annoyance` $\in [0, 100]$).
- Dérive l'humeur active selon quatre paliers déterministes :
  - $[0, 20]$ : `CALME 😌`
  - $]20, 50]$ : `DÉRANGÉ 😒`
  - $]50, 80]$ : `AGACÉ 😤`
  - $]80, 100]$ : `FURIEUX 🤬`

---

## 3. Choix de Conception & Raisons d'Ingénierie

### 3.1. Séparation Stricte entre Faits (`facts`), Préférences (`prefs`) et Objectifs (`goals`)
Le découpage en trois catégories prévient la pollution mutuelle :
- Les **faits** informent sur la vérité terrain de l'environnement de l'utilisateur.
- Les **préférences** modulent la forme de la réponse et la sélection des styles/thèmes.
- Les **objectifs** orientent la planification proactive et l'évaluation de succès des tâches longues.

### 3.2. Retry avec Backoff Exponentiel dans `DreamService`
Le cycle de réflexion manipule des fichiers de configuration vitaux (`lessons_learned.md`). Pour éliminer les échecs transitoires liés aux API distantes, `DreamService` applique 3 tentatives avec un backoff exponentiel ($5\text{ s}, 10\text{ s}, 20\text{ s}$) avant tout abandon.

### 3.3. Isolation Vectorielle des Entités du Graphe
L'indexation vectorielle des entités (`textToEmbed = "${name}: ${description}"`) permet une recherche sémantique floue (`match_entities`) lorsqu'un utilisateur mentionne un concept sous un synonyme ou une variante lexicale, avant d'enchaîner sur une traversée topologique d'arêtes.

---

## 4. Analyse Comparative & Alternatives Écartées

| Approche Alternative | Avantages Théoriques | Inconvénients / Raisons du Rejet par HIVE-MIND |
| :--- | :--- | :--- |
| **Fine-Tuning Continu du Modèle** | Apprentissage direct dans les poids du réseau. | Coût prohibitif, latence d'entraînement inadaptée, risque d'oubli catastrophique (*catastrophic forgetting*). |
| **Graphe RDF / Triple Store Externe (Neo4j)** | Puissance des requêtes Cypher / SPARQL complexes. | Dépendance infrastructurelle lourde ; complexité excessive pour le modèle relationnel d'un assistant personnel. |
| **Extraction Sémantique Synchrone par Message** | Disponibilité instantanée des relations. | Surcharge de latence (> 1s par message) et surconsommation de tokens ; rejeté au profit de seuils de matière ($N \ge 4$ messages). |

---

## 5. Frontières Architecturales & Invariants

### Ce qui est DANS le périmètre de SS-19 :
- Extraction et classification des insights MAPLE (`[fact]`, `[pref]`, `[goal]`).
- Routage et recommandation de compétences expertes.
- Analyse périodique des échecs d'outils et rédaction de `lessons_learned.md`.
- Upsert par lots d'entités et d'arêtes dans `entities` et `relationships`.
- Calcul de l'état de conscience, jauge d'agacement et humeur.

### Ce qui est EXCLU et délégué aux autres couches :
- **Tampon circulaire L1 et vélocité** : Délégués à `workingMemory` (SS-18).
- **Indexation vectorielle de documents et médias** : Déléguée à `MultimodalEmbeddingService` (SS-20).
- **Exécution concrète des outils de développement** : Déléguée au pipeline de plugins (SS-25).

---

## 6. Liens & Navigation

- **Référence Technique :** [`maple-dream-reflection-reference.md`](./maple-dream-reflection-reference.md)
- **Guide Pratique d'Intégration :** [`maple-dream-reflection-howto.md`](./maple-dream-reflection-howto.md)
- **Index du Domaine :** [`index.md`](./index.md)
