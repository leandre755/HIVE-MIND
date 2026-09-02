# Layer 1 SmartLayer & ModelHealthRegistry — Référence Technique

Ce document fournit la spécification formelle et exhaustive du routeur intelligent de niveau 1 **SmartLayer**, du registre de santé et disjoncteur **ModelHealthRegistry**, du gestionnaire de recettes **ServiceRegistry** et du fournisseur d'identifiants **CredentialProvider**.

- **Fichiers sources :** `src/providers/layer1/SmartLayer.ts`, `src/providers/layer1/ModelHealthRegistry.ts`, `src/providers/layer1/ServiceRegistry.ts`, `src/providers/layer1/CredentialProvider.ts`
- **Conteneur IoC :** Singletons `smartLayer`, `serviceRegistry`, `credentialProvider` ou instanciation autonome via `SmartLayer.getInstance()`.
- **Dépendances majeures :** `src/providers/layer0/ExecutionLayer.ts`, `src/services/envResolver.ts`, `src/services/quotaManager.ts`, `src/utils/safeFs.ts`

## 1. Interfaces & Types TypeScript

```typescript
import type { ExecutionRequest, StreamChunk } from '../layer0/ExecutionLayer.js';
import type { AdapterChatResult } from '../types.js';

export const MAX_ATTEMPTS = 4;
export const DEFAULT_DEADLINE_MS = 120000;

export interface SmartExecutionRequest extends ExecutionRequest {
  serviceOrCategory?: string;
  modelId?: string;
}

export interface SmartExecutionOptions {
  deadlineMs?: number;
  maxAttempts?: number;
  signal?: AbortSignal;
  effectiveMaxTokens?: number;
}

export interface SmartExecuteResult {
  result: AdapterChatResult;
  usedModel: string;
  usedProvider: string;
  attemptsCount: number;
}

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface ReliabilityDefaults {
  max_attempts: number;
  deadline_ms: number;
  per_attempt_timeout_ms: number;
  minimum_throughput: number;
  failure_ratio_threshold: number;
}

export interface ResolvedRecipe {
  name: string;
  models: string[];
  temperature?: number;
  family?: string;
  maxAttempts: number;
  deadlineMs: number;
  timeoutMs: number;
  rawRecipe?: Record<string, unknown>;
}

export interface CredentialResolution {
  apiKey: string;
  keyIndex: number;
  provider: string;
}
```

## 2. Classes & Signatures de Méthodes

### `SmartLayer`

#### Méthode `execute(request, options)`
```typescript
public async execute(
  request: SmartExecutionRequest,
  options?: SmartExecutionOptions
): Promise<SmartExecuteResult>
```

**Paramètres :**
| Paramètre | Type | Obligatoire | Défaut | Description |
| :--- | :--- | :--- | :--- | :--- |
| `request` | `SmartExecutionRequest` | Oui | — | Requête contenant les messages, outils et la cible (`serviceOrCategory` ou `modelId`). |
| `options` | `SmartExecutionOptions` | Non | `{}` | Options de cascade : `deadlineMs` (max 120s), `maxAttempts` (max 4), `signal`. |

**Valeur de retour :**
- `Promise<SmartExecuteResult>` : Contient l'objet `result` issu de Layer 0, ainsi que `usedModel`, `usedProvider` et `attemptsCount`.

**Comportement en cas d'erreur :**
Itère séquentiellement sur les modèles candidats ordonnés par score de santé. Lève la dernière erreur rencontrée si tous les modèles échouent ou si la deadline est atteinte.

---

#### Méthode `executeStream(request, options)`
```typescript
public async *executeStream(
  request: SmartExecutionRequest,
  options?: SmartExecutionOptions
): AsyncIterable<StreamChunk & { usedModel?: string; usedProvider?: string }>
```

**Comportement & Invariant Stream Lock :**
Générateur asynchrone émettant les fragments du premier modèle fonctionnel. Dès que le premier fragment est émis (`streamStarted = true`), tout échec ultérieur lève immédiatement une exception avec `__streamStarted = true` sans tenter de basculer vers un autre modèle.

---

### `ModelHealthRegistry`

#### Constantes Temporelles & Invariants
```typescript
export const WINDOW_MS = 60000;
export const BUCKET_COUNT = 6;
export const BUCKET_SIZE_MS = 10000;
export const FAILURE_RATIO_THRESHOLD = 0.5;
export const MINIMUM_THROUGHPUT = 3;
export const COOLDOWN_STEPS_MS = [30000, 120000, 600000] as const;
```

#### Méthodes Principales
| Méthode | Signature | Rôle |
| :--- | :--- | :--- |
| `recordSuccess` | `recordSuccess(modelId: string, latencyMs: number, family?: string): void` | Enregistre un succès, consigne la latence, et réinitialise le disjoncteur en état `CLOSED`. |
| `recordFailure` | `recordFailure(modelId: string, error: unknown, family?: string): void` | Enregistre un échec, évalue le ratio $R_{\text{fail}}$, et déclenche l'ouverture ou l'escalade de famille. |
| `isCircuitOpen` | `isCircuitOpen(modelId: string): boolean` | Vérifie si le disjoncteur du modèle ou de sa famille est en état `OPEN`. |
| `tryAcquireHalfOpenProbe` | `tryAcquireHalfOpenProbe(modelId: string): boolean` | Réserve la sonde unique en vol en état `HALF_OPEN`. Retourne `false` si déjà occupée. |
| `releaseHalfOpenProbe` | `releaseHalfOpenProbe(modelId: string): void` | Libère la réservation de sonde si la requête n'a pas pu être émise (ex. absence de clé). |
| `sortByPreference` | `sortByPreference(models: string[]): string[]` | Ordonne les modèles candidats selon la formule de score : $0.7 \times R_{\text{fail}} + 0.3 \times \frac{\text{P50}}{1000}$. |

