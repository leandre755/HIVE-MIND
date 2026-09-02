# Comment Extraire des Profils Cognitifs (MAPLE), Tisser un Graphe de Connaissances et Déclencher le Cycle de Rêve

Ce guide pratique décrit la démarche opérationnelle pour extraire automatiquement des insights utilisateurs avec le moteur MAPLE, router des compétences expertes, construire un graphe de connaissances relationnel et exécuter le cycle de réflexion périodique (Dream).

---

## Prérequis

- Node.js $\ge 22.0.0$ (ESM natif).
- Dépendances du projet installées (`npm install`).
- Base de données Supabase accessible avec tables `facts`, `entities`, `relationships`, `bot_tools` et procédure `match_entities` (ou environnement de test avec mocks).
- Clé d'API configurée (`GEMINI_API_KEY` ou provider équivalent dans `credentials.json`).

---

## Étapes de Réalisation

### 1. Extraire des Insights Cognitifs avec MAPLE (`learningEngine`)

Alimentez la mémoire de travail puis déclenchez l'extraction d'insights classifiés en faits, préférences et objectifs.

```typescript
import { workingMemory } from '../src/services/workingMemory.js';
import { learningEngine } from '../src/services/learning/LearningEngine.js';
import { factsMemory } from '../src/services/memory.js';

const chatId = 'chat_dev_session_42';

// 1. Peupler le contexte avec au moins 4 messages significatifs
await workingMemory.addMessage(chatId, 'user', 'Je m appelle Thomas et je code principalement en TypeScript et Rust.');
await workingMemory.addMessage(chatId, 'assistant', 'Enchanté Thomas. Préfères-tu des réponses synthétiques avec du code ou des explications pas à pas ?');
await workingMemory.addMessage(chatId, 'user', 'Des réponses très courtes, uniquement le code avec les types complets. Je déteste le blabla.');
await workingMemory.addMessage(chatId, 'assistant', 'Parfait, je retiens ce format.');

// 2. Déclencher l'extraction non-supervisée
await learningEngine.extractInsights(chatId);

// 3. Vérifier les faits persistés
const allFacts = await factsMemory.getAll(chatId);
console.log('Faits et préférences appris :', allFacts);
```

---

### 2. Découvrir et Router des Compétences Expertes Dynamiques

Interrogez le moteur de routage pour sélectionner la compétence experte la plus adaptée à une requête utilisateur.

```typescript
import { learningEngine } from '../src/services/learning/LearningEngine.js';

const chatId = 'chat_dev_session_42';
const userQuery = 'Peux-tu m aider à optimiser les performances de ma requête SQL ?';

// 1. Sélectionner dynamiquement la compétence experte et obtenir des conseils personnalisés
const routeResult = await learningEngine.routeSkills(userQuery, chatId);

if (routeResult) {
  console.log('Bloc YAML de la compétence injectée :');
  console.log(routeResult.yamlBlock);

  console.log('Conseils personnalisés générés d après les préférences de l utilisateur :');
  routeResult.comments.forEach((comment) => console.log(`- ${comment}`));
} else {
  console.log('Aucune compétence spécifique requise pour cette requête.');
}
```

---

### 3. Tisser et Interroger le Knowledge Graph (`knowledgeWeaver` & `graphMemory`)

Extrayez des entités et relations typées à partir de descriptions textuelles et naviguez dans le graphe.

```typescript
import { knowledgeWeaver } from '../src/services/knowledgeWeaver.js';
import { graphMemory } from '../src/services/graphMemory.js';

const chatId = 'team_architecture_chat';

// 1. Extraire le réseau d'entités et relations
await knowledgeWeaver.weave(
  chatId,
  'Thomas travaille sur le module HIVE-MIND-CORE avec Sarah. Ils utilisent Redis et Supabase pour la persistance.',
);

// 2. Rechercher une entité par similarité vectorielle
const searchResults = await graphMemory.searchEntities(chatId, 'Thomas', 1);

if (searchResults.length > 0) {
  const thomas = searchResults[0];
  console.log(`Entité trouvée : ${thomas.name} (${thomas.type}) - ${thomas.description}`);

  // 3. Explorer les connexions topologiques directes (voisins)
  const neighbors = await graphMemory.getNeighbors(thomas.id);
  console.log(`Relations de ${thomas.name} :`);
  neighbors.forEach((n) => {
    if (n.target) {
      console.log(`  --[${n.relation_type} (force: ${n.strength})]--> ${n.target.name} (${n.target.type})`);
    }
  });
}
```

---

