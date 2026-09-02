# Architecture Mémoire Hybride Multi-Niveaux — Architecture & Principes de Fonctionnement

Le sous-système **Multi-Tier Hybrid Memory (SS-18)** orchestre la persistance hiérarchique, la recherche sémantique à long terme et la régulation d'oubli cognitif de HIVE-MIND, articulant une mémoire de travail ultra-rapide en cache chaud (Redis L1) et une mémoire vectorielle dense persistante (Supabase L2 avec `pgvector`).

---

## 1. Contexte & Problématique d'Ingénierie

Dans les architectures d'agents autonomes opérant sur des canaux de messagerie instantanée (WhatsApp, Discord, Telegram), la gestion de la mémoire fait face à plusieurs défis fondamentaux :

1. **Latence vs Horizon Temporel** : Les utilisateurs attendent des réponses quasi-instantanées (< 500 ms) pour le fil de discussion immédiat, alors que la recherche vectorielle sur des milliers d'échanges historiques impose un coût de calcul et de réseau non négligeable.
2. **Saturation Contextuelle (Context Stuffing)** : Injecter l'intégralité de l'historique brut dans la fenêtre de contexte d'un LLM dégrade la capacité d'attention du modèle, dilue les instructions système et augmente exponentiellement le coût en tokens.
3. **Bruit Conversationnel & Amnésie Sélective** : Une conversation réelle est saturée de bruits éphémères (salutations, validations, confirmations courtes) qui ne doivent pas polluer la mémoire à long terme, tandis que les faits critiques (engagements, préférences, deadlines) doivent résister au temps.
4. **Interruption & Reprise d'Actions** : Dans un environnement multi-tours asynchrone, un utilisateur peut initier une tâche complexe (ex. refactoring de code, déploiement), changer subitement de sujet, puis demander la reprise de la tâche antérieure sans perte d'état.

Le sous-système SS-18 résout ces contraintes par une topologie mnésique à deux niveaux complétée par un modèle mathématique d'oubli intellectuel basé sur la courbe d'Ebbinghaus et un gestionnaire d'actions suspendues.

---

## 2. Modèle Mental & Architecture Conceptuelle

L'architecture mnésique de HIVE-MIND découpe la mémoire en deux strates majeures coordonnées par des mécanismes de consolidation et de vieillissement :

```
+-----------------------------------------------------------------------------------------+
|                        COUCHE MÉMOIRE HYBRIDE (SS-18)                                  |
+-----------------------------------------------------------------------------------------+
                                             |
             +-------------------------------+-------------------------------+
             |                                                               |
             v                                                               v
+------------------------------------------+    +------------------------------------------+
|          STRATE L1 : CHAUD (HOT)         |    |         STRATE L2 : TIÈDE/FROID          |
|        (RAM / Redis In-Memory)           |    |           (Supabase pgvector)            |
+------------------------------------------+    +------------------------------------------+
| - Tampon circulaire (15 turns max)       |    | - Table 'memories' (embeddings 1024d)    |
| - Vélocité & modes (solo/calm/active/..) |    | - Recherche cosinus : match_memories     |
| - ActionMemory (plans TTL 3600s)         |    | - Table 'agent_workspace' & 'facts'      |
| - Passeport utilisateur (passport:*)     |    | - Miroir 'agent_actions'                 |
| - Bloc-notes volatile (scratchpad:*)     |    | - CMA Boost non-bloquant                 |
+------------------------------------------+    +------------------------------------------+
             |                                                               ^
             |               Éviction / Archivage (score < 0.3)             |
             +───────────────────────────────────────────────────────────────+
             |                                                               |
             v                                                               |
+------------------------------------------+                                 |
|         DÉCROISSANCE & CONSOLIDATION     |                                 |
|            (MemoryDecaySystem)           |                                 |
+------------------------------------------+                                 |
| - Score S(m) = 0.4*e^(-t/24) +           |                                 |
|               0.3*min(recall/10, 1) +    |                                 |
|               0.3*Importance(lexique)    |                                 |
| - Archivage conditionnel                 |                                 |
| - Synthèse en Gists dès >= 5 archivages  | ────────────────────────────────+
+------------------------------------------+
```

