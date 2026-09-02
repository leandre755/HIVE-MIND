# Comment Indexer et Rechercher des Médias Multimodaux avec HNSW Local et Gemini Embedding 2

Ce guide pratique détaille la procédure pas-à-pas pour initialiser la base vectorielle locale dans `mediaDB/`, indexer des images, audios, vidéos ou documents PDF, effectuer des recherches cross-modales et appliquer les politiques de rétention.

---

## Prérequis

- Node.js $\ge 22.0.0$ (ESM natif).
- Dépendances du projet installées (`npm install`), incluant `hnswlib-node`.
- Clé d'API Google Gemini (`GEMINI_API_KEY`) pour l'accès au modèle `gemini-embedding-2`.
- Répertoire d'indexation accessible en lecture/écriture (`mediaDB/`).

---

## Étapes de Réalisation

### 1. Initialiser le Service Multimodal et Créer la Base Locale

Instanciez et démarrez `MultimodalEmbeddingService` avec le répertoire de persistance local.

```typescript
import { MultimodalEmbeddingService } from '../src/services/ai/MultimodalEmbeddingService.js';
import { join } from 'path';

// 1. Définir la configuration
const embeddingService = new MultimodalEmbeddingService({
  geminiKey: process.env.GEMINI_API_KEY || '',
  dimensions: 3072,
  dbPath: join(process.cwd(), 'mediaDB'),
});

// 2. Initialiser le chargement des fichiers existants ou créer l'index HNSW
embeddingService.init();

console.log(`Nombre total d'entrées indexées : ${embeddingService.getEntryCount()}`);
```

---

### 2. Indexer un Fichier Multimédia Individuel (`MediaIndexer`)

Utilisez `MediaIndexer.indexFile` pour détecter automatiquement la modalité du fichier, calculer son vecteur et persister ses métadonnées.

```typescript
import { MediaIndexer } from '../src/services/media/MediaIndexer.js';
import { MultimodalEmbeddingService } from '../src/services/ai/MultimodalEmbeddingService.js';

const embeddingService = new MultimodalEmbeddingService({
  geminiKey: process.env.GEMINI_API_KEY!,
});
embeddingService.init();

const indexer = new MediaIndexer(embeddingService, process.env.GEMINI_API_KEY);
const contextId = '120363040000000000@g.us';

// Indexation d'une image (détectée automatiquement comme modality = 'image')
const result = await indexer.indexFile(contextId, './storage_hm/media/architecture_schema.png');

if (result.success) {
  console.log(`✅ Fichier indexé avec succès !`);
  console.log(`- ID: ${result.fileId}`);
  console.log(`- Modalité: ${result.modality}`);
  console.log(`- Chemin: ${result.filePath}`);
} else {
  console.error(`❌ Échec de l'indexation : ${result.error}`);
}
```

---

### 3. Indexer un Répertoire Multimédia Complet

Scannez un dossier local contenant plusieurs types de médias (images, mémos audio, vidéos, PDF) et indexez l'ensemble en un seul appel.

```typescript
import { MediaIndexer } from '../src/services/media/MediaIndexer.js';
import { MultimodalEmbeddingService } from '../src/services/ai/MultimodalEmbeddingService.js';

const embeddingService = new MultimodalEmbeddingService({
  geminiKey: process.env.GEMINI_API_KEY!,
});
embeddingService.init();

const indexer = new MediaIndexer(embeddingService);
const contextId = '120363040000000000@g.us';

// Indexe jusqu'à 50 fichiers non-textuels présents dans le dossier cible
const batchResults = await indexer.indexDirectory(contextId, './storage_hm/media/');

const successCount = batchResults.filter((r) => r.success).length;
console.log(`Total indexé : ${successCount}/${batchResults.length} fichiers.`);
```

---

### 4. Effectuer une Recherche Cross-Modale Texte $\rightarrow$ Médias (`MediaSearch`)

Recherchez des images, vidéos ou documents pertinents à partir d'une simple requête textuelle naturelle.

```typescript
import { MediaSearch } from '../src/services/media/MediaSearch.js';
import { MultimodalEmbeddingService } from '../src/services/ai/MultimodalEmbeddingService.js';

const embeddingService = new MultimodalEmbeddingService({
  geminiKey: process.env.GEMINI_API_KEY!,
});
embeddingService.init();

const mediaSearch = new MediaSearch(embeddingService);
const contextId = '120363040000000000@g.us';

// Recherche par texte avec seuil de similarité minimal de 0.6
const matches = await mediaSearch.searchByText(
  contextId,
  'graphique montrant les métriques de latence de production',
  5,    // Limite à 5 résultats
  0.6,  // Seuil de similarité cosinus
);

console.log(`Résultats trouvés : ${matches.length}`);
matches.forEach((m, idx) => {
  console.log(`[#${idx + 1}] ${m.fileName} (${m.modality}) - Similarité: ${m.similarity.toFixed(3)}`);
  if (m.contentSummary) {
    console.log(`     Résumé: ${m.contentSummary}`);
  }
});
```

---

### 5. Rechercher par Similitude d'Image (Image $\rightarrow$ Image)

Retrouvez des fichiers visuellement ou conceptuellement proches d'une image de référence fournie par l'utilisateur.

```typescript
import { MediaSearch } from '../src/services/media/MediaSearch.js';
import { MultimodalEmbeddingService } from '../src/services/ai/MultimodalEmbeddingService.js';

