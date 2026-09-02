# Comment Configurer et Exploiter la Mémoire Hybride Multi-Niveaux (L1 Redis + L2 pgvector + MemoryDecay)

Ce guide pratique détaille la procédure pas-à-pas pour initialiser, peupler, interroger et nettoyer la mémoire hybride de HIVE-MIND, ainsi que pour gérer les actions en cours et exécuter les cycles d'oubli cognitif.

---

## Prérequis

- Node.js $\ge 22.0.0$ (ESM natif).
- Dépendances du projet installées (`npm install`).
- Base de données Supabase accessible avec extension `pgvector` et fonctions RPC `match_memories` / `cma_boost_memory` configurées (ou environnement de test avec mocks).
- Serveur Redis actif ou exécution automatique via `InMemoryRedisMock`.

---

## Étapes de Réalisation

### 1. Initialiser le Contexte de Travail L1 et Enregistrer des Messages

Alimentez la mémoire de travail immédiate d'un chat via `workingMemory.addMessage`.

```typescript
import { workingMemory } from '../src/services/workingMemory.js';

// Enregistrement d'un tour de dialogue utilisateur avec identification de l'émetteur
await workingMemory.addMessage(
  '120363040000000000@g.us',
  'user',
  'Bonjour, nous devons finaliser le déploiement avant la deadline de vendredi !',
  'usr_a1b2',
  'Alex',
);

// Enregistrement de la réponse de l'agent
await workingMemory.addMessage(
  '120363040000000000@g.us',
  'assistant',
  'Entendu Alex, je vérifie la configuration de production et les scripts de build.',
);

// Lecture du contexte actif (limité aux 15 derniers messages par défaut)
const recentContext = await workingMemory.getContext('120363040000000000@g.us', 10);
console.log(`Nombre de messages chargés : ${recentContext.length}`);
```

---

### 2. Suivre la Vélocité Conversationnelle et Adapter la Stratégie de Réponse

Enregistrez chaque message entrant dans le tracker de vélocité pour déterminer si une citation ou une mention est requise.

```typescript
import { workingMemory } from '../src/services/workingMemory.js';

const chatId = '120363040000000000@g.us';
const senderId = 'user_9876@s.whatsapp.net';

// 1. Tracer le message dans la fenêtre glissante de 60 secondes
await workingMemory.trackMessage(chatId, senderId);

// 2. Récupérer la stratégie de réponse calculée
const strategy = await workingMemory.getReplyStrategy(chatId);

console.log(`Stratégie : Citer = ${strategy.useQuote}, Mentionner = ${strategy.useMention}`);
console.log(`Raison : ${strategy.reason}`);
```

---

### 3. Démarrer et Mettre à Jour un Plan d'Action Multi-Tours (`ActionMemory`)

Lorsqu'une tâche longue est initiée, persistez son état dans `ActionMemory` pour permettre sa reprise en cas d'interruption.

```typescript
import { actionMemory } from '../src/services/memory/ActionMemory.js';

const chatId = '120363040000000000@g.us';

// 1. Démarrer une nouvelle action avec contexte et priorité
const actionId = await actionMemory.startAction(chatId, {
  type: 'database_migration',
  goal: 'Appliquer les migrations pgvector sur Supabase',
  priority: 9,
  context: { targetVersion: '20260901_schema' },
});

console.log(`Action démarrée avec l'ID : ${actionId}`);

// 2. Enregistrer une étape franchie
await actionMemory.updateStep(chatId, 'Sauvegarde préalable de la table memories effectuée');

// 3. Formater l'action active pour injection dans le prompt système
const promptSnippet = await actionMemory.formatForPrompt(chatId);
console.log(promptSnippet);

// 4. Clôturer l'action avec succès
await actionMemory.completeAction(chatId, { status: 'SUCCESS', migratedRows: 1420 });
```

---

### 4. Stocker et Rechercher des Souvenirs Sémantiques L2 (`SemanticMemory`)

Persistez des connaissances à long terme et interrogez la base vectorielle via recherche sémantique avec renforcement automatique (CMA).

```typescript
import { SemanticMemory } from '../src/services/memory/SemanticMemory.js';
import { EmbeddingsService } from '../src/services/ai/EmbeddingsService.js';
import { supabase } from '../src/services/supabase.js';

// Instanciation du service avec dépendances injectées
const embeddings = new EmbeddingsService({
  geminiKey: process.env.GEMINI_API_KEY,
});

const semanticMemory = new SemanticMemory({
  supabase: supabase!,
  embeddings,
});

const chatId = '120363040000000000@g.us';

// 1. Stocker un souvenir important
await semanticMemory.store(
  chatId,
  "L'administrateur a configuré le déploiement automatique sur Railway avec GitHub Actions.",
  'assistant',
);

