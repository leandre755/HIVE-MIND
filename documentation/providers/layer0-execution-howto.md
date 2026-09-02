# Comment Exécuter et Tester des Inférences LLM via Layer 0

Ce guide pratique décrit étape par étape comment configurer, exécuter et tester des requêtes d'inférence LLM (synchrones et streaming) en utilisant directement le moteur de bas niveau **Layer 0 ExecutionLayer**.

## Prérequis

- Node.js $\ge 22.0.0$ (ESM natif) avec TypeScript configuré.
- Dépendances du projet installées (`npm install`).
- Un fichier `src/config/models_config.json` valide ou un mock de configuration.
- Au moins une clé d'API valide définie dans l'environnement (ex. `OPENAI_API_KEY`) ou transmise via `ExecutionOpts`.

## Étapes de Réalisation

### 1. Préparer le message et la requête d'exécution

Construisez un objet `ExecutionRequest` contenant les messages au format pivot `ChatMessage` et les paramètres de génération désirés.

```typescript
import type { ExecutionRequest } from '../../src/providers/layer0/ExecutionLayer.js';

const request: ExecutionRequest = {
  messages: [
    {
      role: 'system',
      content: 'Tu es un expert technique spécialisé en architecture logicielle.',
    },
    {
      role: 'user',
      content: 'Explique le principe de séparation entre Layer 0 et Layer 1 en 2 phrases.',
    },
  ],
  params: {
    temperature: 0.2,
    maxTokens: 150,
  },
};
```

### 2. Exécuter un appel synchrone bloquant

Appelez `execute()` sur le singleton `executionLayer` en spécifiant l'identifiant du modèle cible enregistré dans `models_config.json`.

```typescript
import { executionLayer } from '../../src/providers/layer0/ExecutionLayer.js';

async function runSingleCompletion() {
  try {
    const response = await executionLayer.execute('gpt-4o', request, {
      timeoutMs: 15000,
    });

    console.log('Contenu généré :', response.content);
    if (response.usage) {
      console.log(`Jetons utilisés : ${response.usage.totalTokens} (Prompt: ${response.usage.promptTokens}, Completion: ${response.usage.completionTokens})`);
    }
  } catch (error) {
    console.error('Échec de la requête :', (error as Error).message);
  }
}
```

### 3. Consommer un flux Server-Sent Events (SSE) en temps réel

Utilisez la méthode génératrice asynchrone `executeStream()` pour traiter les fragments de texte et de pensée au fur et à mesure de leur émission par le fournisseur.

