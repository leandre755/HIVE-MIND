# SwarmDispatcher — Référence Technique

Le module `SwarmDispatcher` est le régulateur de concurrence et d'ordonnancement asynchrone de HIVE-MIND. Il combine une sérialisation par verrou de conversation (*per-JID Mutex*) et une limitation adaptative de la charge matérielle basée sur l'état du processeur et de la mémoire vive.

- **Fichier source :** `src/core/concurrency/SwarmDispatcher.ts`
- **Consommateurs majeurs :** `src/core/orchestrator.ts`, `src/core/BotCore.ts`
- **Dépendances système :** `node:os`
- **Instance exportée :** Singleton par défaut (`export default new SwarmDispatcher()`)

## 1. Interfaces & Types TypeScript

```typescript
export interface SwarmMetrics {
  activeThreads: number;
  queuedTasks: number;
  totalProcessed: number;
  errors: number;
  activeJids: number;
  maxConcurrency: number;
}
```

## 2. Classes & Signatures de Méthodes

### `SwarmDispatcher`

#### Propriétés Internes
```typescript
private accessMap: Map<string, Promise<unknown>>;
private globalQueue: Array<() => void>;
private metrics: {
  activeThreads: number;
  queuedTasks: number;
  totalProcessed: number;
  errors: number;
};
```

#### Constructeur
```typescript
constructor()
```
Initialise la table des verrous par JID, la file d'attente globale et les compteurs de télémétrie.

---

#### Méthode `getMaxConcurrency()`
```typescript
public getMaxConcurrency(): number
```

Calcule en temps réel le nombre maximal de travailleurs concurrents admissibles selon la mémoire libre (`os.freemem()`) et le nombre de cœurs CPU (`os.cpus().length`).

**Valeur de retour :**
- `number` : Plafond de concurrence calculé ($\ge 2$ et $\le 50$).

---

#### Méthode `isPriorityCommand(message)`
```typescript
public isPriorityCommand(message: unknown): boolean
```

Détermine si le message correspond à une commande d'administration prioritaire court-circuitant la file d'attente de délestage.

**Paramètres :**
| Paramètre | Type | Obligatoire | Défaut | Description |
| :--- | :--- | :--- | :--- | :--- |
| `message` | `unknown` | Oui | — | Objet message brut (vérifie `text` ou `content`). |

**Valeur de retour :**
- `boolean` : `true` si le texte correspond à `/^!(ping|menu|help|stop|info)/i`, sinon `false`.

---

#### Méthode `dispatch(jid, message, taskFactory)`
```typescript
public async dispatch(
  jid: string,
  message: unknown,
  taskFactory: () => Promise<unknown>
): Promise<unknown>
```

Enregistre et exécute une tâche asynchrone pour un JID donné en respectant la sérialisation locale et les quotas de parallélisme globaux.

**Paramètres :**
| Paramètre | Type | Obligatoire | Défaut | Description |
| :--- | :--- | :--- | :--- | :--- |
| `jid` | `string` | Oui | — | Identifiant unique de conversation servant de clé de verrou. |
| `message` | `unknown` | Oui | — | Message entrant ou objet identifiant pour la détection de priorité et l'extraction de l'ID de tâche. |
| `taskFactory` | `() => Promise<unknown>` | Oui | — | Fabrique asynchrone exécutant le travail effectif. |

**Valeur de retour :**
- `Promise<unknown>` : Résultat produit par l'exécution de `taskFactory()`.

**Exceptions :**
| Type d'Erreur | Condition de Déclenchement |
| :--- | :--- |
| `Error` | Toute exception levée lors de l'exécution de `taskFactory()` est incrémentée dans les métriques et re-propagée à l'appelant. |

---

#### Méthode `getMetrics()`
```typescript
public getMetrics(): SwarmMetrics
```

Retourne un instantané des métriques de performance et d'état du régulateur.

**Valeur de retour :**
- `SwarmMetrics` : Objet contenant `activeThreads`, `queuedTasks`, `totalProcessed`, `errors`, `activeJids` et `maxConcurrency`.

## 3. Schéma de Configuration & Invariants Matériels

Le calcul de la charge s'appuie sur les ratios matériels suivants :

| Grandeur | Valeur de Référence | Description |
| :--- | :--- | :--- |
| Empreinte estimée par Worker | `250 Mo` | Mémoire RAM allouée par session ReAct / V8. |
| Facteur multiplicateur CPU | `3` | Travailleurs autorisés par cœur processeur physique. |
| Plancher absolu | `2` | Nombre minimal de travailleurs pour éviter l'interblocage. |
| Plafond dur (*HardCap*) | `50` | Nombre maximal absolu pour préserver la boucle d'événements. |

## 4. Codes d'Erreur & États Internes

| État / Log | Signification | Action Système |
| :--- | :--- | :--- |
| `[Swarm] 🟠 Throttling Task [jid:id]` | `activeThreads >= maxConcurrency` | Suspension de la tâche dans `globalQueue`. |
| `[Swarm] ⚡ Priority Bypass for Task [jid:id]` | Commande prioritaire (`!ping`, `!stop`) | Exécution immédiate sans attente dans la file. |
| `[Swarm] ⚠️ Previous task failed for <jid>` | Échec de la tâche précédente pour ce JID | Poursuite du chaînage sans interruption des tâches suivantes. |

## 5. Exemple d'Utilisation Minimal

```typescript
import swarmDispatcher from '../../src/core/concurrency/SwarmDispatcher.js';

// Tâche asynchrone pour la conversation user_123
const result = await swarmDispatcher.dispatch(
  'user_123@s.whatsapp.net',
  { text: 'Bonjour, analyse ce document' },
  async () => {
    // Logique métier de l'agent
    return { status: 'processed', reply: 'Document analysé' };
  }
);

console.log('Résultat de la tâche:', result);
console.log('Métriques actuelles:', swarmDispatcher.getMetrics());
```

## 6. Limitations & Invariants Opérationnels

- **Isolation par Processus :** Verrouillage en mémoire vive mono-processus ; n'assure pas le verrouillage inter-processus sans coordinateur externe.
- **Gestion de Mémoire :** Auto-nettoyage des clés `accessMap` à la terminaison des promesses.
- **Résilience aux Crashes :** La promesse rejetée d'une tâche n'interrompt pas la file des messages subséquents pour le même `jid`.
