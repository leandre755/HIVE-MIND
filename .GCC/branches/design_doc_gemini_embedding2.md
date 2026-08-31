# Design Doc — Gemini Embedding 2 (Multimodal Indexing)

**Date**: 2026-06-03
**Status**: Approved
**Epic**: Gemini Embedding 2

---

## 1. Objectif

Implémenter l'indexation multimodale (images, vidéos, audio, PDF) via Gemini Embedding 2, permettant à l'agent de rechercher des fichiers media par similarité sémantique croisée (texte → image, image → image, texte → vidéo, etc.).

**Contraintes fondamentales** :
- **Indépendant** de l'embedding texte existant (`gemini-embedding-001`, 1024 dims)
- **Pas de Supabase** — stockage local en JSON + index HNSW
- **Dossier dédié** `/mediaDB/` à la racine du projet

---

## 2. État actuel

| Composant | État |
|-----------|------|
| Embeddings texte | `EmbeddingsService` — `gemini-embedding-001` (1024 dims), fallback OpenAI |
| Stockage | 4 tables Supabase avec `embedding vector(1024)` : `memories`, `agent_workspace`, `entities`, `bot_tools` |
| Retrieval | 3 RPC PostgreSQL : `match_memories`, `match_workspace`, `match_tools` |
| Fichiers media | Téléchargés via transports (Baileys/Discord/Telegram), stockés dans `storage_hm/`, jamais vectorisés |
| Multimodal chat | Images envoyées en base64 au LLM, pas d'embedding |

---

## 3. Gemini Embedding 2 — Spécifications

| Caractéristique | Valeur |
|----------------|--------|
| Modèle | `gemini-embedding-2` (GA depuis 2026-04-22) |
| Dimensions | **3072** (choisi pour qualité maximale) |
| Modalités | Texte (8192 tokens), Images (6/requête, PNG/JPEG), Vidéo (120s, MP4/MOV), Audio (80s, MP3/WAV), PDF (6 pages) |
| Interleaved input | Oui — combiner text+image dans une seule requête |
| Prix | ~$0.20/M tokens |
| API | REST — même endpoint que `gemini-embedding-001` |

---

## 4. Architecture proposée

### 4.1 Séparation des responsabilités

```
┌─────────────────────────────────────────────┐
│  EmbeddingsService (EXISTANT — INCHANGÉ)    │
│  gemini-embedding-001, 1024 dims            │
│  → memories, agent_workspace, entities,     │
│    bot_tools (Supabase)                     │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│  MultimodalEmbeddingService (NOUVEAU)       │
│  gemini-embedding-2, 3072 dims              │
│  → /mediaDB/ (JSON + HNSW local)           │
└─────────────────────────────────────────────┘
```

### 4.2 Stockage local — `/mediaDB/`

```
/mediaDB/
├── media_embeddings.json    ← métadonnées (id, path, modality, mime, summary, metadata)
├── media_vectors.dat        ← index HNSW (vecteurs 3072 dims, format binaire)
└── media_vectors.dat.meta   ← métadonnées HNSW (auto-généré par hnswlib-node)
```

**Format JSON** (`media_embeddings.json`) :
```json
{
  "version": 1,
  "dimensions": 3072,
  "entries": [
    {
      "id": "uuid",
      "contextId": "uuid",
      "filePath": "storage_hm/media/photo.jpg",
      "fileName": "photo.jpg",
      "modality": "image",
      "mimeType": "image/jpeg",
      "fileSize": 245000,
      "contentSummary": "Photo d'un restaurant avec des plat",
      "metadata": { "width": 1920, "height": 1080 },
      "createdAt": "2026-06-03T10:00:00Z"
    }
  ]
}
```

### 4.3 Nouveaux fichiers

| Fichier | Rôle |
|---------|------|
| `src/services/ai/MultimodalEmbeddingService.ts` | Client Gemini Embedding 2 (REST) + gestion HNSW |
| `src/services/media/MediaIndexer.ts` | Détection modality, indexation, stockage |
| `src/services/media/MediaSearch.ts` | Recherche cross-modale via HNSW |
| `src/mediaDB/` | Dossier de stockage (créé au boot si absent) |

### 4.4 Interfaces

