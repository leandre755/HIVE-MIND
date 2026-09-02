# Comment Normaliser les Paramètres et Convertir les Messages vers les Dialectes Wire

Ce guide pratique explique comment utiliser le sous-système **GenerationParams & MessageConverter** pour préparer des requêtes d'inférence universelles et les convertir fidèlement vers les dialectes spécifiques des fournisseurs (OpenAI, Anthropic, Gemini, Cohere).

## Prérequis

- Node.js $\ge 22.0.0$ (ESM natif) et TypeScript.
- Dépendances du projet installées (`npm install`).
- Compréhension des formats de messages pivots `ChatMessage` et d'outils `ToolCall`.

## Étapes de Réalisation

### 1. Résoudre les capacités d'un modèle cible

Extrayez le profil `ModelCapabilities` pour votre modèle à partir de l'objet de configuration :

```typescript
import {
  resolveCapabilities,
  type ModelCapabilities,
} from '../../src/providers/GenerationParams.js';

// Simulation d'une entrée de configuration issue de models_config.json
const familyConfig = {
  capacites: {
    thinking: 'anthropic-budget',
    prompt_caching: true,
    temperature_range: [0, 1],
    max_tokens_field: 'max_tokens',
    max_tokens_required: true,
  },
  modeles: [
    { id: 'claude-3-7-sonnet-latest' },
  ],
};

const capabilities: ModelCapabilities = resolveCapabilities(
  'claude-3-7-sonnet-latest',
  familyConfig,
);
console.log('Capacités résolues :', capabilities);
```

### 2. Valider et convertir les paramètres de génération abstraits

Construisez un objet `GenerationParams` et projetez-le vers le dialecte filaire souhaité :

```typescript
import {
  toWireParams,
  validateParams,
  type GenerationParams,
} from '../../src/providers/GenerationParams.js';

const params: GenerationParams = {
  temperature: 0.7,
  maxTokens: 4000,
  thinking: {
    mode: 'budget',
    budgetTokens: 2000,
  },
};

// 1. Validation de sécurité fail-closed contre les plafonds effectifs
validateParams(params, capabilities, 4000);

// 2. Conversion vers les clés filaires Anthropic
const wireParams = toWireParams('anthropic-compatible', params, capabilities, 4000);
console.log('Paramètres filaires générés :', wireParams);
// Sortie : { max_tokens: 4000, temperature: 0.7, thinking: { type: 'enabled', budget_tokens: 2000 } }
```

### 3. Convertir l'historique de conversation vers le dialecte cible

Utilisez les convertisseurs dédiés pour transformer une liste de messages pivot `ChatMessage[]` contenant du texte, des images et des appels d'outils :

```typescript
import type { ChatMessage } from '../../src/providers/types.js';
import {
  convertMessagesForAnthropic,
  convertMessagesForGemini,
  convertMessagesForOpenAI,
} from '../../src/providers/families/protocols/messageConverter.js';
import { generateSafeToolId } from '../../src/providers/toolIds.js';

const toolId = generateSafeToolId(); // ID conforme de 9 caractères

const messages: ChatMessage[] = [
  { role: 'system', content: 'Tu es un assistant utile.' },
  { role: 'user', content: 'Recherche la météo à Lyon.' },
  {
    role: 'assistant',
    content: null,
    tool_calls: [
      {
        id: toolId,
        type: 'function',
        function: {
          name: 'get_weather',
          arguments: JSON.stringify({ city: 'Lyon' }),
        },
      },
    ],
  },
  {
    role: 'tool',
    tool_call_id: toolId,
    content: JSON.stringify({ temperature: 21, condition: 'Ensoleillé' }),
  },
];

// Conversion vers Anthropic (blocs tool_use et tool_result)
const anthropicWire = convertMessagesForAnthropic(messages);
console.log('Messages format Anthropic :', JSON.stringify(anthropicWire, null, 2));

// Conversion vers Gemini (format contents/parts)
const geminiWire = convertMessagesForGemini(messages);
console.log('Messages format Gemini :', JSON.stringify(geminiWire, null, 2));
```

### 4. Convertir une réponse brute d'API vers le format pivot standard

Après réception d'une charge utile distante, traduisez-la en `ResponseConversion` standardisée :

