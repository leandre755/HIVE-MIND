# Base de Données Vectorielle Multimodale Locale — Architecture & Principes de Fonctionnement

Le sous-système **Local Multimodal Vector Database (SS-20)** constitue un moteur d'indexation et de recherche vectorielle cross-modale haute performance, fonctionnant entièrement en mémoire et sur disque local sans dépendance à une infrastructure vectorielle cloud externe (telle que Pinecone, Qdrant ou Weaviate).

---

## 1. Contexte & Problématique d'Ingénierie

Dans un système multi-canal opérant avec des flux variés (WhatsApp, Discord, Telegram), l'agent échange quotidiennement des fichiers multimédias hétérogènes : captures d'écran, diagrammes d'architecture, photographies, mémos vocaux, extraits vidéo et documents PDF. L'exploitation sémantique de ces contenus pose des contraintes strictes :

1. **Rupture de Modalité** : Les bases de données vectorielles textuelles classiques nécessitent une transcription préliminaire (OCR, Speech-to-Text) avant vectorisation, entraînant une perte d'information visuelle ou acoustique contextuelle.
2. **Dépendance Cloud & Latence** : Transmettre chaque fichier multimédia vers un service vectoriel hébergé introduit une surcharge réseau importante, des coûts d'ingestion récurrents et un risque de dépendance fournisseur (*vendor lock-in*).
3. **Résilience aux Arrêts Brutaux (Crash-Tolerance)** : Les écritures d'index volumineux sur disque risquent une corruption irrémédiable si le processus est interrompu pendant la sérialisation binaire (`SIGINT`, `SIGTERM`, OOM).
4. **Dimensionnalité et Précision de Recherche** : L'alignement multimodal nécessite un espace vectoriel unifié à haute dimensionnalité capable de projeter du texte, des pixels et des ondes audio dans le même manifold latent.

Le sous-système SS-20 répond à ces exigences en combinant l'API d'embeddings natifs de Google (`gemini-embedding-2` en dimension 3072), un index en mémoire basé sur l'algorithme HNSW (*Hierarchical Navigable Small World* via `hnswlib-node`), et un format de persistance transactionnelle duale sur disque dans `mediaDB/`.

---

## 2. Modèle Mental & Architecture Conceptuelle

L'architecture locale articule la vectorisation multimodale externe et l'indexation locale in-process :

```
+-----------------------------------------------------------------------------------------+
|                  BASE VECTORIELLE MULTIMODALE LOCALE (SS-20)                            |
+-----------------------------------------------------------------------------------------+
                                             |
                   +-------------------------+-------------------------+
                   |                                                   |
                   v                                                   v
+------------------------------------+               +------------------------------------+
|       INGESTION & VECTORISATION    |               |       INDEXATION & PERSISTANCE     |
|   (MultimodalEmbeddingService)     |               |          (mediaDB/ & HNSW)         |
+------------------------------------+               +------------------------------------+
| - Détection de modalité & MIME :   |               | - Index HNSW in-memory             |
|   * Image (JPG, PNG, WebP, GIF)    |               |   (hnswlib-node, métrique L2,      |
|   * Vidéo (MP4, MKV, WebM, MOV)    |               |    dimension 3072)                 |
|   * Audio (MP3, WAV, OGG, FLAC)    |               | - Capacité dynamique extensible    |
|   * Document (PDF)                 |               |   (_ensureHnswCapacity)            |
|   * Interleaved (Texte + Fichiers) |               | - Persistance duale transaction-   |
| - Appel Gemini Embedding 2 :       |               |   nelle :                          |
|   * Modèle: gemini-embedding-2     |               |   * media_vectors.dat (HNSW binaire|
|   * Sortie: vecteur 3072 dimensions|               |   * media_embeddings.json (métas)  |
| - Résumé visuel auto (Gemini Flash)|               | - Écriture atomique (tmp + rename) |
+------------------------------------+               | - Hooks d'arrêt SIGINT/SIGTERM     |
                   |                                 +------------------------------------+
                   +───────────────────────────────────────────────────+
                                             |
                                             v
+-----------------------------------------------------------------------------------------+
|                     MOTEUR DE RECHERCHE CROSS-MODALE (MediaSearch)                      |
+-----------------------------------------------------------------------------------------+
| - Requête Texte -> Médias (searchByText)                                                |
| - Requête Image -> Médias similaires (searchByImage)                                    |
| - Requête Fichier -> Médias similaires (searchByFile)                                   |
| - Filtrage par contextId et seuil de similarité cosinus (défaut: 0.5)                   |
+-----------------------------------------------------------------------------------------+
```