```typescript
import { executionLayer } from '../../src/providers/layer0/ExecutionLayer.js';

async function runStreamingCompletion() {
  const abortController = new AbortController();

  // Annulation automatique après 10 secondes de garde
  const timeout = setTimeout(() => abortController.abort(), 10000);

  try {
    const stream = executionLayer.executeStream('gpt-4o', request, {
      signal: abortController.signal,
    });

    for await (const chunk of stream) {
      if (chunk.thought) {
        process.stdout.write(`\x1b[33m[Pensée] ${chunk.thought}\x1b[0m`);
      }
      if (chunk.content) {
        process.stdout.write(chunk.content);
      }
      if (chunk.done) {
        console.log('\n[Flux terminé]');
      }
    }
  } catch (err) {
    console.error('\nInterruption du flux :', (err as Error).message);
  } finally {
    clearTimeout(timeout);
  }
}
```

### 4. Définir des outils fonctionnels (Tool Calling)

Layer 0 sérialise automatiquement les définitions d'outils et parse les `tool_calls` retournés :

```typescript
import type { ExecutionRequest } from '../../src/providers/layer0/ExecutionLayer.js';
import { executionLayer } from '../../src/providers/layer0/ExecutionLayer.js';

const toolRequest: ExecutionRequest = {
  messages: [{ role: 'user', content: 'Quelle est la météo à Paris ?' }],
  tools: [
    {
      type: 'function',
      function: {
        name: 'get_weather',
        description: 'Récupère la météo en direct pour une ville donnée.',
        parameters: {
          type: 'object',
          properties: {
            city: { type: 'string', description: 'Le nom de la ville' },
          },
          required: ['city'],
        },
      },
    },
  ],
  tool_choice: 'auto',
};

const toolResult = await executionLayer.execute('gpt-4o', toolRequest);
if (toolResult.toolCalls && toolResult.toolCalls.length > 0) {
  for (const call of toolResult.toolCalls) {
    console.log(`Outil appelé : ${call.function.name}`);
    console.log(`Arguments : ${call.function.arguments}`);
  }
}
```

## Cas Particuliers & Variantes

### Variante A : Mocker l'appel réseau pour les tests unitaires
Pour tester votre logique sans consommer de quota d'API distant, utilisez `jest.spyOn(global, 'fetch')` :

```typescript
const mockResponse = new Response(
  JSON.stringify({
    id: 'chatcmpl-mock-123',
    choices: [
      {
        message: { role: 'assistant', content: 'Réponse mockée unitaire' },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  }),
  { status: 200, headers: { 'Content-Type': 'application/json' } }
);

jest.spyOn(global, 'fetch').mockResolvedValueOnce(mockResponse);
```

### Variante B : Forcer une clé API dédiée
Pour utiliser une clé de compte spécifique sans modifier les variables globales :

```typescript
const result = await executionLayer.execute('gpt-4o', request, {
  apiKey: 'sk-proj-custom-ephemeral-key',
});
```

## Vérification & Validation

Exécutez la suite de tests unitaires dédiée à Layer 0 avec les drapeaux ESM de Jest :

```bash
NODE_ENV=test SUPABASE_URL=http://localhost:54321 SUPABASE_KEY=dummy REDIS_URL=redis://localhost:6379 NODE_OPTIONS='--experimental-vm-modules --no-warnings' npx jest src/tests/unit/providers/layer0.test.ts --runInBand
```

Résultat attendu dans le terminal :
```text
PASS src/tests/unit/providers/layer0.test.ts
  Layer 0 - Domain Errors (errors.ts)
    ✓ instantiates Layer0Error sub-classes with correct properties
  Layer 0 - Error Classification (classifyError.ts)
    ✓ classifies network / timeout errors when status is 0 or undefined
    ✓ classifies 401 and 403 as AuthError
    ✓ classifies 429 as RateLimitError and parses retryAfterHeader
    ✓ classifies content filter / safety responses as ContentFilterError
    ✓ classifies 400 and 422 as InvalidRequestError
    ✓ classifies 5xx as ServerError
    ✓ falls back to ServerError for unhandled HTTP status codes
  Layer 0 - ModelRegistry
    ✓ loads models_config.json and resolves existing model configs
    ✓ resolves anthropic model config correctly
    ✓ throws InvalidRequestError for unknown models
    ✓ lists models and gets raw config
  Layer 0 - ExecutionLayer
    ✓ executes a valid request and parses response successfully
    ✓ throws AuthError when API key is missing
    ✓ classifies 401 error as AuthError
    ✓ classifies 429 error as RateLimitError
    ✓ classifies 500 error as ServerError
    ✓ classifies invalid JSON response as ServerError
    ✓ classifies timeout network error via AbortController
    ✓ handles external AbortSignal pre-aborted or aborted during call
  Layer 0 - ExecutionLayer Streaming
    ✓ supports streaming via executeStream
    ✓ handles streaming with empty response body
    ✓ handles streaming error response (non-ok HTTP status)
    ✓ delegates execution via ExecutionLayer class instance

Test Suites: 1 passed, 1 total
Tests:       24 passed, 24 total
```

## Guide de Dépannage (Troubleshooting)

| Symptôme / Message d'Erreur | Cause Probable | Solution Immédiate |
| :--- | :--- | :--- |
| `AuthError: No API key available for provider "openai"` | La variable d'environnement `OPENAI_API_KEY` n'est pas définie dans `.env` et aucune clé n'est fournie dans `opts.apiKey`. | Renseigner `OPENAI_API_KEY` dans votre environnement ou passer `opts.apiKey`. |
| `InvalidRequestError: Model "xyz" is not registered in models_config.json` | L'identifiant de modèle demandé n'existe pas dans le dictionnaire `familles.<provider>.modeles`. | Vérifier l'orthographe du modèle dans `src/config/models_config.json` ou appeler `ModelRegistry.getInstance().listModels()`. |
| `NetworkError: ExecutionLayer: request timed out or was aborted after 60000ms` | La connexion réseau a été rompue ou le modèle a mis plus de temps à répondre que le plafond configuré. | Augmenter `opts.timeoutMs` (ex. `120000`) pour les modèles lents à fort raisonnement. |
| `RateLimitError: Rate limit exceeded (429)` | Quota atteint ou saturation temporaire chez le fournisseur. | Récupérer `error.retryAfterMs` et attendre avant de retenter, ou confier la gestion du repli à Layer 1 (`SmartLayer`). |