### 2.1. Strate L1 : Mémoire de Travail Volatile (`workingMemory`)
- **Tampon Circulaire (`chat:{id}:context`)** : Maintient en temps réel les 15 derniers messages échangés (`rPush` + `lTrim(0, -15)`), assortis d'un TTL de 24 heures (86400 s) pour éviter l'amnésie post-veille.
- **Analyseur de Vélocité Conversationnelle (`ChatVelocity`)** : Mesure le nombre de messages reçus par minute via une structure Sorted Set Redis (`velocity:{chatId}`) et le nombre d'émetteurs distincts (`velocity:{chatId}:senders`). Détermine dynamiquement le mode d'interaction :
  - `solo` : Conversation privée (1 seul interlocuteur) $\rightarrow$ citations et mentions désactivées.
  - `calm` : Groupe à faible cadence ($\le 2$ msg/min) $\rightarrow$ réponse sobre sans citation.
  - `active` : Groupe modérément actif ($> 2$ msg/min) $\rightarrow$ citation explicite du message cible (`useQuote: true`).
  - `chaos` : Groupe saturé ($> 10$ msg/min) $\rightarrow$ citation et mention explicite de l'utilisateur (`useQuote: true`, `useMention: true`).
- **Traces d'Actions Récentes (`action_history:{chatId}`)** : Maintient les 6 dernières étapes d'outils invoquées pour informer le LLM des opérations machine immédiates sans surcharger le prompt.
- **Passeport & Scratchpad** : Cache chaud du profil utilisateur (`passport:{sender}`) et bloc-notes textuel volatile (`scratchpad:{chatId}`, plafonné à 500 caractères).

### 2.2. Strate Épisodique : Gestionnaire d'Actions (`ActionMemory`)
- Stocke les intentions multi-tours et les plans en cours dans des tables de hachage Redis (`action:{chatId}`) avec un TTL par défaut de 3600 secondes (1 heure).
- Synchronise en miroir chaque état dans la table PostgreSQL `agent_actions` pour garantir la reprise post-redémarrage du démon.
- Nettoyeur automatique d'actions orphelines exécuté toutes les heures (`startOrphanCleanup`).

### 2.3. Strate L2 : Mémoire Sémantique Vectorielle (`SemanticMemory` & `memory.ts`)
- Vectorise les messages et fragments de connaissances via `EmbeddingsService` (modèle `gemini-embedding-001` ou fallback OpenAI `text-embedding-3-small`).
- Effectue des requêtes $k$-NN par similarité cosinus via la fonction PostgreSQL RPC `match_memories` filtrée par identifiant de contexte normalisé (`context_id`).
- Intègre un renforcement automatique post-rappel (**Continuous Memory Assimilation** ou **CMA**) : chaque rappel d'un souvenir incrémente son compteur de consultation (`recall_count`) via la procédure `cma_boost_memory` lancée en arrière-plan asynchrone non-bloquant (`setImmediate`).

---

## 3. Choix de Conception & Raisons d'Ingénierie

### 3.1. Formulation Mathématique de la Décroissance Mnésique d'Ebbinghaus

La persistance indéfinie de souvenirs bruts sans filtre mène à l'engorgement de la base vectorielle et à la détérioration de la pertinence des recherches $k$-NN. Le système `MemoryDecaySystem` formalise l'oubli biologique à travers l'équation de rétention :

$$\mathcal{S}(m) = w_{\text{rec}} \cdot e^{-\frac{\Delta t}{\tau}} + w_{\text{freq}} \cdot \min\left(\frac{\text{recall\_count}}{10}, 1.0\right) + w_{\text{imp}} \cdot \mathcal{I}(\text{content})$$

où :
- $\Delta t = \frac{t_{\text{now}} - t_{\text{created}}}{3600 \times 1000}$ est l'âge du souvenir exprimé en heures.
- $\tau = 24.0\text{ h}$ est la demi-vie temporelle du souvenir.
- $w_{\text{rec}} = 0.4$, $w_{\text{freq}} = 0.3$, $w_{\text{imp}} = 0.3$ sont les pondérations respectives de récence, fréquence et criticité ($w_{\text{rec}} + w_{\text{freq}} + w_{\text{imp}} = 1.0$).
- $\mathcal{I}(\text{content}) \in [0, 1]$ est la fonction d'importance lexicale calculée par détection de termes discriminants :
  $$\mathcal{I}(\text{content}) = \min\left( \sum_{k \in \mathcal{K}_{\text{imp}}} 0.2 \cdot \mathbb{I}(k \in \text{lower}(\text{content})), \, 1.0 \right)$$
  avec $\mathcal{K}_{\text{imp}} = \{\text{'promis'}, \text{'engagement'}, \text{'rdv'}, \text{'rendez-vous'}, \text{'deadline'}, \text{'important'}, \text{'critique'}, \text{'urgent'}, \text{'préfère'}, \text{'déteste'}, \text{'aime'}, \text{'jamais'}, \text{'toujours'}, \text{'rappelle-moi'}, \text{'note'}\}$.