### 2.1. Vectorisation Multimodale Directe
Le service convertit les fichiers locaux en tampons binaires Base64 transmis directement à l'API `gemini-embedding-2`. Contrairement aux approches en pipeline (OCR $\rightarrow$ Embedding), le modèle projette directement les caractéristiques visuelles, acoustiques ou textuelles dans un espace dense de 3072 dimensions.

### 2.2. Indexation en Mémoire HNSW (`hnswlib-node`)
- Maintient un graphe HNSW à couches hiérarchiques configuré avec la métrique de distance euclidienne $L_2$.
- Permet des recherches $k$-NN avec complexité en temps logarithmique $O(\log N)$.
- Intègre un mécanisme d'extension dynamique (`_ensureHnswCapacity`) : si le nombre d'éléments indexés dépasse la capacité allouée, un nouvel index HNSW de capacité doublée est initialisé et les points existants y sont transférés sans interruption de service.

### 2.3. Persistance Duale Transactionnelle (`mediaDB/`)
L'état de la base repose sur deux fichiers synchronisés sous le répertoire `mediaDB/` :
1. `media_vectors.dat` : Fichier binaire brut généré par `hnsw.writeIndexSync()`.
2. `media_embeddings.json` : Fichier JSON contenant la liste ordonnée des métadonnées `MediaEntry` (identifiant UUID, chemin du fichier, modalité, type MIME, taille, résumé textuel, horodatage, métadonnées libres).

Toutes les écritures JSON utilisent le pattern de sauvegarde atomique : écriture dans un fichier temporaire `media_embeddings.json.tmp` suivie d'un renommage atomique synchrone via `safeRenameSync()`.

### 2.4. Crochets d'Arrêt Système (Shutdown Hooks)
Pour parer aux interruptions imprévues, `MultimodalEmbeddingService` enregistre un crochet d'arrêt global sur les événements Node.js `exit`, `SIGINT` et `SIGTERM`. Tout service portant des données non sauvegardées (`dirty === true`) force la sérialisation immédiate sur disque avant la libération du processus.

---

## 3. Choix de Conception & Raisons d'Ingénierie

### 3.1. Métrique de Distance $L_2$ et Dérivation Cosinus

Pour un vecteur requête $\mathbf{q} \in \mathbb{R}^D$ et un vecteur indexé $\mathbf{v}_i \in \mathbb{R}^D$ avec $D = 3072$, `hnswlib-node` calcule la distance euclidienne carrée :

$$d_{L2}(\mathbf{q}, \mathbf{v}_i) = \sum_{j=1}^{D} (q_j - v_{i,j})^2$$

Les représentations retournées par l'API `gemini-embedding-2` étant préalablement normalisées sur la sphère unité ($\|\mathbf{q}\|_2 = \|\mathbf{v}_i\|_2 = 1.0$), le développement de la distance euclidienne s'écrit :

$$d_{L2}(\mathbf{q}, \mathbf{v}_i) = \|\mathbf{q}\|_2^2 + \|\mathbf{v}_i\|_2^2 - 2 \langle \mathbf{q}, \mathbf{v}_i \rangle = 2 - 2 \cos(\mathbf{q}, \mathbf{v}_i)$$