// 2. Rechercher les souvenirs pertinents par similarité cosinus
const results = await semanticMemory.recall(chatId, 'Comment est déployée la production ?', 3);

for (const memory of results) {
  console.log(`[Similarité: ${memory.similarity.toFixed(2)}] ${memory.content}`);
}
```

---

### 5. Exécuter un Cycle d'Oubli Cognitif et de Consolidation en Gists (`MemoryDecay`)

Déclenchez le calcul des scores d'Ebbinghaus pour archiver les souvenirs anciens et synthétiser les Gists.

```typescript
import { memoryDecay } from '../src/services/memory/MemoryDecay.js';

const chatId = '120363040000000000@g.us';

// 1. Exécuter le cycle de décroissance sur le chat cible
const result = await memoryDecay.decay(chatId);
console.log(`Traité: ${result.processed}, Archivé: ${result.archived}, Conservé: ${result.kept}`);

// 2. Consulter les statistiques de rétention globales
const stats = await memoryDecay.getStats(chatId);
if (stats) {
  console.log(`Total: ${stats.total}, Actifs: ${stats.active}, Taux de rétention: ${stats.retention}`);
}
```

---

## Cas Particuliers & Variantes

### Variante A : Exécution en Mode Test Isolé (Sans Serveur Redis)
Pour exécuter les tests sans instance Redis externe, définissez la variable `APP_ENV=local`. Le client basculera automatiquement sur `InMemoryRedisMock`.

```typescript
process.env.APP_ENV = 'local';
import { workingMemory } from '../src/services/workingMemory.js';

await workingMemory.addMessage('test_chat', 'user', 'Test in-memory');
const messages = await workingMemory.getContext('test_chat');
console.assert(messages.length === 1);
```

### Variante B : Gestion de l'Anti-Suppression de Messages (`trackDeletedMessage`)
Lorsqu'un message est supprimé par un utilisateur sur WhatsApp, capturez son contenu pour audit :

```typescript
await workingMemory.trackDeletedMessage('120363040000000000@g.us', 'msg_abc123', {
  sender: 'user_42@s.whatsapp.net',
  senderName: 'Bob',
  text: 'Message supprimé contenant des identifiants sensibles',
  timestamp: Date.now() - 5000,
});

const deleted = await workingMemory.getDeletedMessages('120363040000000000@g.us', 5);
console.log(`Dernier message supprimé : ${deleted[0]?.text}`);
```

---

## Vérification & Validation

Exécutez la suite de tests unitaires Jest pour vérifier le bon fonctionnement du système de mémoire hybride :

```bash
NODE_ENV=test SUPABASE_URL=http://localhost:54321 SUPABASE_KEY=dummy REDIS_URL=redis://localhost:6379 NODE_OPTIONS='--experimental-vm-modules --no-warnings' npx jest src/tests/unit/services/MemoryDecay.test.ts --forceExit
```

Sortie attendue dans le terminal :
```text
PASS src/tests/unit/services/MemoryDecay.test.ts
  MemoryDecaySystem
    scoreMemory
      ✓ should score recent memories with high retention (12 ms)
      ✓ should decay old memories with low recall count (10 ms)
      ✓ should boost score for critical keywords (promis, deadline, important) (11 ms)
    decay
      ✓ should archive decayed memories and trigger Gist consolidation (25 ms)

Test Suites: 1 passed, 1 total
Tests:       4 passed, 4 total
Snapshots:   0 total
```

---

## Guide de Dépannage (Troubleshooting)

| Symptôme / Message d'Erreur | Cause Probable | Solution Immédiate |
| :--- | :--- | :--- |
| `Redis : Abandon de connexion en mode local` | Serveur Redis non lancé sur `localhost:6379` en local. | Comportement normal si `APP_ENV=local` : le système bascule sur le mock in-memory. Pour utiliser un vrai serveur, lancez `redis-server` ou configurez `REDIS_URL`. |
| `[Memory] Vectorization failed, memory not stored.` | Clé d'API Gemini manquante ou quota d'embeddings dépassé. | Vérifier la présence de `GEMINI_API_KEY` dans le fichier `.env` ou `credentials.json`. |
| `[ActionMemory] Action not found in Supabase` | L'action a été créée il y a plus de 7 jours ou a été supprimée par le nettoyeur d'orphelins. | Réinitialiser une nouvelle action via `actionMemory.startAction(chatId, {...})`. |
| `[CMA] Error boosting memories: function match_memories does not exist` | Schéma PostgreSQL ou migration Supabase non appliquée. | Appliquer la migration SQL `supabase/migrations/20260519130000_cma_boost_memory.sql`. |