### 4. Déclencher le Cycle d'Auto-Réflexion Nocturne (`dreamService`)

Exécutez le cycle de rêve pour analyser les erreurs récentes consignées dans `AgentMemory` et consolider les règles d'action dans `lessons_learned.md`.

```typescript
import { dreamService } from '../src/services/dreamService.js';

// 1. Exécuter le cycle d'introspection
console.log('Lancement du cycle de rêve...');
await dreamService.dream();

// 2. Consulter les leçons consolidées
const lessons = dreamService.getLessons();
console.log('Contenu actuel de persona/lessons_learned.md :');
console.log(lessons);
```

---

### 5. Gérer l'État Émotionnel et l'Espace de Travail Global (`consciousness`)

Ajustez le niveau d'agacement d'un utilisateur et capturez le snapshot cognitif de l'agent.

```typescript
import { consciousness } from '../src/services/consciousnessService.js';

const chatId = 'support_channel';
const userId = 'user_impatient@s.whatsapp.net';

// 1. Augmenter le niveau d'agacement suite à des requêtes répétitives agressives
await consciousness.updateAnnoyance(chatId, userId, 35);

// 2. Récupérer le snapshot de conscience global
const globalState = await consciousness.getGlobalState(chatId, userId);

console.log(`Identité : ${globalState.identity.name}`);
console.log(`Score d'agacement : ${globalState.emotionalState.annoyance}/100`);
console.log(`Humeur dérivée : ${globalState.emotionalState.mood}`);
console.log(`Uptime démon : ${globalState.uptime} secondes`);
```

---

## Cas Particuliers & Variantes

### Variante A : Insertion Manuelle d'Entités et d'Arêtes par Lot
Lorsque des métadonnées statiques de projet doivent être chargées à l'initialisation :

```typescript
import { graphMemory } from '../src/services/graphMemory.js';

const chatId = 'workspace_init';

// 1. Insertion par lot des entités
const entityMap = await graphMemory.upsertEntitiesBatch(chatId, [
  { name: 'Node22', type: 'Technology', description: 'Runtime JavaScript natif ESM' },
  { name: 'TypeScript', type: 'Language', description: 'Langage typé compilé' },
]);

// 2. Déclaration des arêtes
await graphMemory.addRelationshipsBatch(chatId, [
  { source: 'Node22', target: 'TypeScript', type: 'supporte', strength: 1.0 },
]);
```

---

## Vérification & Validation

Exécutez la suite de tests unitaires Jest pour vérifier le bon fonctionnement du moteur d'apprentissage :

```bash
NODE_ENV=test SUPABASE_URL=http://localhost:54321 SUPABASE_KEY=dummy REDIS_URL=redis://localhost:6379 NODE_OPTIONS='--experimental-vm-modules --no-warnings' npx jest src/tests/unit/services/LearningEngine.test.ts --forceExit
```

Sortie attendue dans le terminal :
```text
PASS src/tests/unit/services/LearningEngine.test.ts
  learningEngine
    extractInsights
      ✓ should skip extraction when context is under 4 messages (10 ms)
      ✓ should extract fact, pref, and goal insights and store them (35 ms)
    getAllExpertSkills
      ✓ should read SKILL.md frontmatters correctly (18 ms)
    routeSkills
      ✓ should route query to matching skill and return comments (22 ms)

Test Suites: 1 passed, 1 total
Tests:       4 passed, 4 total
Snapshots:   0 total
```

---

## Guide de Dépannage (Troubleshooting)

| Symptôme / Message d'Erreur | Cause Probable | Solution Immédiate |
| :--- | :--- | :--- |
| `[MAPLE] Erreur extraction: JSON parse error` | Le modèle IA a retourné du texte libre autour du tableau JSON. | Vérifier la méthode de fallback `tryParseJson` qui extrait les crochets `[...]` délimitants. |
| `[DreamService] ❌ Échec après 3 tentatives` | Endpoint du modèle de service `DREAM_SERVICE` inaccessible. | Vérifier la connectivité réseau et les quotas de l'API provider dans `ServiceRegistry`. |
| `[GraphMemory] Relation impossible: Entité(s) non trouvée(s)` | `addRelationship` appelée avant que les entités source/cible ne soient insérées. | Utiliser `knowledgeWeaver.weave` qui garantit l'upsert préalable des entités avant l'insertion des arêtes. |
| `updateAnnoyance error: Redis client not ready` | Serveur Redis déconnecté lors de la mise à jour émotionnelle. | S'assurer que `redisClient.ts` est connecté ou que `APP_ENV=local` est configuré. |