**Règle de décision** :
- Si $\mathcal{S}(m) > \theta_{\text{decay}} = 0.3$, le souvenir est conservé actif dans l'espace de recherche.
- Si $\mathcal{S}(m) \le 0.3$, le souvenir est archivé avec l'horodatage `archived_at = now()`.

### 3.2. Consolidation Cognitive en Gists

L'oubli ne doit pas détruire l'information capitale. Lorsque le volume de souvenirs archivés pour un contexte donné atteint le seuil $N_{\text{archive}} \ge 5$, `MemoryDecaySystem` déclenche une synthèse asynchrone non-bloquante :

$$\text{Gist} = \operatorname{LLM}_{\text{FAST\_CHAT}}\left(\text{Synthesize}(\{m_1, m_2, \dots, m_k\}), \tau=0.2\right)$$

Le Gist généré est une assertion factuelle dense (1 à 2 phrases max) réinjectée dans la table L2 sous le préfixe `[CONSOLIDATED GIST]`, assurant un ratio de compression supérieur à 90% sans perte de contexte stratégique.

### 3.3. Émulation Transparente Hors-Ligne (`InMemoryRedisMock`)

Pour garantir l'isolation des tests unitaires et la résilience en environnement de développement sans serveur Redis actif, `redisClient.ts` intègre `InMemoryRedisMock`. Ce mock implémente les commandes Redis clés (`get`, `set`, `del`, `lPush`, `rPop`, `lRange`, `lTrim`, `zAdd`, `zRangeWithScores`, `hSet`, `hGetAll`, `sAdd`, `multi/exec`) avec gestion interne de l'expiration temporelle, permettant un basculement transparent sans modifier le code applicatif.

---

## 4. Analyse Comparative & Alternatives Écartées

| Approche Alternative | Avantages Théoriques | Inconvénients / Raisons du Rejet par HIVE-MIND |
| :--- | :--- | :--- |
| **Base Vectorielle Monolithique Unique** | Modèle de données unifié, une seule base à gérer. | Latence inacceptable (> 200ms par message) sur les canaux temps-réel ; coût d'embedding inutile sur le bruit éphémère. |
| **Fenêtre Glissante Pure (FIFO 100 msgs)** | Zéro calcul de vectorisation, simplicité totale. | Amnésie totale des événements antérieurs à 100 messages ; saturation du contexte par des échanges triviaux. |
| **Suppression Définitive Directe (Hard Delete)** | Gain d'espace disque immédiat. | Perte irréversible de faits critiques et impossibilité d'effectuer la consolidation en Gists. |
| **Consolidation Synchrone Bloquante** | Garantie d'immédiateté de la synthèse. | Blocage du fil de réponse utilisateur de 2 à 5 secondes pendant l'inférence LLM ; rejeté au profit de `setImmediate`. |

---

## 5. Frontières Architecturales & Invariants

### Ce qui est DANS le périmètre de SS-18 :
- Stockage, expiration et lecture de la mémoire de travail récente (L1).
- Calcul en temps réel de la vélocité conversationnelle et recommandation de stratégie de réponse (citation / mention).
- Gestion du cycle de vie des plans d'action (démarrage, mise à jour des étapes, complétion, interruption).
- Calcul du score d'Ebbinghaus, archivage des souvenirs dépréciés et génération des Gists.
- Recherche sémantique vectorielle dense et renforcement CMA.

### Ce qui est EXCLU et délégué aux autres couches :
- **Extraction d'entités et tissage de graphe relationnel** : Déléguée à `KnowledgeWeaver` et `GraphMemory` (SS-19).
- **Profilage psychologique et apprentissage d'insights** : Délégué à `LearningEngine` MAPLE (SS-19).
- **Indexation vectorielle de fichiers multimédias locaux** : Déléguée à `MultimodalEmbeddingService` (SS-20).
- **Résolution des identifiants omni-canaux (JID $\rightarrow$ UUID)** : Déléguée à `supabase.ts` (`resolveContextFromLegacyId`).

---

## 6. Liens & Navigation

- **Référence Technique :** [`hybrid-memory-reference.md`](./hybrid-memory-reference.md)
- **Guide Pratique d'Intégration :** [`hybrid-memory-howto.md`](./hybrid-memory-howto.md)
- **Index du Domaine :** [`index.md`](./index.md)
