# Multi-Tier Hybrid Memory Architecture — Référence Technique

Description factuelle et exhaustive des interfaces, classes, méthodes et configurations composant l'architecture de mémoire hybride (L1 Redis + L2 Supabase pgvector + MemoryDecay + ActionMemory).

- **Fichiers sources :**
  - `src/services/workingMemory.ts` (Mémoire de travail L1 & vélocité)
  - `src/services/redisClient.ts` (Client Redis singleton & mock in-memory)
  - `src/services/memory/SemanticMemory.ts` (Moteur RAG vectoriel long-terme)
  - `src/services/memory/MemoryDecay.ts` (Système d'oubli cognitif & Gists)
  - `src/services/memory/ActionMemory.ts` (Gestion des intentions et plans multi-tours)
  - `src/services/memory.ts` (Façade unifiée `semanticMemory`, `factsMemory`, `workspaceMemory`)
- **Conteneur IoC :** `ServiceContainer.get('workingMemory')`, `ServiceContainer.get('embeddings')`
- **Dépendances majeures :** `redis`, `@supabase/supabase-js`, `src/utils/safeFs.ts`

---

## 1. Interfaces & Types TypeScript

```typescript
// --- Working Memory (src/services/workingMemory.ts) ---

export interface WorkingMemoryMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface StoredMessage {
  sender?: string;
  senderName?: string;
  text?: string;
  mediaType?: string;
  timestamp?: number;
  storedAt: number;
}

export interface DeletedMessageEntry {
  messageId: string;
  sender?: string;
  senderName?: string;
  text?: string;
  mediaType?: string;
  timestamp?: number;
  deletedAt: number;
}

export interface ChatVelocity {
  velocity: number;
  mode: 'calm' | 'solo' | 'active' | 'chaos';
  uniqueSenders: number;
}

export interface ReplyStrategy {
  useQuote: boolean;
  useMention: boolean;
  reason: string;
}

export interface LastInteraction {
  user: string;
  timestamp: number;
}

export interface UserPassport {
  name: string;
  lang: string;
  tz: string;
  topFacts: string[];
}

export interface ToolUsage {
  name: string;
  args_summary: string;
  result_summary: string;
}

export interface ActionTrace {
  turn: number;
  user_query: string;
  tools_used: ToolUsage[];
  response_preview: string;
  timestamp?: number;
}

export interface ActionHistoryEntry {
  turn: number;
  user_query: string;
  tools_used: ToolUsage[];
  response_preview: string;
  timestamp: number;
}

export type AudioPermission = 'all' | 'admins_only' | 'none';

// --- Semantic Memory (src/services/memory/SemanticMemory.ts) ---

export interface IMemoryLogger {
  warn(msg: string): void;
  debug(tag: string, msg: string): void;
  error(msg: string): void;
}

export interface SemanticMemoryDependencies {
  supabase: SupabaseClient;
  embeddings: IEmbeddingsService;
  logger?: IMemoryLogger;
}

export interface MemoryRecord {
  id?: number | string;
  content: string;
  role: string;
  similarity?: number;
  context_id?: string;
  created_at?: string;
  recall_count?: number;
  decay_score?: number;
  archived_at?: string | null;
}

// --- Memory Decay (src/services/memory/MemoryDecay.ts) ---

export interface DecayResult {
  processed: number;
  archived: number;
  kept: number;
  error?: string;
}

export interface DecayStats {
  total: number;
  active: number;
  archived: number;
  avgScore: string;
  retention: string;
}

export interface ScoreComponents {
  recency: number;
  frequency: number;
  importance: number;
}

// --- Action Memory (src/services/memory/ActionMemory.ts) ---

export interface ActionStep {
  step: string;
  timestamp: number;
}

export interface OngoingAction {
  id: string;
  chatId: string;
  type: string;
  goal: string;
  context: Record<string, unknown>;
  priority: number;
  status: 'active' | 'completed' | 'interrupted';
  steps: ActionStep[];
  startedAt: number;
  updatedAt?: number;
  expiresAt?: number;
}

export interface ResumableAction {
  id: string;
  chatId: string;
  type: string;
  params: Record<string, unknown>;
  steps: ActionStep[];
  createdAt: number;
}

// --- Workspace Memory (src/services/memory.ts) ---

export interface WorkspaceRow {
  id?: string;
  content: string;
  tags?: string[];
  access_count?: number;
  variance?: number;
  key?: string;
  updated_at?: string;
  context_id?: string;
}
```

---

## 2. Classes & Signatures de Méthodes

### 2.1. `workingMemory` (`src/services/workingMemory.ts`)

Objet singleton exposant les opérations de mémoire vive L1.

#### Méthodes Principales

```typescript
addMessage(chatId: string, role: 'user' | 'assistant', content: string, speakerHash?: string | null, speakerName?: string | null): Promise<void>
```
Insère un message dans `chat:{chatId}:context`, applique un élagage à 15 éléments (`lTrim(-15, -1)`) et réinitialise l'expiration à 86400 s (24 h).

```typescript
getContext(chatId: string, limit?: number): Promise<WorkingMemoryMessage[]>
```
Récupère les `limit` derniers messages (défaut : 15) pour le chat donné.

```typescript
clearContext(chatId: string): Promise<void>
```
Supprime la clé de contexte L1 pour le chat spécifié.

```typescript
trackMessage(chatId: string, senderId: string): Promise<void>
```
Enregistre la réception d'un message dans le Sorted Set `velocity:{chatId}` (score = timestamp) et le Set `velocity:{chatId}:senders` (TTL = 120 s). Élimine les messages datant de plus de 60 s (`zRemRangeByScore`).

```typescript
getChatVelocity(chatId: string): Promise<ChatVelocity>
```
Calcule le volume de messages sur la dernière minute et le nombre d'émetteurs uniques. Retourne le mode calculé (`solo`, `calm`, `active`, `chaos`).

```typescript
getReplyStrategy(chatId: string, originalMessage?: WorkingMemoryMessage | null): Promise<ReplyStrategy>
```
Détermine si l'agent doit citer le message (`useQuote`) ou mentionner l'utilisateur (`useMention`) en fonction du mode de vélocité.

```typescript
getPassport(sender: string): Promise<UserPassport | null>
setPassport(sender: string, passport: UserPassport): Promise<void>
formatPassport(passport: UserPassport | null): string
```
Gestion du profil utilisateur chaud (TTL = 3600 s) et formatage en ligne pour injection dans le prompt.

```typescript
getScratchpad(chatId: string): Promise<string>
setScratchpad(chatId: string, text: string): Promise<void>
```
Accès au bloc-notes volatile (texte tronqué à 500 caractères max, TTL = 86400 s).

```typescript
addActionTrace(chatId: string, trace: ActionTrace): Promise<void>
getActionHistory(chatId: string, limit?: number): Promise<ActionHistoryEntry[]>
formatActionHistory(history: ActionHistoryEntry[]): string
```
Maintient les 6 dernières traces d'outils invoqués (`action_history:{chatId}`).

---

### 2.2. `SemanticMemory` (`src/services/memory/SemanticMemory.ts`)

Classe gérant la mémoire vectorielle persistante L2.

#### Constructeur
```typescript
constructor(dependencies: SemanticMemoryDependencies)
```
| Paramètre | Type | Obligatoire | Description |
| :--- | :--- | :--- | :--- |
| `dependencies.supabase` | `SupabaseClient` | Oui | Client de base de données Supabase. |
| `dependencies.embeddings` | `IEmbeddingsService` | Oui | Service de vectorisation de texte. |
| `dependencies.logger` | `IMemoryLogger` | Non | Logger optionnel avec niveaux `warn`, `debug`, `error`. |

#### Méthodes
```typescript
public async store(chatId: string, content: string, role: string): Promise<void>
```
Résout l'UUID de contexte, vérifie la non-duplication du contenu, génère l'embedding et insère la ligne dans la table `memories`.

```typescript
public async recall(chatId: string, query: string, limit?: number): Promise<MemoryRecord[]>
```
Vectorise `query`, invoque la fonction SQL RPC `match_memories` (seuil : 0.7, limite par défaut : 5) et déclenche l'amplification CMA asynchrone non-bloquante (`cma_boost_memory`) via `setImmediate`.

```typescript
public async prune(chatId: string, keepLast?: number): Promise<void>
```
Conserve les `keepLast` souvenirs les plus récents (défaut : 50) et supprime les précédents.

---

### 2.3. `MemoryDecaySystem` (`src/services/memory/MemoryDecay.ts`)

Moteur d'application de la courbe d'oubli d'Ebbinghaus et de consolidation cognitive.

#### Méthodes
```typescript
public async scoreMemory(memory: MemoryRecord): Promise<{ score: number; components: ScoreComponents; keep: boolean; ageHours: number }>
```
Calcule le score composite $\mathcal{S}(m) = 0.4 \cdot e^{-\Delta t / 24} + 0.3 \cdot \min(\text{recall}/10, 1) + 0.3 \cdot \mathcal{I}(\text{content})$.

```typescript
public async decay(chatId: string): Promise<DecayResult>
```
Exécute le cycle de vieillissement sur un chat donné : met à jour `decay_score`, archive les souvenirs dont le score est $\le 0.3$ (`archived_at = now()`), et déclenche la synthèse de Gist si $\ge 5$ souvenirs sont archivés.

```typescript
public async decayAll(): Promise<{ chats: number; archived: number; kept: number; error?: string }>
```
Parcourt l'ensemble des contextes actifs des 7 derniers jours et exécute `decay()` sur chacun.

```typescript
public async getStats(chatId?: string | null): Promise<DecayStats | null>
```
Retourne le volume total de souvenirs, le nombre d'actifs, d'archivés, le score moyen et le taux de rétention.

---

### 2.4. `ActionMemory` (`src/services/memory/ActionMemory.ts`)

Gestionnaire des plans d'action multi-tours.

#### Méthodes
```typescript
public async startAction(chatId: string, action: Partial<OngoingAction>): Promise<string | null>
```
Crée une action identifiée par `chatId:timestamp`, l'enregistre dans Redis sous `action:{chatId}` (TTL 3600 s) et consigne l'événement dans la table Supabase `agent_actions`.

```typescript
public async getActiveAction(chatId: string): Promise<OngoingAction | null>
```
Récupère l'action active depuis Redis et reconstruit l'objet typé.

```typescript
public async updateStep(chatId: string, step: string): Promise<boolean>
```
Ajoute une étape horodatée dans `steps` et met à jour Redis + Supabase.

```typescript
public async completeAction(chatId: string, result: unknown): Promise<boolean>
```
Marque l'action `completed`, persiste le résultat et réduit le TTL Redis à 60 s.

```typescript
public async interruptAction(chatId: string, reason: string): Promise<boolean>
```
Marque l'action `interrupted`, stocke la raison et fixe un TTL Redis de 300 s (5 min).

```typescript
public async formatForPrompt(chatId: string): Promise<string>
```
Formate le bloc Markdown `### 🎯 ONGOING ACTION` pour injection dans le prompt de raisonnement.

---

### 2.5. Façade `memory.ts` (`src/services/memory.ts`)

- `semanticMemory` : Instance singleton préconfigurée avec `tagService` et `resolveContextFromLegacyId`.
- `factsMemory` : Gestion des paires clé-valeur de faits immuables dans la table `facts` (`remember`, `get`, `getAll`, `forget`, `format`).
- `workspaceMemory` : Gestion de la mémoire collaborative partagée avec recherche vectorielle dans `agent_workspace` (`write`, `read`, `search`, `delete`, `getKeys`).

---

## 3. Schéma de Configuration & Variables d'Environnement

| Variable d'Environnement | Type | Défaut | Obligatoire | Description |
| :--- | :--- | :--- | :--- | :--- |
| `REDIS_URL` | `string` | `redis://localhost:6379` | Non | URL de connexion au serveur Redis ou Redis Cloud. |
| `SUPABASE_URL` | `string` | — | Oui | URL de l'instance Supabase / PostgreSQL. |
| `SUPABASE_KEY` | `string` | — | Oui | Clé de service ou anon key Supabase. |
| `APP_ENV` | `string` | `development` | Non | Si défini à `local`, bascule immédiatement sur `InMemoryRedisMock`. |
| `GEMINI_API_KEY` | `string` | — | Conditionnel | Requis pour `EmbeddingsService` (modèle `gemini-embedding-001`). |
| `OPENAI_API_KEY` | `string` | — | Conditionnel | Utilisé comme solution de repli si `GEMINI_API_KEY` est absent ou en échec. |

---

## 4. Codes d'Erreur & États Internes

| Code / Symptôme | Cause / Condition | Comportement Système |
| :--- | :--- | :--- |
| `Redis : Abandon de connexion en mode local` | Serveur Redis inaccessible en environnement local | Basculement transparent vers `InMemoryRedisMock` sans lever d'exception bloquante. |
| `[Memory] Could not resolve context ID` | Identifiant de chat absent de la table des contextes | L'opération `store` ou `recall` est ignorée silencieusement. |
| `[CMA] Error boosting memories` | Échec d'exécution de la fonction RPC `cma_boost_memory` | Journalisation de l'erreur dans le logger sans interruption du flux principal. |
| `[ActionMemory] Action not found in Supabase` | Identifiant d'action inconnu lors de la réhydratation | Retourne `false` et l'action ne peut pas être restaurée. |

---

## 5. Exemple d'Utilisation Minimal

```typescript
import { workingMemory } from '../src/services/workingMemory.js';
import { actionMemory } from '../src/services/memory/ActionMemory.js';
import { memoryDecay } from '../src/services/memory/MemoryDecay.js';

// 1. Ajouter des messages dans la mémoire de travail L1
await workingMemory.addMessage('chat_123', 'user', 'Bonjour, j ai une deadline demain !');
await workingMemory.addMessage('chat_123', 'assistant', 'Bien noté, quel est le projet ?');

// 2. Démarrer une action multi-tours
const actionId = await actionMemory.startAction('chat_123', {
  type: 'deploy_service',
  goal: 'Déployer HIVE-MIND sur Railway',
  priority: 8,
});

// 3. Mettre à jour les étapes de l'action
await actionMemory.updateStep('chat_123', 'Vérification des variables .env');

// 4. Calculer la vélocité conversationnelle
const velocity = await workingMemory.getChatVelocity('chat_123');
console.log(`Mode de chat détecté : ${velocity.mode}`);

// 5. Exécuter un cycle de décroissance Ebbinghaus
const decayStats = await memoryDecay.decay('chat_123');
console.log(`Souvenirs archivés : ${decayStats.archived}, conservés : ${decayStats.kept}`);
```

---

## 6. Limitations & Invariants Opérationnels

- **Plafond Circulaire L1** : Strictement borné à 15 tours de dialogue par chat pour éviter toute dérive d'empreinte mémoire.
- **Atomicité des Écritures Redis** : L'utilisation de transactions `multi().exec()` dans `redisClient.ts` garantit la cohérence des opérations concurrentes.
- **Non-Blocage CMA** : Toutes les procédures d'amplification de rappel (`cma_boost_memory`) et de consolidation de Gists sont strictement déléguées à `setImmediate` pour préserver un temps de réponse agent minimal.
