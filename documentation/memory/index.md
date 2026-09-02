# Domaine 4 : Mémoire & Cognition (SS-18 à SS-20)

Bienvenue dans la documentation officielle du **Domaine 4 (Mémoire & Cognition)** de HIVE-MIND. Ce domaine regroupe les sous-systèmes assurant la persistance hiérarchique, l'oubli cognitif régulé, l'extraction de profil utilisateur, l'introspection par l'échec et la recherche vectorielle multimodale locale.

---

## 1. Vue d'Ensemble du Domaine

Le domaine Mémoire & Cognition s'articule autour de trois sous-systèmes complémentaires :

1. **SS-18 : Architecture Mémoire Hybride Multi-Niveaux (`hybrid-memory-*`)**  
   Articule une mémoire vive de travail en cache chaud (Redis L1 / RAM) avec calcul de vélocité conversationnelle, un gestionnaire d'actions multi-tours suspendues (`ActionMemory`), une mémoire sémantique vectorielle à long terme (Supabase L2 avec `pgvector`), et un modèle mathématique de décroissance d'Ebbinghaus couplé à une consolidation cognitive en *Gists*.

2. **SS-19 : Moteur d'Apprentissage & Synthèse Cognitive (`maple-dream-reflection-*`)**  
   Assure l'extraction d'insights non-supervisés selon la taxonomie tripartite MAPLE (`[fact]`, `[pref]`, `[goal]`), le routage dynamique de compétences expertes, l'auto-réflexion périodique nocturne (`DreamService`) écrivant dans `persona/lessons_learned.md`, le tissage de graphe relationnel (`KnowledgeWeaver` & `GraphMemory`), et le suivi de conscience GWT (`ConsciousnessService`).

3. **SS-20 : Base de Données Vectorielle Multimodale Locale (`local-vectordb-*`)**  
   Fournit une infrastructure vectorielle 100% in-process et locale, exploitant `gemini-embedding-2` en dimension 3072, un index en mémoire HNSW (`hnswlib-node`) avec métrique $L_2$, une persistance transactionnelle duale dans `mediaDB/` (`media_vectors.dat` + `media_embeddings.json`), et un moteur de recherche cross-modale texte/image/fichier.

---

## 2. Table des Matières Diátaxis du Domaine

Chaque sous-système est documenté selon le triplet Diátaxis standard :

| Sous-Système | Explication Conceptuelle (*Why / Concepts*) | Référence Technique (*What / Contracts*) | Guide Pratique (*How-To / Recipes*) |
| :--- | :--- | :--- | :--- |
| **SS-18 : Multi-Tier Hybrid Memory** | [`hybrid-memory-explanation.md`](./hybrid-memory-explanation.md) | [`hybrid-memory-reference.md`](./hybrid-memory-reference.md) | [`hybrid-memory-howto.md`](./hybrid-memory-howto.md) |
| **SS-19 : MAPLE & Dream Reflection** | [`maple-dream-reflection-explanation.md`](./maple-dream-reflection-explanation.md) | [`maple-dream-reflection-reference.md`](./maple-dream-reflection-reference.md) | [`maple-dream-reflection-howto.md`](./maple-dream-reflection-howto.md) |
| **SS-20 : Local Multimodal VectorDB** | [`local-vectordb-explanation.md`](./local-vectordb-explanation.md) | [`local-vectordb-reference.md`](./local-vectordb-reference.md) | [`local-vectordb-howto.md`](./local-vectordb-howto.md) |

---

## 3. Cartographie Source $\leftrightarrow$ Documentation

```
src/
├── services/
│   ├── workingMemory.ts          ──┐
│   ├── redisClient.ts            ──┤
│   ├── memory.ts                 ──┼──> SS-18 : hybrid-memory-*.md
│   ├── memory/                   ──┤
│   │   ├── SemanticMemory.ts     ──┤
│   │   ├── MemoryDecay.ts        ──┤
│   │   └── ActionMemory.ts       ──┘
│   │
│   ├── learning/                 ──┐
│   │   └── LearningEngine.ts     ──┤
│   ├── dreamService.ts           ──┤
│   ├── consolidationService.ts   ──┼──> SS-19 : maple-dream-reflection-*.md
│   ├── knowledgeWeaver.ts        ──┤
│   ├── graphMemory.ts            ──┤
│   └── consciousnessService.ts   ──┘
│   │
│   ├── ai/                       ──┐
│   │   ├── MultimodalEmbeddingService.ts
│   │   └── EmbeddingsService.ts  ──┼──> SS-20 : local-vectordb-*.md
│   └── media/                    ──┤
│       ├── MediaIndexer.ts       ──┤
│       └── MediaSearch.ts        ──┘
```

---

## 4. Relations Inter-Domaines

- **Domaine 1 (Cœur & Orchestration)** : `BotCore` consomme `workingMemory` et `TieredContextLoader` (SS-22) pour hydrater le prompt unifié à chaque tour de dialogue.
- **Domaine 2 (Fournisseurs IA & Routage)** : `MemoryDecay` et `DreamService` invoquent `providerRouter` (SS-12) via les recettes de service `FAST_CHAT` et `DREAM_SERVICE`.
- **Domaine 3 (Transports)** : `TransportManager` (SS-15) alimente `workingMemory.trackMessage` pour ajuster en direct la stratégie de citation/mention.
- **Domaine 5 (Runtime & Sécurité)** : `RuntimeSentinel` (SS-21) valide l'admissibilité des actions avant leur enregistrement dans `ActionMemory`.
- **Domaine 6 (Plugins & Dev Tools)** : `PluginLoader` (SS-25) utilise les embeddings d'outils synchronisés par `DreamService` (`bot_tools`) pour le RAG de sélection d'outils.

---

## 5. Navigation Inter-Domaines

- **Index Central du Dépôt :** [`../00_index.md`](../00_index.md)
- **Domaine 1 (Cœur & Orchestration) :** [`../core/index.md`](../core/index.md)
- **Domaine 2 (Fournisseurs d'IA & Routage) :** [`../providers/index.md`](../providers/index.md)
- **Domaine 3 (Transports & Passerelles) :** [`../transport/index.md`](../transport/index.md)
- **Domaine 5 (Runtime, Sécurité & Contexte) :** [`../runtime/index.md`](../runtime/index.md)
- **Domaine 6 (Plugins & Dev Tools) :** [`../plugins/index.md`](../plugins/index.md)