D'où l'équivalence exacte pour la similarité cosinus $\operatorname{Sim}(\mathbf{q}, \mathbf{v}_i) \in [0, 1]$ :

$$\operatorname{Sim}(\mathbf{q}, \mathbf{v}_i) = 1 - \frac{d_{L2}(\mathbf{q}, \mathbf{v}_i)}{2} \approx 1 - d_{L2}(\mathbf{q}, \mathbf{v}_i)$$

Le sous-système applique un seuil de filtrage par défaut $\theta_{\text{search}} = 0.5$.

### 3.2. Séparation Stricte entre Index Vectoriel et Métadonnées
Les vecteurs flottants de 3072 dimensions ne sont pas stockés dans le JSON de métadonnées pour éviter l'explosion de la taille des fichiers texte et le surcoût de parsing JSON. L'index binaire HNSW stocke uniquement les labels numériques (`0, 1, 2, ...`), qui servent d'index de tableau direct dans la collection `entries` du fichier JSON.

### 3.3. Politique de Rétention et Purge Automatique (`MediaIndexer.applyRetention`)
Pour éviter l'accumulation indéfinie de fichiers médias sur le disque de l'hôte, `MediaIndexer` applique une double règle d'éviction :
1. **Plafond d'Âge** : Suppression de toute entrée dont la date de création excède `RETENTION_DAYS = 30` jours.
2. **Plafond de Contexte** : Limitation stricte à `MAX_ENTRIES_PER_CONTEXT = 500` fichiers par contexte/chat. Les entrées les plus anciennes sont évincées en priorité.

---

## 4. Analyse Comparative & Alternatives Écartées

| Approche Alternative | Avantages Théoriques | Inconvénients / Raisons du Rejet par HIVE-MIND |
| :--- | :--- | :--- |
| **Base Vectorielle Cloud (Pinecone, Qdrant)** | Scalabilité distribuée horizontale. | Latence réseau d'ingestion élevée, coût d'abonnement cloud, indisponible en mode 100% offline. |
| **Scan Linéaire Plat (Brute-Force $O(N)$)** | Zéro index HNSW à maintenir. | Temps de recherche inacceptable dès que le nombre de médias dépasse quelques centaines d'éléments. |
| **Pipeline OCR + Transcription Textuelle** | Utilise des embeddings texte classiques (1024d). | Incapable de capturer le style visuel, les graphiques sans texte ou la tonalité audio ; latence d'ingestion multipliée par 3. |

---

## 5. Frontières Architecturales & Invariants

### Ce qui est DANS le périmètre de SS-20 :
- Détection automatique de la modalité et du type MIME des fichiers locaux.
- Vectorisation multimodale (texte, image, vidéo, audio, PDF, interleaved) via `gemini-embedding-2`.
- Gestion du graphe HNSW local et persistance dans `mediaDB/`.
- Recherche $k$-NN cross-modale (texte $\rightarrow$ média, image $\rightarrow$ média, fichier $\rightarrow$ média).
- Génération de résumés visuels en tâche de fond pour les images (`gemini-2.0-flash`).
- Application de la politique de rétention (30 jours, 500 entrées/contexte).

### Ce qui est EXCLU et délégué aux autres couches :
- **Mémoire conversationnelle textuelle L1/L2** : Déléguée à `workingMemory` et `SemanticMemory` (SS-18).
- **Stockage physique des fichiers bruts** : Géré par le système de fichiers hôte (`safeFs.ts`) ou les dossiers de session.
- **Extraction d'entités de graphe** : Déléguée à `KnowledgeWeaver` (SS-19).

---

## 6. Liens & Navigation

- **Référence Technique :** [`local-vectordb-reference.md`](./local-vectordb-reference.md)
- **Guide Pratique d'Intégration :** [`local-vectordb-howto.md`](./local-vectordb-howto.md)
- **Index du Domaine :** [`index.md`](./index.md)
