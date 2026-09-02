# ServiceContainer — Référence Technique

Le module `ServiceContainer` est le registre central d'inversion de contrôle (IoC) pour l'application HIVE-MIND. Il gère l'enregistrement, l'instanciation différée (*lazy loading*) et l'injection des 32 services clés du système.

- **Fichier source :** `src/core/ServiceContainer.ts`
- **Point d'accès singleton :** `src/core/container.ts`
- **Instance globale :** `container` (également assignée à `globalThis.container`)
- **Dépendances majeures :** `fs`, `path`, `url`, `zod`, `@supabase/supabase-js`, modules de configuration (`src/config/`).

## 1. Interfaces & Types TypeScript

```typescript
export interface ServiceEntry {
  factory: () => unknown;
  singleton: boolean;
  instance: unknown;
}

export interface ContainerInitOptions {
  mode: 'full' | 'minimal';
}

export interface ServiceStats {
  total: number;
  singletons: number;
  instances: number;
  services: Record<string, { singleton: boolean; created: boolean }>;
}

export interface ServiceRegistry {
  logger: typeof logger;
  supabase: typeof db;
  config: typeof appConfig;
  redis: typeof import('../services/redisClient.js').redis;
  adminService: typeof import('../services/adminService.js').adminService;
  userService: typeof import('../services/userService.js').userService;
  agentMemory: typeof import('../services/agentMemory.js').agentMemory;
  actionMemory: typeof import('../services/memory/ActionMemory.js').actionMemory;
  groupService: typeof import('../services/groupService.js').groupService;
  workingMemory: typeof import('../services/workingMemory.js').workingMemory;
  consciousness: typeof import('../services/consciousnessService.js').consciousness;
  moderation: typeof import('../services/moderationService.js').moderationService;
  embeddings: EmbeddingsService;
  quotaManager: typeof import('../services/quotaManager.js').quotaManager;
  voiceProvider: InstanceType<typeof import('../services/voice/voiceProvider.js').VoiceProvider>;
  voiceService: InstanceType<typeof import('../services/voice/minimax.js').MinimaxVoiceService>;
  transcriptionService: InstanceType<
    typeof import('../services/transcription/groqSTT.js').GroqTranscriptionService
  >;
  memory: SemanticMemory;
  graphMemory: typeof import('../services/graphMemory.js').graphMemory;
  knowledgeWeaver: typeof import('../services/knowledgeWeaver.js').knowledgeWeaver;
  consolidationService: typeof import('../services/consolidationService.js').consolidationService;
  geminiLiveProvider: InstanceType<
    typeof import('../services/audio/geminiLiveProvider.js').GeminiLiveProvider
  >;
  dream: typeof import('../services/dreamService.js').dreamService;
  runtime: InstanceType<
    typeof import('../services/runtime/RuntimeInfrastructure.js').AIRuntimeInfrastructure
  >;
  contextWindow: InstanceType<
    typeof import('../services/runtime/ContextWindowService.js').ContextWindowService
  >;
  facts: typeof import('../services/memory.js').factsMemory;
  workspace: typeof import('../services/memory.js').workspaceMemory;
  browser: typeof import('../services/browser/BrowserService.js').browserService;
  providerRouter: typeof import('../providers/index.js').providerRouter;
  db: typeof db;
}
```

## 2. Classes & Signatures de Méthodes

### `ServiceContainer`

#### Constructeur
```typescript
constructor()
```
Instancie un conteneur vierge avec une table associative interne `services: Map<string, ServiceEntry>` et un drapeau `initialized = false`.

#### Méthode `init(options)`
```typescript
public async init(options?: ContainerInitOptions): Promise<void>
```

Initialise le conteneur en chargeant la configuration (`credentials.json` et `models_config.json`) et en enregistrant l'ensemble des fabriques de services selon le mode choisi.

**Paramètres :**
| Paramètre | Type | Obligatoire | Défaut | Description |
| :--- | :--- | :--- | :--- | :--- |
| `options` | `ContainerInitOptions` | Non | `{ mode: 'full' }` | Options de démarrage (`'full'` pour le démon, `'minimal'` pour CLI/tests). |

**Valeur de retour :**
- `Promise<void>` : Se résout lorsque les services de base et les enregistrements sont configurés.

**Exceptions :**
| Type d'Erreur | Condition de Déclenchement |
| :--- | :--- |
| `ZodError` / `Error` | Fichiers de configuration JSON manquants ou non conformes aux schémas Zod. |

---

#### Méthode `register(name, factory, options)`
```typescript
public register(name: string, factory: unknown, options?: { singleton?: boolean }): this
```