const embeddingService = new MultimodalEmbeddingService({
  geminiKey: process.env.GEMINI_API_KEY!,
});
embeddingService.init();

const mediaSearch = new MediaSearch(embeddingService);
const contextId = '120363040000000000@g.us';

// Recherche d'images similaires à une capture reçue
const similarImages = await mediaSearch.searchByImage(
  contextId,
  './storage_hm/incoming/query_screenshot.png',
  3,
  0.7,
);

similarImages.forEach((img) => {
  console.log(`Image similaire : ${img.fileName} (Score: ${img.similarity.toFixed(2)})`);
});
```

---

### 6. Appliquer la Politique de Rétention et de Nettoyage

Purgez automatiquement les fichiers anciens ou en excès dans l'index local.

```typescript
import { MediaIndexer } from '../src/services/media/MediaIndexer.js';
import { MultimodalEmbeddingService } from '../src/services/ai/MultimodalEmbeddingService.js';

const embeddingService = new MultimodalEmbeddingService({
  geminiKey: process.env.GEMINI_API_KEY!,
});
embeddingService.init();

const indexer = new MediaIndexer(embeddingService);

// Supprime les entrées datant de > 30 jours et élague les contextes à > 500 entrées
const removedCount = indexer.applyRetention();
console.log(`Nettoyage effectué : ${removedCount} entrées purgées.`);
```

---

## Cas Particuliers & Variantes

### Variante A : Entrées Entrelacées Multi-Sources (Interleaved Input)
Pour générer un vecteur combinant à la fois un texte descriptif et plusieurs fichiers :

```typescript
const vector = await embeddingService.embedInterleaved([
  { type: 'text', data: 'Voici le schéma de déploiement commenté :' },
  { type: 'image', data: './storage_hm/media/schema.png' },
]);
console.log(`Vecteur entrelacé calculé : ${vector?.length} dimensions`);
```

---

## Vérification & Validation

Exécutez la suite de tests unitaires Jest pour vérifier le bon fonctionnement de la base vectorielle multimodale :

```bash
NODE_ENV=test SUPABASE_URL=http://localhost:54321 SUPABASE_KEY=dummy REDIS_URL=redis://localhost:6379 NODE_OPTIONS='--experimental-vm-modules --no-warnings' npx jest src/tests/unit/services/MultimodalEmbeddingService.test.ts src/tests/unit/services/MediaIndexer.test.ts src/tests/unit/services/MediaSearch.test.ts --forceExit
```

Sortie attendue dans le terminal :
```text
PASS src/tests/unit/services/MultimodalEmbeddingService.test.ts
  MultimodalEmbeddingService
    detectModality
      ✓ should detect image modalities (11 ms)
      ✓ should detect video modalities (2 ms)
      ✓ should detect audio modalities (3 ms)
      ✓ should detect document modalities (2 ms)
      ✓ should default to text for unknown extensions (2 ms)
    detectMimeType
      ✓ should return correct MIME types (3 ms)
      ✓ should return fallback for unknown (2 ms)
    constructor + init
      ✓ should create instance and init with empty DB (141 ms)
      ✓ should load existing entries on init (21 ms)
    embedText
      ✓ should return null for empty text (12 ms)
      ✓ should call Gemini Embedding 2 API and return vector (15 ms)
      ✓ should return null on API error (16 ms)
      ✓ should return null on network error (11 ms)
      ✓ should return null without API key (13 ms)
  MultimodalEmbeddingService entries
    addEntry
      ✓ should add entry with vector (13 ms)
      ✓ should assign unique ids (12 ms)
    removeEntry
      ✓ should remove entry by id (16 ms)
      ✓ should return false for nonexistent id (16 ms)
    getContextEntries
      ✓ should filter by contextId (18 ms)
    save
      ✓ should write JSON atomically (tmp + rename) (15 ms)

Test Suites: 3 passed, 3 total
Tests:       32 passed, 32 total
Snapshots:   0 total
```

---

## Guide de Dépannage (Troubleshooting)

| Symptôme / Message d'Erreur | Cause Probable | Solution Immédiate |
| :--- | :--- | :--- |
| `[MediaDB] Gemini API key missing` | `geminiKey` non fourni à l'instanciation de `MultimodalEmbeddingService`. | Définir la variable d'environnement `GEMINI_API_KEY` ou la passer explicitement dans le constructeur. |
| `[MediaDB] File too large: ... (> 20MB)` | Le fichier à vectoriser dépasse la taille maximale autorisée en Base64 (20 Mo). | Compresser l'image ou tronquer la vidéo/audio avant d'appeler l'indexation. |
| `[MediaIndexer] Unsupported modality for: ...` | L'extension du fichier correspond à un fichier texte brut (.txt, .md, .ts). | Utiliser `SemanticMemory` (SS-18) pour indexer les contenus textuels purs. |
| `[MediaDB] HNSW init failed: Cannot read property ...` | L'index binaire `media_vectors.dat` a été tronqué lors d'un crash système antérieur. | Supprimer `media_vectors.dat` ; le service reconstruira un index vierge à partir de `media_embeddings.json`. |