```typescript
// MultimodalEmbeddingService.ts
interface MultimodalEmbeddingConfig {
  geminiKey: string;
  dimensions?: number;  // défaut: 3072
  dbPath?: string;      // défaut: ./mediaDB
}

interface MediaInput {
  type: 'text' | 'image' | 'video' | 'audio' | 'document';
  data: string;          // texte OU chemin de fichier
  mimeType?: string;
}

interface MultimodalEmbeddingResult {
  embedding: number[];
  dimensions: number;
}

interface IMultimodalEmbeddingService {
  embedText(text: string): Promise<number[] | null>;
  embedImage(imagePath: string): Promise<number[] | null>;
  embedVideo(videoPath: string): Promise<number[] | null>;
  embedAudio(audioPath: string): Promise<number[] | null>;
  embedDocument(docPath: string): Promise<number[] | null>;
  embedInterleaved(inputs: MediaInput[]): Promise<number[] | null>;
}
```

```typescript
// MediaIndexer.ts
interface MediaFile {
  filePath: string;
  fileName: string;
  modality: 'image' | 'video' | 'audio' | 'document';
  mimeType: string;
  fileSize: number;
}

interface IndexingResult {
  fileId: string;
  filePath: string;
  modality: string;
  success: boolean;
  error?: string;
}

interface IMediaIndexer {
  indexFile(contextId: string, filePath: string): Promise<IndexingResult>;
  indexDirectory(contextId: string, dirPath: string): Promise<IndexingResult[]>;
  getModality(filePath: string): MediaFile['modality'];
}
```

```typescript
// MediaSearch.ts
interface MediaSearchResult {
  id: string;
  filePath: string;
  fileName: string;
  modality: string;
  mimeType: string;
  contentSummary: string | null;
  metadata: Record<string, unknown>;
  similarity: number;
}

interface IMediaSearch {
  searchByText(contextId: string, query: string, limit?: number, threshold?: number): Promise<MediaSearchResult[]>;
  searchByImage(contextId: string, imagePath: string, limit?: number, threshold?: number): Promise<MediaSearchResult[]>;
  searchByFile(contextId: string, filePath: string, limit?: number, threshold?: number): Promise<MediaSearchResult[]>;
}
```

---

## 5. Dépendances

| Package | Version | Rôle |
|---------|---------|------|
| `hnswlib-node` | ^3.0.0 | Index HNSW pour recherche vectorielle locale |

**Pré-requis build** : gcc, g++, make, node-gyp (✅ tous disponibles sur la machine)

---

## 6. Flux d'utilisation

### 6.1 Indexation d'un fichier media reçu sur WhatsApp

```
1. Transport reçoit media (image/vidéo/audio/doc)
2. Transport télécharge dans storage_hm/
3. MediaIndexer.indexFile(contextId, filePath)
   a. Détection modality (extension + MIME)
   b. MultimodalEmbeddingService.embedImage/embedVideo/...
   c. Ajout dans media_embeddings.json + HNSW index
4. Fichier indexé, searchable par similarité
```

### 6.2 Recherche cross-modale

```
1. User: "montre-moi les photos du restaurant"
2. core/index.ts → MultimodalEmbeddingService.embedText(query)
3. MediaSearch.searchByText(contextId, query)
4. HNSW searchKnn → résultats triés par distance L2
5. Résultats retournés au LLM avec chemins fichiers
```

---

## 7. Risques et mitigations

| Risque | Impact | Mitigation |
|--------|--------|------------|
| Coût API Gemini Embedding 2 | Moyen | Indexation sélective, pas de batch gratuit |
| Espace disque (fichiers media + index) | Élevé | Politique de rétention, nettoyage auto |
| RAM (HNSW 3072 dims) | Moyen | ~12 KB/vector + overhead graph. 10k fichiers ≈ 500 MB max |
| Latence embedding vidéo/audio | Moyen | Traitement asynchrone |
| hnswlib-node compilation | Faible | gcc/g++/make disponibles, testé |
| Crash JSON (pas de transaction) | Faible | Écriture atomique (tmp + rename) |

---

## 8. Plan d'implémentation

### Phase 1 — Fondations
1. Installer `hnswlib-node`
2. Créer `MultimodalEmbeddingService.ts` — client REST Gemini Embedding 2 + wrapper HNSW
3. Créer `/mediaDB/` + logique d'init au boot
4. Tests unitaires du service

### Phase 2 — Indexation
5. Créer `MediaIndexer.ts` — détection modality + indexation
6. Intégrer dans les transports (réception media → indexation auto)
7. Tests d'intégration

### Phase 3 — Recherche
8. Créer `MediaSearch.ts` — recherche cross-modale via HNSW
9. Exposer search dans les plugins (admin/memory)
10. Tests E2E

### Phase 4 — Polish
11. Extraction summary LLM pour images
12. Politique de rétention
13. Documentation