Enregistre une nouvelle fabrique de service ou une instance existante sous une clé unique.

**Paramètres :**
| Paramètre | Type | Obligatoire | Défaut | Description |
| :--- | :--- | :--- | :--- | :--- |
| `name` | `string` | Oui | — | Clé d'identification du service dans le registre. |
| `factory` | `unknown` | Oui | — | Fonction fabrique retournant l'instance, ou instance directe. |
| `options` | `{ singleton?: boolean }` | Non | `{ singleton: false }` | Si `singleton: true`, l'instance est mise en cache au premier appel. |

**Valeur de retour :**
- `this` : Permet le chaînage d'appels d'enregistrement.

---

#### Méthode `get(name)`
```typescript
public get<K extends keyof ServiceRegistry>(name: K): ServiceRegistry[K]
public get<T = unknown>(name: string): T
```

Résout et retourne l'instance du service demandé. Instancie le service s'il s'agit d'une fabrique non instanciée, met en cache si singleton, et injecte le conteneur si `setContainer` est implémenté.

**Paramètres :**
| Paramètre | Type | Obligatoire | Défaut | Description |
| :--- | :--- | :--- | :--- | :--- |
| `name` | `K` ou `string` | Oui | — | Nom typé du service dans `ServiceRegistry`. |

**Valeur de retour :**
- `ServiceRegistry[K]` ou `T` : Instance fortement typée du service demandé.

**Exceptions :**
| Type d'Erreur | Condition de Déclenchement |
| :--- | :--- |
| `Error` | Levée avec le message `[ServiceContainer] Service non trouvé: <name>` si le service n'est pas enregistré. |

---

#### Méthode `has(name)`
```typescript
public has(name: string): boolean
```

Vérifie si un service est présent dans le registre.

**Paramètres :**
| Paramètre | Type | Obligatoire | Défaut | Description |
| :--- | :--- | :--- | :--- | :--- |
| `name` | `string` | Oui | — | Nom du service recherché. |

**Valeur de retour :**
- `boolean` : `true` si le service est enregistré, sinon `false`.

---

#### Méthode `getStats()`
```typescript
public getStats(): ServiceStats
```

Retourne les métriques d'instanciation du conteneur en temps réel.

**Valeur de retour :**
- `ServiceStats` : Objet détaillant le total enregistré, les singletons, les instances créées et l'état par service.

## 3. Schéma de Configuration & Variables d'Environnement

Le conteneur lit sa configuration depuis deux fichiers JSON validés par Zod :
- `src/config/credentials.json` (`CredentialsSchema`)
- `src/config/models_config.json` (`ModelsConfigSchema`)

| Variable / Clé Config | Type | Obligatoire | Description |
| :--- | :--- | :--- | :--- |
| `credentials.familles_ia.gemini` | `string` | Non | Clé API Google Gemini (ou nom d'environnement résolu). |
| `credentials.familles_ia.openai` | `string` | Non | Clé API OpenAI. |
| `credentials.familles_ia.groq` | `string` | Non | Clé API Groq (utilisée pour transcription audio STT). |
| `credentials.familles_ia.minimax` | `string` | Non | Clé API Minimax (synthèse vocale TTS). |

## 4. Codes d'Erreur & États Internes

| Erreur / Message | Signification | Comportement Système |
| :--- | :--- | :--- |
| `[ServiceContainer] Service non trouvé: <name>` | Accès à un service absent du conteneur | Lance une exception bloquante `Error` |
| `[ServiceContainer] ❌ Tentative d'enregistrement de service NULL: <name>` | Appel à `register` avec une valeur falsy | Annule l'enregistrement et conserve l'état antérieur |
| `[ServiceContainer] Service <name> déjà enregistré - remplacement` | Réenregistrement d'une clé existante | Avertissement console et remplacement de l'entrée |

## 5. Exemple d'Utilisation Minimal

```typescript
import { container } from '../../src/core/container.js';

// Initialisation du conteneur en mode minimal pour tests ou scripts
await container.init({ mode: 'minimal' });

// Résolution fortement typée
const logger = container.get('logger');
const redis = container.get('redis');

logger.info('[App] Services résolus avec succès.');
```

## 6. Limitations & Invariants Opérationnels

- **Concurrence & Thread-Safety :** L'instance `container` est un singleton exécuté sur le thread principal Node.js (non thread-safe en contexte multi-worker sans synchronisation externe).
- **Complexité Algorithmique :** $O(1)$ pour l'enregistrement (`Map.set`), $O(1)$ pour la résolution (`Map.get`).
- **Idempotence de l'initialisation :** L'appel répété à `init()` est un no-op si `this.initialized === true`.
