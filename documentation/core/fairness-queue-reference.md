# FairnessQueue — Référence Technique

Le module `FairnessQueue` implémente une file d'attente à ordonnancement équitable (*Fair Queuing*) basée sur un algorithme Round-Robin entre les identifiants de conversation (`chatId`), avec support de voie prioritaire pour les requêtes administratives.

- **Fichier source :** `src/core/FairnessQueue.ts`
- **Consommateur direct :** `src/core/orchestrator.ts`, `src/core/BotCore.ts`
- **Dépendances externes :** Aucune (zéro dépendance).

## 1. Interfaces & Types TypeScript

```typescript
/** Structure d'un événement stocké dans la file d'attente */
export interface QueueEvent {
  readonly chatId: string;
  readonly timestamp?: number;
  [key: string]: unknown;
}
```

## 2. Classes & Signatures de Méthodes

### `FairnessQueue`

#### Propriétés
```typescript
public queues: Map<string, QueueEvent[]>;
public chatIds: string[];
public currentIndex: number;
```

#### Constructeur
```typescript
constructor()
```
Initialise une instance vierge avec `queues = new Map()`, `chatIds = []` et `currentIndex = 0`.

---

#### Méthode `enqueue(chatId, event, isPremium)`
```typescript
public enqueue(chatId: string, event: QueueEvent, isPremium?: boolean): void
```

Ajoute un événement à la file spécifique de son `chatId`. Si `isPremium` est vrai, l'événement est inséré en tête de file (`unshift`) et le pointeur circulaire est immédiatement repositionné sur ce canal.

**Paramètres :**
| Paramètre | Type | Obligatoire | Défaut | Description |
| :--- | :--- | :--- | :--- | :--- |
| `chatId` | `string` | Oui | — | Identifiant unique du canal / de la conversation. |
| `event` | `QueueEvent` | Oui | — | Données de l'événement à traiter. |
| `isPremium` | `boolean` | Non | `false` | Si `true`, active le contournement prioritaire (VIP FastLane). |

**Valeur de retour :**
- `void`

---

#### Méthode `dequeue()`
```typescript
public dequeue(): QueueEvent | null
```

Extrait et retourne le prochain événement à traiter selon la séquence circulaire Round-Robin. Nettoie automatiquement la file et la liste des canaux si un canal devient vide.

**Valeur de retour :**
- `QueueEvent | null` : L'événement extrait, ou `null` si toutes les files sont vides.

---

#### Méthode `advance()`
```typescript
public advance(): void
```

Avance le pointeur circulaire `currentIndex` au canal actif suivant (`(currentIndex + 1) % chatIds.length`). Si aucun canal n'est présent, réinitialise `currentIndex` à 0.

---

#### Getters d'État

##### `size`
```typescript
public get size(): number
```
Retourne le nombre total d'événements cumulés en attente dans toutes les files.

##### `activeChats`
```typescript
public get activeChats(): number
```
Retourne le nombre de conversations distinctes ayant actuellement au moins un événement en attente.

## 3. Schéma de Configuration & Variables d'Environnement

Le composant `FairnessQueue` n'utilise aucune variable d'environnement directe. Sa cadence de consommation est contrôlée au niveau de l'orchestrateur via le paramètre de configuration suivant :

| Paramètre Config | Type | Défaut | Description |
| :--- | :--- | :--- | :--- |
| `cooldown_between_responses_ms` | `number` | `1000` | Délai minimal d'attente entre deux dépilements successifs dans `orchestrator.ts`. |

## 4. Codes d'Erreur & États Internes

| État Interne | Description | Comportement |
| :--- | :--- | :--- |
| `chatIds.length === 0` | File entièrement vide | `dequeue()` retourne immédiatement `null`. |
| `queue.length === 0` | Dernière tâche d'un canal dépilée | `removeChatFromRotation(chatId)` supprime l'entrée `Map` et splice le tableau `chatIds`. |
| `currentIndex >= chatIds.length` | Désindexation consécutive à une suppression | `adjustCurrentIndex()` réaligne le pointeur à `0`. |

## 5. Exemple d'Utilisation Minimal

```typescript
import { FairnessQueue, type QueueEvent } from '../../src/core/FairnessQueue.js';

const queue = new FairnessQueue();

// Enregistrement d'événements de canaux distincts
queue.enqueue('chat_group_1', { chatId: 'chat_group_1', text: 'Message 1' });
queue.enqueue('chat_group_1', { chatId: 'chat_group_1', text: 'Message 2' });
queue.enqueue('chat_private_2', { chatId: 'chat_private_2', text: 'Message 3' });

// Envoi d'une commande admin prioritaire
queue.enqueue('chat_admin', { chatId: 'chat_admin', text: '!stop' }, true);

// Dépilement : l'événement admin sera servi en premier, puis alternance équitable
const first = queue.dequeue();
console.log('Premier servi:', first?.text); // "!stop"

const second = queue.dequeue();
console.log('Second servi:', second?.text); // "Message 1"
```

## 6. Limitations & Invariants Opérationnels

- **Complexité Temporelle :**
  - `enqueue(isPremium=false)` : $O(1)$ amorti.
  - `enqueue(isPremium=true)` : $O(K)$ où $K$ est le nombre de canaux actifs (`indexOf`).
  - `dequeue()` : $O(1)$ amorti lors du dépilement, $O(K)$ lors de la suppression d'un canal vide (`Array.splice`).
- **Persistance :** Structure purement résidente en mémoire RAM ; non persistée en cas d'arrêt brutal du processus Node.js.
