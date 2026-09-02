# EventBus (BotEvents) — Référence Technique

Le module `EventBus` fournit le bus d'événements Pub/Sub interne pour la communication découplée et réactive entre tous les sous-systèmes de HIVE-MIND.

- **Fichier source :** `src/core/events.ts`
- **Dépendances :** `node:events` (`EventEmitter`)
- **Instances exportées :** `eventBus` (singleton), `EventBus` (classe), `BotEvents` (dictionnaire des événements)

## 1. Dictionnaire des Événements (`BotEvents`)

```typescript
export const BotEvents = {
  // Messages & Réactions
  MESSAGE_RECEIVED: 'message:received',
  MESSAGE_SENT: 'message:sent',
  MESSAGE_FAILED: 'message:failed',
  REACTION_RECEIVED: 'message:reaction',

  // Cycle de Vie IA
  AI_REQUEST: 'ai:request',
  AI_RESPONSE: 'ai:response',
  AI_ERROR: 'ai:error',

  // Plugins & Outils
  PLUGIN_LOADED: 'plugin:loaded',
  PLUGIN_EXECUTED: 'plugin:executed',
  PLUGIN_ERROR: 'plugin:error',
  TOOL_PROGRESS: 'tool:progress',

  // Ordonnanceur & Tâches Proactives
  JOB_TRIGGERED: 'scheduler:job_triggered',
  JOB_COMPLETED: 'scheduler:job_completed',
  JOB_FAILED: 'scheduler:job_failed',
  PROACTIVE_TRIGGER: 'proactive:trigger',

  // Gestion des Groupes
  GROUP_JOIN: 'group:join',
  GROUP_LEAVE: 'group:leave',
  GROUP_PROMOTE: 'group:promote',
  GROUP_DEMOTE: 'group:demote',

  // Connexion Réseau & Transports
  CONNECTED: 'connection:open',
  DISCONNECTED: 'connection:close',
  QR_RECEIVED: 'connection:qr',

  // Mémoire & Persistance
  MEMORY_STORED: 'memory:stored',
  MEMORY_RECALLED: 'memory:recalled',

  // Événements Externes Asynchrones (Inbox)
  EVENT_INBOX: 'event:inbox',

  // Services Applicatifs
  SERVICE_START: 'service:start',
  SERVICE_END: 'service:end',

  // Signaux Personnalisés
  CUSTOM: 'custom:event',

  // Sécurité & Alertes Critiques
  SYSTEM_ERROR: 'system:error',
  FATAL_TRANSPORT_CONFLICT: 'transport:fatal',
} as const;
```

## 2. Classes & Signatures de Méthodes

### `EventBus` (étend `EventEmitter`)

#### Constructeur
```typescript
constructor()
```
Initialise le bus d'événements et configure le seuil maximal d'écouteurs à 50 (`this.setMaxListeners(50)`).

---

#### Méthode `publish(event, ...args)`
```typescript
public publish(event: string, ...args: unknown[]): void
```

Publie un événement de manière synchrone auprès de tous les écouteurs enregistrés. Si la variable d'environnement `DEBUG=true` est active, enregistre l'événement dans la console avec troncature de la charge utile à 100 caractères.

**Paramètres :**
| Paramètre | Type | Obligatoire | Défaut | Description |
| :--- | :--- | :--- | :--- | :--- |
| `event` | `string` | Oui | — | Nom de l'événement (utiliser de préférence les constantes de `BotEvents`). |
| `...args` | `unknown[]` | Non | `[]` | Arguments et charges utiles transmis aux gestionnaires d'événements. |

**Valeur de retour :**
- `void`

---

#### Méthode `subscribe(event, handler)`
```typescript
public subscribe(event: string, handler: (...args: unknown[]) => void): void
```

Abonne une fonction de rappel à un événement donné.

**Paramètres :**
| Paramètre | Type | Obligatoire | Défaut | Description |
| :--- | :--- | :--- | :--- | :--- |
| `event` | `string` | Oui | — | Nom de l'événement écouté. |
| `handler` | `(...args: unknown[]) => void` | Oui | — | Fonction exécutée lors de l'émission de l'événement. |

---

#### Méthode `subscribeOnce(event, handler)`
```typescript
public subscribeOnce(event: string, handler: (...args: unknown[]) => void): void
```

Abonne une fonction de rappel pour une seule et unique émission (l'écouteur est automatiquement désabonné après son premier déclenchement).

**Paramètres :**
| Paramètre | Type | Obligatoire | Défaut | Description |
| :--- | :--- | :--- | :--- | :--- |
| `event` | `string` | Oui | — | Nom de l'événement écouté. |
| `handler` | `(...args: unknown[]) => void` | Oui | — | Fonction exécutée lors de l'unique déclenchement. |

---

#### Méthode `unsubscribe(event, handler)`
```typescript
public unsubscribe(event: string, handler: (...args: unknown[]) => void): void
```

Retire un gestionnaire d'événement précédemment enregistré.

**Paramètres :**
| Paramètre | Type | Obligatoire | Défaut | Description |
| :--- | :--- | :--- | :--- | :--- |
| `event` | `string` | Oui | — | Nom de l'événement. |
| `handler` | `(...args: unknown[]) => void` | Oui | — | Référence exacte de la fonction à désabonner. |

## 3. Schéma de Configuration & Variables d'Environnement

| Variable d'Environnement | Type | Défaut | Description |
| :--- | :--- | :--- | :--- |
| `DEBUG` | `string` (`"true"` / `"false"`) | `"false"` | Active la journalisation console détaillée des événements publiés via `publish()`. |

## 4. Exemple d'Utilisation Minimal

```typescript
import { eventBus, BotEvents } from '../../src/core/events.js';

// Déclaration d'un écouteur
const onMessageReceived = (data: { chatId: string; text: string }) => {
  console.log(`[EventBus] Message reçu pour ${data.chatId}: ${data.text}`);
};

// Abonnement
eventBus.subscribe(BotEvents.MESSAGE_RECEIVED, onMessageReceived);

// Publication
eventBus.publish(BotEvents.MESSAGE_RECEIVED, {
  chatId: 'user_456@s.whatsapp.net',
  text: 'Hello HIVE-MIND',
});

// Désabonnement
eventBus.unsubscribe(BotEvents.MESSAGE_RECEIVED, onMessageReceived);
```

## 5. Limitations & Invariants Opérationnels

- **Concurrence & Gestion des Exceptions :** Si un gestionnaire synchrone lève une exception non capturée, celle-ci interrompt la boucle d'émission `emit()` et empêche les écouteurs subséquents d'être appelés. Les gestionnaires asynchrones doivent gérer leurs propres rejets de promesses.
- **Plafond d'Écouteurs :** Limité à 50 écouteurs par événement pour détecter les fuites d'abonnements non nettoyés.
