# Cognitive & Knowledge Synthesis Engine (MAPLE & Dream) — Référence Technique

Description factuelle et exhaustive des interfaces, classes, signatures de méthodes et schémas du moteur d'apprentissage et de synthèse cognitive (MAPLE, Dream, Knowledge Weaver, Graph Memory, Consciousness).

- **Fichiers sources :**
  - `src/services/learning/LearningEngine.ts` (Moteur MAPLE & routage de compétences)
  - `src/services/dreamService.ts` (Module de réflexion hors-ligne & `lessons_learned.md`)
  - `src/services/consolidationService.ts` (Consolidation périodique multi-sessions)
  - `src/services/knowledgeWeaver.ts` (Tissage sémantique de graphe)
  - `src/services/graphMemory.ts` (Persistance et parcours d'entités/relations)
  - `src/services/consciousnessService.ts` (Espace de travail global GWT & émotions)
- **Conteneur IoC :** `ServiceContainer.get('learning')`, `ServiceContainer.get('consciousness')`
- **Dépendances majeures :** `src/providers/index.js`, `src/services/memory.js`, `src/services/supabase.js`, `@supabase/supabase-js`

---

## 1. Interfaces & Types TypeScript

```typescript
// --- MAPLE Learning Engine (src/services/learning/LearningEngine.ts) ---

export interface ExtractedInsight {
  readonly type: 'fact' | 'pref' | 'goal' | string;
  readonly key: string;
  readonly value: string;
}

export interface SkillDefinition {
  readonly name: string;
  readonly description: string;
  readonly path: string;
  readonly yamlBlock: string;
}

// --- Knowledge Weaver (src/services/knowledgeWeaver.ts) ---

export interface KnowledgeEntity {
  name: string;
  type?: string;
  description?: string;
}

export interface KnowledgeRelationship {
  source: string;
  target: string;
  type: string;
}

export interface KnowledgeGraphData {
  entities?: KnowledgeEntity[];
  relationships?: KnowledgeRelationship[];
}

// --- Graph Memory (src/services/graphMemory.ts) ---

export interface EntityData {
  name: string;
  type?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface UpsertEntityResult {
  id: string;
  chat_id: string;
  name: string;
  type: string;
  description: string;
  metadata: Record<string, unknown>;
  embedding: number[];
  updated_at: string;
}

export interface RelationshipResult {
  id: string;
  chat_id: string;
  source_id: string;
  target_id: string;
  relation_type: string;
  strength: number;
}

export interface NeighborResult {
  relation_type: string;
  strength: number;
  target: {
    id: string;
    name: string;
    type: string;
    description: string;
  } | null;
}

// --- Consciousness & GWT (src/services/consciousnessService.ts) ---

export interface BotIdentity {
  name: string;
  jid: string | null;
  lid: string | null;
  phoneNumber: string | null;
}

export interface BotMissionResult {
  title: string | null;
  description: string | null;
  author: string | null;
}

export interface GlobalState {
  identity: BotIdentity;
  emotionalState: {
    annoyance: number;
    mood: string;
  };
  mission: BotMissionResult | null;
  activeMemory: string[];
  uptime: number;
}
```

---

## 2. Modules & Signatures de Méthodes

### 2.1. `learningEngine` (`src/services/learning/LearningEngine.ts`)

Objet singleton exposant les fonctionnalités de profilage MAPLE et de routage de compétences.

#### Méthodes
```typescript
async extractInsights(chatId: string): Promise<void>
```
Lit les 20 derniers messages du contexte L1, vérifie la présence d'au moins 4 messages, émet l'événement `SERVICE_START`, interroge un modèle rapide (`FAST_CHAT`, température 0.1) avec le prompt de classification MAPLE, parse la réponse JSON, et enregistre les faits sous la clé `${type}:${key}` dans `factsMemory`. Émet `SERVICE_END` en bloc `finally`.

```typescript
async getAllExpertSkills(): Promise<SkillDefinition[]>
```
Scanne le répertoire `skills/` (en excluant le dossier `survival`), lit chaque `SKILL.md` (ou `skill.md`), extrait et parse le bloc frontmatter YAML, et retourne la liste des définitions disponibles.

```typescript
async routeSkills(userMessage: string, chatId: string): Promise<{ yamlBlock: string; comments: string[] } | null>
```
Interroge le classificateur IA pour identifier si une compétence experte répond à `userMessage`. Si une compétence est sélectionnée, génère des recommandations personnalisées via `getCommentsForSkill`.

```typescript
async getCommentsForSkill(skillName: string, chatId: string, userMessage: string): Promise<string[]>
```
Récupère les préférences de l'utilisateur commençant par `pref:` dans `factsMemory` et produit 1 à 2 conseils actionnables pour guider l'agent lors de l'exécution de la compétence.

---

### 2.2. `dreamService` (`src/services/dreamService.ts`)

Module d'auto-réflexion et d'apprentissage par l'échec.

#### Méthodes
```typescript
async dream(): Promise<void>
```
Lit le fichier `persona/lessons_learned.md`, extrait les 10 dernières erreurs de `agentMemory`, invoque la recette de service `DREAM_SERVICE` avec un réessai à backoff exponentiel (3 tentatives : 5 s, 10 s, 20 s), écrit le fichier de leçons révisé et synchronise les embeddings des outils (`syncToolEmbeddings`).

```typescript
async syncToolEmbeddings(): Promise<void>
```
Parcourt les outils enregistrés dans la table Supabase `bot_tools` et génère/met à jour leurs embeddings vectoriels sur la chaîne `${tool.definition.name}: ${tool.definition.description}` pour alimenter le sélecteur d'outils par RAG.

```typescript
getLessons(): string
```
Retourne le contenu textuel brut de `persona/lessons_learned.md`.

```typescript
async getRecentErrors(): Promise<string[]>
```
Récupère les 10 dernières erreurs documentées dans `AgentMemory` sous la forme `[nom_outil] message_erreur`.

---

### 2.3. `knowledgeWeaver` (`src/services/knowledgeWeaver.ts`)

Extracteur de connaissances structurées sous forme de graphe.

#### Méthodes
```typescript
async weave(chatId: string, text: string): Promise<void>
```
Ignore les textes $< 10$ caractères. Invoque le modèle de génération structurée (`kimi-for-coding` à température 0.1) pour extraire les entités et relations, puis exécute les upserts par lot via `graphMemory.upsertEntitiesBatch` et `graphMemory.addRelationshipsBatch`.

---

### 2.4. `graphMemory` (`src/services/graphMemory.ts`)

Interface de persistance et de navigation dans le Knowledge Graph.

#### Méthodes
```typescript
async upsertEntity(chatId: string, entity: EntityData): Promise<UpsertEntityResult | null>
```
Insère ou met à jour une entité dans la table `entities` (conflit sur `chat_id, name`) avec son vecteur sémantique calculé sur `${entity.name}: ${entity.description}`.

```typescript
async addRelationship(chatId: string, sourceName: string, targetName: string, relationType: string, strength?: number): Promise<RelationshipResult | null>
```
Résout les identifiants de `sourceName` et `targetName` pour le chat donné, puis upsert la relation dans la table `relationships` (conflit sur `source_id, target_id, relation_type`).

```typescript
async upsertEntitiesBatch(chatId: string, entities: EntityData[]): Promise<Map<string, string>>
```
Vectorise en parallèle et insère un lot d'entités. Retourne une table de correspondance `name -> id`.

```typescript
async addRelationshipsBatch(chatId: string, relationships: Array<{ source: string; target: string; type: string; strength?: number }>): Promise<void>
```
Résout par lot les noms d'entités en identifiants uniques et insère les relations associées.

```typescript
async searchEntities(chatId: string, query: string, limit?: number): Promise<UpsertEntityResult[]>
```
Recherche les entités similaires à `query` via la fonction SQL RPC `match_entities` (seuil 0.7).

```typescript
async getNeighbors(entityId: string): Promise<NeighborResult[]>
```
Retourne toutes les entités cibles directement reliées à `entityId` depuis la table `relationships`.

---

### 2.5. `consciousness` (`src/services/consciousnessService.ts`)

Gestionnaire de l'espace de travail global et de l'état émotionnel.

#### Méthodes
```typescript
async setIdentity(user: { id: string; lid?: string } | null): Promise<void>
```
Initialise les attributs de `botIdentity` (`jid`, `lid`, `phoneNumber`, `name`) et enregistre le profil dans la base de données.

```typescript
async getGlobalState(chatId: string, senderJid: string): Promise<GlobalState>
```
Capture le snapshot complet de l'esprit du bot : identité, état émotionnel, mission de groupe active, 3 derniers souvenirs sémantiques et temps de fonctionnement (`uptime` en secondes).

```typescript
async updateAnnoyance(chatId: string, userId: string, delta: number): Promise<number>
```
Modifie la valeur d'agacement dans Redis (`consciousness:{chatId}:{userId}:annoyance`, bornée entre 0 et 100, TTL 3600 s) et journalise les sauts d'humeur importants ($\ge 10$ ou $> 50$).

```typescript
async getAnnoyance(chatId: string, userId: string): Promise<number>
```
Lit la valeur actuelle d'agacement depuis Redis (retourne 0 par défaut).

---

## 3. Schéma de Configuration & Variables d'Environnement

| Variable d'Environnement | Type | Défaut | Obligatoire | Description |
| :--- | :--- | :--- | :--- | :--- |
| `GEMINI_API_KEY` | `string` | — | Conditionnel | Utilisé pour la vectorisation du graphe et les inférences d'insights. |
| `OPENAI_API_KEY` | `string` | — | Conditionnel | Clé de secours pour les embeddings et les synthèses. |
| `SUPABASE_URL` | `string` | — | Oui | Accès aux tables `facts`, `entities`, `relationships`, `bot_tools`. |
| `SUPABASE_KEY` | `string` | — | Oui | Clé d'authentification de la base Supabase. |

---

## 4. Codes d'Erreur & États Internes

| Code / Symptôme | Cause / Condition | Comportement Système |
| :--- | :--- | :--- |
| `[MAPLE] Erreur extraction` | Échec de l'appel LLM ou syntaxe JSON invalide. | Le cycle d'extraction se termine silencieusement sans corrompre `factsMemory`. |
| `[DreamService] ⚠️ Tentative X/3 échouée` | Erreur d'accès à l'API LLM lors du rêve. | Application d'un délai exponentiel ($5 \times 2^{\text{retries}}$ s) avant nouvelle tentative. |
| `[GraphMemory] Relation impossible: Entité(s) non trouvée(s)` | La source ou la cible de la relation n'a pas été insérée au préalable. | L'insertion de la relation est annulée et retourne `null`. |
| `updateAnnoyance is DEPRECATED` | Appel hérité sur `workingMemory.ts`. | Lève une exception explicite orientant vers `consciousnessService`. |

---

## 5. Exemple d'Utilisation Minimal

```typescript
import { learningEngine } from '../src/services/learning/LearningEngine.js';
import { knowledgeWeaver } from '../src/services/knowledgeWeaver.js';
import { graphMemory } from '../src/services/graphMemory.js';
import { consciousness } from '../src/services/consciousnessService.js';

// 1. Extraire des insights d'un dialogue
await learningEngine.extractInsights('chat_dev_group');

// 2. Tisser un graphe de connaissances à partir d'un échange
await knowledgeWeaver.weave(
  'chat_dev_group',
  'Alex développe le harnais d agent HIVE-MIND en TypeScript strict sur Railway.',
);

// 3. Rechercher des entités dans le graphe
const entities = await graphMemory.searchEntities('chat_dev_group', 'Alex');
if (entities.length > 0) {
  const neighbors = await graphMemory.getNeighbors(entities[0].id);
  console.log(`Voisins de ${entities[0].name} :`, neighbors);
}

// 4. Mettre à jour l'agacement et obtenir l'état global
await consciousness.updateAnnoyance('chat_dev_group', 'user_troublemaker', 25);
const state = await consciousness.getGlobalState('chat_dev_group', 'user_troublemaker');
console.log(`Humeur actuelle du bot : ${state.emotionalState.mood}`);
```

---

## 6. Limitations & Invariants Opérationnels

- **Seuil Minimal de Messages pour MAPLE** : Requiert au moins 4 messages dans `workingMemory` pour déclencher une extraction d'insights afin d'éviter le surcoût de tokens sur des échanges trop courts.
- **Atomicité des Relations de Graphe** : Les arêtes relationnelles sont protégées par une contrainte d'unicité PostgreSQL `onConflict: 'source_id,target_id,relation_type'`, empêchant toute duplication d'arête.
- **Bornes Strictes d'Émotion** : La variable d'agacement (`annoyance`) est strictement contrainte dans l'intervalle $[0, 100]$.
