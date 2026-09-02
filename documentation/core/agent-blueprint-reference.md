# AgentBlueprint — Référence Technique

Le module `AgentBlueprint` fournit la spécification formelle, le validateur Zod et le gestionnaire de cycle de vie pour les topologies et contraintes d'exécution des agents autonomes et sous-agents éphémères de HIVE-MIND.

- **Fichier source :** `src/core/blueprint/AgentBlueprint.ts`
- **Répertoire des blueprints statiques :** `src/config/blueprints/*.json`
- **Dépendances :** `zod`, `src/utils/safeFs.ts`
- **Instance exportée :** `blueprintManager` (singleton)

## 1. Interfaces & Types TypeScript

```typescript
import { z } from 'zod';

export const AgenticFormatSchema = z.object({
  metadata: z.object({
    id: z.string(),
    name: z.string(),
    version: z.string(),
  }),
  mindos: z.object({
    drives: z.array(z.string()), // Core drives/motivations
  }),
  action_space: z.object({
    allowed_tools: z.array(z.string()), // Tool whitelist
  }),
  constraints: z.object({
    read_only_fs: z.boolean().default(false),
    max_budget_usd: z.number().default(1.0),
    max_iterations: z.number().default(10),
  }),
});

export type AgentBlueprint = z.infer<typeof AgenticFormatSchema>;
```

## 2. Classes & Signatures de Méthodes

### `BlueprintManager`

#### Propriétés Internes
```typescript
private ephemeralRegistry: Map<string, AgentBlueprint>;
```

---

#### Méthode `loadBlueprint(blueprintId)`
```typescript
public loadBlueprint(blueprintId: string): AgentBlueprint
```

Charge un profil d'agent par son identifiant. Interroge en premier lieu le registre RAM éphémère ; en cas d'absence, résout et parse le fichier JSON statique depuis `src/config/blueprints/${blueprintId}.json`.

**Paramètres :**
| Paramètre | Type | Obligatoire | Défaut | Description |
| :--- | :--- | :--- | :--- | :--- |
| `blueprintId` | `string` | Oui | — | Identifiant unique du blueprint (ex: `'hive_main'`, `'deep_researcher'`). |

**Valeur de retour :**
- `AgentBlueprint` : Objet validé et typé conforme à `AgenticFormatSchema`.

**Exceptions :**
| Type d'Erreur | Condition de Déclenchement |
| :--- | :--- |
| `Error` | Fichier de blueprint introuvable sur disque (`src/config/blueprints/<id>.json`). |
| `ZodError` / `Error` | Le contenu du fichier JSON ne respecte pas le schéma `AgenticFormatSchema`. |

---

#### Méthode `registerEphemeral(blueprintData)`
```typescript
public registerEphemeral(blueprintData: unknown): string
```

Valide via Zod et enregistre en mémoire vive (RAM) un profil d'agent généré dynamiquement. Retourne l'identifiant du blueprint enregistré.

**Paramètres :**
| Paramètre | Type | Obligatoire | Défaut | Description |
| :--- | :--- | :--- | :--- | :--- |
| `blueprintData` | `unknown` | Oui | — | Données brutes de configuration de l'agent. |

**Valeur de retour :**
- `string` : L'identifiant `metadata.id` du blueprint validé.

**Exceptions :**
| Type d'Erreur | Condition de Déclenchement |
| :--- | :--- |
| `Error` | Données de blueprint non conformes au schéma de validation Zod. |

---

#### Méthode `cleanupEphemeral(blueprintId)`
```typescript
public cleanupEphemeral(blueprintId: string): void
```

Supprime un blueprint éphémère du registre RAM pour libérer les ressources en fin de mission.

**Paramètres :**
| Paramètre | Type | Obligatoire | Défaut | Description |
| :--- | :--- | :--- | :--- | :--- |
| `blueprintId` | `string` | Oui | — | Identifiant du blueprint à détruire. |

**Valeur de retour :**
- `void`

## 3. Schéma de Données JSON Standard

Exemple d'un fichier de blueprint statique (`src/config/blueprints/hive_main.json`) :

```json
{
  "metadata": {
    "id": "hive_main",
    "name": "HIVE-MIND Principal",
    "version": "1.0.0"
  },
  "mindos": {
    "drives": ["accuracy", "safety", "brevity"]
  },
  "action_space": {
    "allowed_tools": ["*"]
  },
  "constraints": {
    "read_only_fs": false,
    "max_budget_usd": 2.0,
    "max_iterations": 10
  }
}
```

## 4. Codes d'Erreur & Exceptions

| Message d'Erreur | Signification | Comportement |
| :--- | :--- | :--- |
| `[BlueprintManager] Blueprint file not found on disk: ...` | L'identifiant demandé n'existe ni en RAM ni sur disque | Lance une exception bloquante `Error` |
| `[BlueprintManager] Invalid blueprint format for "<id>": ...` | Échec de parsing JSON ou rejet de schéma Zod | Lance une exception avec cause attachée |
| `[BlueprintManager] Ephemeral schema validation failed: ...` | Rejet Zod lors de `registerEphemeral()` | Refuse l'enregistrement et lance une `Error` |

## 5. Exemple d'Utilisation Minimal

```typescript
import { blueprintManager } from '../../src/core/blueprint/AgentBlueprint.js';

// 1. Chargement d'un blueprint statique
const mainBlueprint = blueprintManager.loadBlueprint('hive_main');
console.log('Nom:', mainBlueprint.metadata.name);
console.log('Outils autorisés:', mainBlueprint.action_space.allowed_tools);

// 2. Enregistrement d'un sous-agent éphémère en RAM
const ephemeralId = blueprintManager.registerEphemeral({
  metadata: {
    id: 'subagent_code_reviewer_101',
    name: 'CodeReviewer',
    version: '1.0.0',
  },
  mindos: { drives: ['security', 'rigor'] },
  action_space: { allowed_tools: ['read_file', 'ast_query'] },
  constraints: { read_only_fs: true, max_budget_usd: 0.1, max_iterations: 5 },
});

// 3. Récupération et nettoyage
const subBlueprint = blueprintManager.loadBlueprint(ephemeralId);
console.log('Sous-agent en lecture seule:', subBlueprint.constraints.read_only_fs); // true

blueprintManager.cleanupEphemeral(ephemeralId);
```

## 6. Limitations & Invariants Opérationnels

- **Confinement Disque :** La résolution des chemins est strictement confinée au dossier racine `src/config/blueprints/` via `resolveWithinRoot`.
- **Immuabilité :** Les objets retournés sont typés et validés ; les modifications manuelles de propriétés après chargement n'altèrent pas les fichiers disque.
- **Volatilité RAM :** Les blueprints éphémères sont perdus lors du redémarrage du processus.
