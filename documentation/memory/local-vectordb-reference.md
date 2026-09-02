# Local Multimodal Vector Database — Référence Technique

Description factuelle et exhaustive des interfaces, classes, signatures de méthodes et schémas de la base de données vectorielle multimodale locale (Gemini Embedding 2 + HNSW local + MediaIndexer + MediaSearch).

- **Fichiers sources :**
  - `src/services/ai/MultimodalEmbeddingService.ts` (Moteur vectoriel HNSW & API Gemini Embedding 2)
  - `src/services/ai/EmbeddingsService.ts` (Service d'embeddings texte 1024d)
  - `src/services/media/MediaIndexer.ts` (Indexeur de répertoires & politique de rétention)
  - `src/services/media/MediaSearch.ts` (Interface de recherche cross-modale de haut niveau)
- **Conteneur IoC :** `ServiceContainer.get('multimodalEmbeddings')`, `ServiceContainer.get('mediaIndexer')`
- **Dépendances majeures :** `hnswlib-node`, `src/utils/safeFs.ts`, `crypto` (randomUUID), `node-fetch` / `fetch` natif

---

## 1. Interfaces & Types TypeScript

```typescript
// --- Multimodal Embedding Service (src/services/ai/MultimodalEmbeddingService.ts) ---

export type MediaModality = 'image' | 'video' | 'audio' | 'document' | 'text';

export interface MultimodalEmbeddingConfig {
  geminiKey: string;
  dimensions?: number; // Défaut: 3072
  dbPath?: string;     // Défaut: join(process.cwd(), 'mediaDB')
}

export interface MediaInput {
  type: MediaModality;
  data: string;        // Texte brut ou chemin de fichier local
  mimeType?: string;
}

export interface MediaEntry {
  id: string;
  contextId: string;
  filePath: string;
  fileName: string;
  modality: MediaModality;
  mimeType: string;
  fileSize: number;
  contentSummary: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface MediaSearchResult {
  id: string;
  filePath: string;
  fileName: string;
  modality: string;
  mimeType: string;
  contentSummary: string | null;
  metadata: Record<string, unknown>;
  similarity: number;
}

// --- Media Indexer (src/services/media/MediaIndexer.ts) ---

export interface IndexingResult {
  fileId: string;
  filePath: string;
  modality: MediaModality;
  success: boolean;
  error?: string;
}

// --- Text Embeddings (src/services/ai/EmbeddingsService.ts) ---

export interface EmbeddingConfig {
  geminiKey?: string;
  openaiKey?: string;
  model?: string;      // Défaut: 'gemini-embedding-001'
  dimensions?: number; // Défaut: 1024
}

export interface IEmbeddingsService {
  embed(text: string): Promise<number[] | null>;
}
```

---

## 2. Fonctions Utilitaires Exportées

```typescript
export function detectModality(filePath: string): MediaModality
```
Détecte la modalité du fichier d'après son extension (.jpg, .png $\rightarrow$ `'image'`, .mp4, .mkv $\rightarrow$ `'video'`, .mp3, .wav $\rightarrow$ `'audio'`, .pdf $\rightarrow$ `'document'`, autre $\rightarrow$ `'text'`).

```typescript
export function detectMimeType(filePath: string): string
```
Retourne le type MIME canonique d'après l'extension du fichier (ex. `image/png`, `video/mp4`, `audio/ogg`, `application/pdf`, `application/octet-stream`).

---

## 3. Classes & Signatures de Méthodes

### 3.1. `MultimodalEmbeddingService` (`src/services/ai/MultimodalEmbeddingService.ts`)

#### Constructeur
```typescript
constructor(config: MultimodalEmbeddingConfig)
```
| Paramètre | Type | Obligatoire | Défaut | Description |
| :--- | :--- | :--- | :--- | :--- |
| `config.geminiKey` | `string` | Oui | — | Clé API Google Gemini. |
| `config.dimensions` | `number` | Non | `3072` | Dimensionnalité des vecteurs générés. |
| `config.dbPath` | `string` | Non | `process.cwd() + '/mediaDB'` | Répertoire local de persistance. |

#### Méthodes de Cycle de Vie
```typescript
public init(): void
```
Crée le répertoire `mediaDB/` si absent, charge `media_embeddings.json`, initialise ou charge l'index binaire `media_vectors.dat` et enregistre les hooks d'arrêt `SIGINT`, `SIGTERM` et `exit`.

```typescript
public save(): void
```
Écrit atomiquement le fichier JSON (`.tmp` puis renommage) et sérialise l'index HNSW sur disque. Réinitialise le flag `dirty` à `false`.

```typescript
public getEntryCount(): number
```
Retourne le nombre total d'entrées multimédias enregistrées.

#### Méthodes de Vectorisation
```typescript
public async embedText(text: string): Promise<number[] | null>
public async embedImage(imagePath: string): Promise<number[] | null>
public async embedVideo(videoPath: string): Promise<number[] | null>
public async embedAudio(audioPath: string): Promise<number[] | null>
public async embedDocument(docPath: string): Promise<number[] | null>
public async embedInterleaved(inputs: MediaInput[]): Promise<number[] | null>
```
Génèrent un vecteur de 3072 dimensions en appelant le modèle `gemini-embedding-2`. Si la taille du fichier dépasse 20 Mo (`MAX_INLINE_BYTES`), l'opération est refusée et retourne `null`.

#### Méthodes d'Indexation & Recherche
```typescript
public addEntry(entry: Omit<MediaEntry, 'id' | 'createdAt'>, embedding: number[]): string
```
Génère un UUID, insère l'entrée dans le tableau de métadonnées, étend la capacité HNSW si nécessaire via `_ensureHnswCapacity`, et insère le point dans l'index. Marque `dirty = true` et retourne l'UUID.

```typescript
public search(queryEmbedding: number[], contextId: string, limit?: number, threshold?: number): MediaSearchResult[]
```
Exécute une recherche $k$-NN sur le graphe HNSW ($k = \min(\text{limit} \times 3, N)$), convertit la distance $L_2$ en similarité cosinus ($1 - \text{distance}$), filtre par `contextId` et seuil de similarité (défaut : `threshold = 0.5`), et retourne au plus `limit` résultats.

```typescript
public getEntry(id: string): MediaEntry | undefined
public removeEntry(id: string): boolean
public removeEntries(ids: string[]): number
public getContextEntries(contextId: string): MediaEntry[]
public updateEntrySummary(id: string, summary: string): boolean
public getEntriesOlderThan(dateISO: string): MediaEntry[]
```
Opérations d'accès, de mise à jour de résumé et de suppression d'entrées. La suppression reconstruit la table d'indexation interne (`_rebuildEntryIndex`).

---

### 3.2. `MediaIndexer` (`src/services/media/MediaIndexer.ts`)

#### Constructeur
```typescript
constructor(embeddingService: MultimodalEmbeddingService, geminiKey?: string)
```

#### Méthodes
```typescript
public async indexFile(contextId: string, filePath: string): Promise<IndexingResult>
```
Détecte la modalité, vérifie l'existence du fichier, génère l'embedding via `MultimodalEmbeddingService`, ajoute l'entrée, déclenche la sauvegarde sur disque, et lance de façon asynchrone non-bloquante l'extraction de résumé visuel par Gemini Flash (`_extractSummary`).

```typescript
public async indexDirectory(contextId: string, dirPath: string): Promise<IndexingResult[]>
```
Scanne un répertoire local (non-récursif, plafonné à 50 fichiers) et indexe chaque fichier non-textuel.

```typescript
public async previewEmbedding(filePath: string): Promise<number[] | null>
```
Calcule le vecteur d'un fichier sans l'ajouter à l'index (utile pour les tests et la validation de formats).

```typescript
public applyRetention(): number
```
Supprime les fichiers datant de plus de 30 jours (`RETENTION_DAYS`) et élague les contextes dépassant 500 entrées (`MAX_ENTRIES_PER_CONTEXT`). Retourne le nombre total d'entrées supprimées.

---

### 3.3. `MediaSearch` (`src/services/media/MediaSearch.ts`)

Façade d'interrogation de haut niveau simplifiant les requêtes cross-modales.

#### Méthodes
```typescript
public async searchByText(contextId: string, query: string, limit?: number, threshold?: number): Promise<MediaSearchResult[]>
public async searchByImage(contextId: string, imagePath: string, limit?: number, threshold?: number): Promise<MediaSearchResult[]>
public async searchByFile(contextId: string, filePath: string, limit?: number, threshold?: number): Promise<MediaSearchResult[]>
```
Vectorisent la requête (texte, image ou fichier multimédia) et invoquent la recherche HNSW sous-jacente.

---

## 4. Schéma de Configuration & Variables d'Environnement

| Variable d'Environnement | Type | Défaut | Obligatoire | Description |
| :--- | :--- | :--- | :--- | :--- |
| `GEMINI_API_KEY` | `string` | — | Oui | Clé d'API principale pour `gemini-embedding-2` et les résumés visuels. |
| `GOOGLE_API_KEY` | `string` | — | Non | Alias de secours pour `GEMINI_API_KEY`. |
| `OPENAI_API_KEY` | `string` | — | Non | Utilisé pour le repli dans `EmbeddingsService` (texte 1024d). |

---

## 5. Formats de Fichiers Internes (`mediaDB/`)

### Structure du Fichier `media_embeddings.json`
```json
{
  "version": 1,
  "dimensions": 3072,
  "entries": [
    {
      "id": "e4b2d184-729c-48c1-8409-5e74c83f982a",
      "contextId": "120363040000000000@g.us",
      "filePath": "/home/omni/Code/HIVE-MIND/storage_hm/media/screenshot_deploy.png",
      "fileName": "screenshot_deploy.png",
      "modality": "image",
      "mimeType": "image/png",
      "fileSize": 204850,
      "contentSummary": "Capture d écran montrant le dashboard Railway avec un déploiement vert réussi.",
      "metadata": {},
      "createdAt": "2026-09-01T12:00:00.000Z"
    }
  ]
}
```

---

## 6. Codes d'Erreur & États Internes

| Code / Message d'Erreur | Cause Déclenchante | Comportement Système |
| :--- | :--- | :--- |
| `[MediaDB] Gemini API key missing` | `geminiKey` vide ou absent de la configuration | Retourne `null`, aucune vectorisation n'est tentée. |
| `[MediaDB] File too large: ... (> 20MB)` | Fichier dépassant la limite de 20 Mo en Base64 | L'ingestion est rejetée et retourne `null`. |
| `[MediaIndexer] Unsupported modality for: ...` | Fichier détecté comme `'text'` brut | Retourne `IndexingResult` avec `success: false`. |
| `[MediaDB] HNSW init failed` | Fichier binaire `media_vectors.dat` corrompu ou illisible | L'index est réinitialisé avec une capacité neuve. |

---

## 7. Exemple d'Utilisation Minimal

```typescript
import { MultimodalEmbeddingService } from '../src/services/ai/MultimodalEmbeddingService.js';
import { MediaIndexer } from '../src/services/media/MediaIndexer.js';
import { MediaSearch } from '../src/services/media/MediaSearch.js';

// 1. Initialiser le service vectoriel multimodal
const embeddingService = new MultimodalEmbeddingService({
  geminiKey: process.env.GEMINI_API_KEY!,
  dimensions: 3072,
  dbPath: './mediaDB',
});
embeddingService.init();

// 2. Instancier l'indexeur et le moteur de recherche
const indexer = new MediaIndexer(embeddingService, process.env.GEMINI_API_KEY);
const searcher = new MediaSearch(embeddingService);

const chatId = '120363040000000000@g.us';

// 3. Indexer une image locale
const indexResult = await indexer.indexFile(chatId, './test_diagram.png');
console.log(`Fichier indexé avec succès : ${indexResult.success} (ID: ${indexResult.fileId})`);

// 4. Rechercher par requête textuelle
const results = await searcher.searchByText(chatId, 'diagramme d architecture système', 5, 0.6);
for (const match of results) {
  console.log(`[Score: ${match.similarity.toFixed(2)}] ${match.fileName} (${match.modality})`);
}

// 5. Sauvegarder explicitement l'index
embeddingService.save();
```

---

## 8. Limitations & Invariants Opérationnels

- **Dimension Fixe** : Strictement 3072 dimensions pour `gemini-embedding-2`.
- **Plafond Fichier In-Memory** : Fichiers plafonnés à 20 Mo pour éviter les saturations de mémoire vive Node.js.
- **Atomicité de Sérialisation** : Les métadonnées JSON sont toujours enregistrées avec l'extension temporaire `.tmp` avant renommage atomique via `safeRenameSync`.
