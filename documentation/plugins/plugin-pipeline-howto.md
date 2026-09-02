# Comment Déclarer, Valider et Intégrer un Nouveau Plugin d'Outil (SS-25)

Ce guide pratique présente la méthode standard pour créer un nouveau plugin modulaire, configurer ses schémas de validation stricte Ajv/Zod, l'enregistrer dans `PluginLoader` et vérifier son comportement via les tests unitaires.

## Prérequis

- Node.js >= 22 (ESM natif) et TypeScript configuré.
- Dépendances `ajv` et `zod` installées (`npm install ajv zod`).
- Architecture de répertoires `src/plugins/<categorie>/<nom_plugin>/index.ts` respectée.

## Étapes de Réalisation

### 1. Déclarer la Structure du Plugin et son Schéma d'Outil

Créez un nouveau fichier `src/plugins/tools/weather_tool/index.ts` exportant par défaut un objet conforme à l'interface `Plugin`.

```typescript
import type { Plugin, PluginResult } from '../../../plugins/loader.js';

const weatherPlugin: Plugin = {
  name: 'weather_service',
  description: 'Fournit la météo en temps réel pour une localisation donnée.',
  version: '1.0.0',
  enabled: true,

  toolDefinition: {
    type: 'function',
    function: {
      name: 'get_current_weather',
      description: 'Récupère la météo actuelle et la température pour une ville.',
      parameters: {
        type: 'object',
        properties: {
          city: {
            type: 'string',
            description: 'Le nom de la ville (ex. Paris, Tokyo, New York).',
          },
          unit: {
            type: 'string',
            enum: ['celsius', 'fahrenheit'],
            description: 'Unité de mesure de température.',
          },
        },
        required: ['city'],
      },
    },
  },

  async execute(
    args: Record<string, unknown>,
    context: Record<string, unknown>,
    toolName: string,
  ): Promise<PluginResult> {
    if (toolName !== 'get_current_weather') {
      return { success: false, message: `Outil inconnu : ${toolName}` };
    }

    const city = String(args.city);
    const unit = String(args.unit || 'celsius');

    // Implémentation du service
    return {
      success: true,
      message: `Météo à ${city} : 22° (${unit}), Ensoleillé.`,
      city,
      temperature: 22,
    };
  },
};

export default weatherPlugin;
```

### 2. Valider les Arguments avec le Validateur Strict Ajv

Assurez-vous que les arguments envoyés par le modèle de langage sont soumis à `validateToolArgs` avant l'exécution.

```typescript
import { validateToolArgs } from '../src/utils/toolValidator.js';
import { pluginLoader } from '../src/plugins/loader.js';

export async function safelyInvokeTool(
  toolName: string,
  rawJsonArguments: string,
  context: Record<string, unknown>,
) {
  const toolDefs = pluginLoader.getToolDefinitions();

  // 1. Validation stricte pré-exécution
  const validation = validateToolArgs(toolName, rawJsonArguments, toolDefs);
  if (!validation.valid) {
    // Retourner le diagnostic formaté pour auto-correction LLM
    return {
      success: false,
      message: validation.formattedError || 'Validation error',
    };
  }

  // 2. Exécution protégée
  const parsedArgs = JSON.parse(rawJsonArguments) as Record<string, unknown>;
  return await pluginLoader.execute(toolName, parsedArgs, context);
}
```

### 3. Connecter un Serveur d'Outils Distant via MCP

Pour exposer des outils distants sans écrire de plugin local, ajoutez la définition du serveur dans votre fichier `.mcprc` :

```json
{
  "github_tools": {
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-github"],
    "env": {
      "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_xxxxxxxxxxxx"
    }
  }
}
```

Puis chargez les outils au démarrage :

```typescript
import { mcpClient } from '../src/services/mcpClient.js';

const mcpTools = await mcpClient.getTools();
console.log(`Chargé ${mcpTools.length} outils MCP distants.`);
```

## Cas Particuliers & Variantes

### Variante A : Utiliser `defineZodTool` pour une Sécurité de Typage Maximale

Pour définir un outil avec Zod plutôt qu'un JSON Schema brut :

```typescript
import { defineZodTool, executeZodTool } from '../src/utils/toolExecution.js';
import { z } from 'zod';

export const sumTool = defineZodTool({
  name: 'calculate_sum',
  description: 'Additionne deux nombres.',
  schema: z.object({
    x: z.number(),
    y: z.number(),
  }),
  execute: async ({ x, y }) => ({ result: x + y }),
});
```

### Variante B : Enregistrer un Déclencheur Textuel Regex (`TextMatcher`)

Pour qu'un plugin réagisse directement à un message utilisateur sans passer par le LLM (ex: `!ping`) :

```typescript
const pingPlugin: Plugin = {
  name: 'ping_plugin',
  description: 'Répond instantanément à !ping',
  version: '1.0.0',
  textMatchers: [
    {
      pattern: /^!ping$/i,
      handler: 'ping_response',
      description: 'Vérification de connectivité',
    },
  ],
  async execute() {
    return { success: true, message: 'Pong ! 🏓' };
  },
};
```

## Vérification & Validation

Exécutez la suite de tests unitaires du validateur d'outils pour vérifier l'application des contraintes Ajv et le rejet des propriétés imprévues :

```bash
npx jest src/tests/unit/core/toolValidator.test.ts --runInBand
```

Résultat attendu dans le terminal :

```text
PASS src/tests/unit/core/toolValidator.test.ts
  validateToolArgs
    valid calls
      ✓ should return valid when all required params are present (3 ms)
      ✓ should return invalid when unexpected parameters are provided (strict mode) (2 ms)
      ✓ should return valid when tool has no required array (1 ms)
      ✓ should return valid when tool is not found in definitions (1 ms)
    missing/edge
      ✓ should detect single missing required param (1 ms)
      ✓ should detect multiple missing required params (1 ms)
      ✓ should detect partial missing required params (1 ms)
    empty string treated as missing
      ✓ should treat empty string as missing for required param (1 ms)
      ✓ should treat null as missing for required param (1 ms)
    unparseable JSON
      ✓ should return invalid with unparseable marker when JSON is malformed (1 ms)
      ✓ should return invalid when arguments is empty string (1 ms)
    edge cases
      ✓ should accept boolean false as a present value (1 ms)
      ✓ should accept zero as a present value (1 ms)

Test Suites: 1 passed, 1 total
Tests:       13 passed, 13 total
Snapshots:   0 total
Time:        0.915 s
```

## Guide de Dépannage (Troubleshooting)

| Symptôme / Message d'Erreur                | Cause Probable                                                                                             | Solution Immédiate                                                                                                       |
| :----------------------------------------- | :--------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------- |
| `An unexpected parameter 'X' was provided` | Le modèle de langage a inventé un paramètre absent du schéma (`additionalProperties: false`).              | Mettre à jour le schéma de l'outil pour déclarer la propriété ou laisser l'agent s'auto-corriger via `<tool_use_error>`. |
| `The required parameter 'Y' is missing`    | Un paramètre listé dans `required` n'a pas été renseigné ou a été transmis sous forme de chaîne vide `""`. | S'assurer que le LLM fournit une valeur non nulle pour tous les champs requis.                                           |
| `[MCP] Failed to connect to server X`      | La commande spécifiée dans `.mcprc` n'existe pas ou les variables d'environnement requises sont absentes.  | Vérifier la présence du binaire (`npx`, binaire local) et la validité de la syntaxe JSON de `.mcprc`.                    |