---

### `ServiceRegistry`

#### Méthode `getRecipe(serviceOrCategory)`
```typescript
public getRecipe(serviceOrCategory: string): ResolvedRecipe
```
Résout une cible logique (ex. `'EXECUTOR'`, `'PLANNER'`, `'FAST'`, `'VISION'`) définie dans `services_config.json` en une liste ordonnée de modèles de repli (`models: [primary, fallback_1, fallback_2, ...]`).

---

### `CredentialProvider`

#### Méthode `getKey(providerName, modelId)`
```typescript
public async getKey(providerName: string, modelId?: string): Promise<CredentialResolution | null>
```
Sélectionne une clé API valide en effectuant une vérification de santé via `QuotaManager` suivie d'une rotation Round-Robin sur les clés configurées.

#### Méthode `recordQuotaExceeded(modelId, keyIndex, timeoutSeconds)`
```typescript
public async recordQuotaExceeded(modelId: string, keyIndex?: number, timeoutSeconds?: number): Promise<void>
```
Notifie `QuotaManager` qu'une clé a reçu un code 429 pour la suspendre temporairement.

---

## 3. Schéma de Configuration dans `services_config.json`

```json
{
  "reliability_defaults": {
    "max_attempts": 4,
    "deadline_ms": 120000,
    "per_attempt_timeout_ms": 45000,
    "minimum_throughput": 3,
    "failure_ratio_threshold": 0.5
  },
  "service_recipes": {
    "EXECUTOR": {
      "model": "gpt-4o",
      "fallback": "claude-3-7-sonnet-latest",
      "fallback_2": "deepseek-chat",
      "temperature": 0.2
    },
    "PLANNER": {
      "model": "claude-3-7-sonnet-latest",
      "fallback": "gpt-4o",
      "temperature": 0.1
    }
  },
  "chat_recipes": {
    "categories": {
      "fast": {
        "model": "gpt-4o-mini",
        "fallback": "claude-3-5-haiku-latest"
      }
    }
  }
}
```

---

## 4. États Internes du Circuit Breaker & Comportement Système

| État | Condition d'Entrée | Comportement lors des Requêtes | Transition Suivante |
| :--- | :--- | :--- | :--- |
| `CLOSED` | État nominal initial, ou succès d'une sonde en `HALF_OPEN`. | Toutes les requêtes sont acceptées et transmises à Layer 0. | Passe en `OPEN` si $N \ge 3$ et $R_{\text{fail}} \ge 0.5$. |
| `OPEN` | $R_{\text{fail}} \ge 0.5$ sur la fenêtre valide de 60s, ou escalade de famille. | Les requêtes sont rejetées immédiatement sans appel réseau ; basculement vers le modèle suivant. | Passe en `HALF_OPEN` après expiration du cooldown (30s $\to$ 120s $\to$ 600s). |
| `HALF_OPEN` | Expiration de la minuterie de cooldown de l'état `OPEN`. | Une seule requête concurrente est autorisée (`probeInFlight`). Les autres requêtes contournent le modèle. | Succès sonde $\to$ `CLOSED` (cooldown reset). Échec sonde $\to$ `OPEN` (cooldown step++). |

---

## 5. Exemple d'Utilisation Minimal

```typescript
import { smartLayer, type SmartExecutionRequest } from '../../src/providers/layer1/SmartLayer.js';

const request: SmartExecutionRequest = {
  serviceOrCategory: 'EXECUTOR', // Résolu via services_config.json
  messages: [
    { role: 'user', content: 'Génère un plan de migration pour le projet.' }
  ],
  params: {
    temperature: 0.3
  }
};

// 1. Exécution résiliente avec cascade automatique
const result = await smartLayer.execute(request, {
  maxAttempts: 3,
  deadlineMs: 60000
});

console.log(`Modèle effectivement utilisé : ${result.usedModel}`);
console.log(`Fournisseur : ${result.usedProvider}`);
console.log(`Nombre de tentatives nécessaires : ${result.attemptsCount}`);
console.log('Contenu :', result.result.content);

// 2. Streaming avec protection Stream Lock
for await (const chunk of smartLayer.executeStream(request)) {
  if (chunk.content) {
    process.stdout.write(chunk.content);
  }
}
```

---

## 6. Limitations & Invariants Opérationnels

- **Anti-Stack Overflow Garanti** : Aucune fonction récursive. La boucle est impérative, plate et strictement bornée par `MAX_ATTEMPTS = 4` et `DEFAULT_DEADLINE_MS = 120000`.
- **Complexité Algorithmique** :
  - `isCircuitOpen` / `recordSuccess` / `recordFailure` : $O(1)$ par calcul modulaire du bucket temporel.
  - `sortByPreference` : $O(K \log K)$ où $K$ est le nombre restreint de modèles d'une recette ($K \le 5$).
- **Isolation Mémoire** : Aucune dépendance cyclique vers l'orchestrateur. Les buckets et compteurs sont purgés automatiquement après 60 secondes d'inactivité.