```typescript
import { convertResponseForAnthropic } from '../../src/providers/families/protocols/messageConverter.js';

const rawAnthropicResponse = {
  content: [
    { type: 'text', text: 'Voici la météo observée.' },
    {
      type: 'tool_use',
      id: 'toolu_01A2B3C4D5',
      name: 'send_report',
      input: { recipient: 'admin' },
    },
  ],
};

const pivotResponse = convertResponseForAnthropic(rawAnthropicResponse);
console.log('Texte extrait :', pivotResponse.content);
console.log('Appels d’outils standardisés :', pivotResponse.toolCalls);
```

## Cas Particuliers & Variantes

### Variante A : Modèles OpenAI de Raisonnement (o1, o3-mini)
Pour les modèles de type `openai-effort`, les paramètres sont automatiquement transposés en `max_completion_tokens` et `reasoning_effort` :

```typescript
const o1Caps: ModelCapabilities = {
  thinking: 'openai-effort',
  promptCaching: false,
  temperatureRange: 'unsupported',
  maxTokensField: 'max_completion_tokens',
  maxTokensRequired: false,
};

const o1Params: GenerationParams = {
  thinking: { mode: 'effort', effort: 'high' },
  maxTokens: 8000,
};

const o1Wire = toWireParams('openai-compatible', o1Params, o1Caps);
console.log(o1Wire);
// Sortie : { max_completion_tokens: 8000, reasoning_effort: 'high' } (temperature omise)
```

### Variante B : Injection de Prompt Caching Éphémère
Activez l'injection pour réduire drastiquement le coût des préfixes récurrents :

```typescript
import { applyPromptCaching } from '../../src/providers/GenerationParams.js';

const cachedMessages = applyPromptCaching(messages, capabilities);
```

## Vérification & Validation

Exécutez la suite de tests unitaires du convertisseur de paramètres :

```bash
NODE_ENV=test SUPABASE_URL=http://localhost:54321 SUPABASE_KEY=dummy REDIS_URL=redis://localhost:6379 NODE_OPTIONS='--experimental-vm-modules --no-warnings' npx jest src/tests/unit/providers/generation_params.test.ts --runInBand
```

Résultat attendu dans le terminal :
```text
PASS src/tests/unit/providers/generation_params.test.ts
  GenerationParams - Capabilities Resolution
    ✓ resolves capabilities with default fallback when empty
    ✓ resolves custom thinking and prompt caching capabilities
  GenerationParams - Parameter Validation & Wire Mapping
    ✓ validates thinking budget strictly below effectiveMaxTokens
    ✓ translates toWireParams for openai-compatible with max_completion_tokens
    ✓ translates toWireParams for anthropic-compatible with thinking budget
    ✓ translates toWireParams for gemini-native with maxOutputTokens and thinkingConfig
  GenerationParams - Prompt Caching Injection
    ✓ applies ephemeral prompt caching on system and last messages
    ✓ skips caching when model does not support prompt caching
  Tool IDs Generator
    ✓ generates 9-character alphanumeric safe tool IDs
    ✓ validates compliant and rejects non-compliant tool IDs

Test Suites: 1 passed, 1 total
Tests:       12 passed, 1 total
```

## Guide de Dépannage (Troubleshooting)

| Symptôme / Message d'Erreur | Cause Probable | Solution Immédiate |
| :--- | :--- | :--- |
| `GenerationParamsError: budgetTokens doit être strictement inférieur à maxTokens` | Le budget de raisonnement alloué est supérieur ou égal au plafond maximal de sortie. | Définir `budgetTokens` à une valeur strictement inférieure à `maxTokens` (ex. `budget: 2000`, `max: 4000`). |
| `GenerationParamsError: clé inconnue "xyz" dans "familles.foo.capacites"` | Une clé non reconnue ou mal orthographiée a été ajoutée dans `models_config.json`. | Vérifier l'orthographe parmi les clés admises : `thinking`, `prompt_caching`, `temperature_range`, `max_tokens_field`, `max_tokens_required`. |
| `[MessageConverter] Anthropic: réponse structurellement invalide, retour vide` | Le corps de la réponse retourné par l'API ne correspond pas à la structure attendue. | Vérifier si l'API a renvoyé une erreur de schéma ou un objet d'erreur HTTP non intercepté en amont. |
