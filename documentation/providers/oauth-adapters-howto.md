# Comment Intégrer et Authentifier les Modèles Avancés via Codex et Antigravity

Ce guide pratique détaille la procédure de configuration, d'authentification OAuth et de consommation des modèles de pointe via les adaptateurs **OpenAI Codex** et **Google Antigravity Code Assist**.

## Prérequis

- Node.js $\ge 22.0.0$ (ESM natif) et TypeScript configuré.
- Un abonnement valide OpenAI ChatGPT Plus/Pro ou un accès Google Cloud Code Assist.
- Le fichier `~/.codex/auth.json` généré par la CLI officielle OpenAI, ou les jetons d'environnement (`CODEX_ACCESS_TOKEN`, `CODEX_REFRESH_TOKEN`).

## Étapes de Réalisation

### 1. Configurer les jetons d'authentification

#### Méthode A : En développement local via le fichier partagé
Si vous utilisez la CLI officielle OpenAI Codex sur votre machine, l'adaptateur détecte et charge automatiquement le fichier `~/.codex/auth.json` :

```bash
# Vérifier la présence du fichier d'authentification
ls -la ~/.codex/auth.json
```

#### Méthode B : En production via les variables d'environnement
Sur un serveur de production ou un conteneur (ex. Railway / Docker), renseignez les variables d'environnement dans votre fichier `.env` :

```env
CODEX_ACCESS_TOKEN=<token_jwt_exemple>
CODEX_REFRESH_TOKEN=<token_refresh_exemple>
ANTIGRAVITY_ACCESS_TOKEN=<token_oauth_exemple>
ANTIGRAVITY_REFRESH_TOKEN=<token_refresh_exemple>
ANTIGRAVITY_PROJECT_ID=mon-projet-id
```

### 2. Consommer l'adaptateur OpenAI Codex

Importez l'adaptateur `codex` et effectuez une requête d'inférence avec streaming ou mode bloquant :

```typescript
import { codexAdapter } from '../../src/providers/adapters/codex.js';
import type { ChatMessage } from '../../src/providers/types.js';

async function queryCodex() {
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: 'Tu es un assistant de programmation expert.',
    },
    {
      role: 'user',
      content: 'Écris une fonction de hachage FNV-1a en TypeScript strict.',
    },
  ];

  try {
    const result = await codexAdapter.chat(messages, {
      model: 'gpt-5.5',
      temperature: 0.2,
      max_tokens: 2000,
    });

    console.log('Réponse reçue de Codex :');
    console.log(result.content);
  } catch (error) {
    console.error('Erreur Codex :', (error as Error).message);
  }
}
```

### 3. Consommer l'adaptateur Google Antigravity

Pour accéder aux modèles Google Cloud Code Assist via le flux impersoné :

```typescript
import { antigravityAdapter } from '../../src/providers/adapters/antigravity.js';
import type { ChatMessage } from '../../src/providers/types.js';

async function queryAntigravity() {
  const messages: ChatMessage[] = [
    {
      role: 'user',
      content: 'Optimise cet algorithme pour réduire la consommation de mémoire.',
    },
  ];

  try {
    const result = await antigravityAdapter.chat(messages, {
      model: 'gemini-2.5-pro',
      temperature: 0.1,
    });

    console.log('Réponse reçue d’Antigravity :');
    console.log(result.content);
  } catch (error) {
    console.error('Erreur Antigravity :', (error as Error).message);
  }
}
```

### 4. Gérer le rafraîchissement proactif automatique

Les adaptateurs vérifient automatiquement l'expiration du JWT avant chaque requête ($T_{\text{exp}} - \text{now} \le 300\text{ s}$) et renouvellent le jeton en tâche de fond. Vous pouvez forcer un rafraîchissement manuel en cas de besoin :

```typescript
// Décodage du payload JWT sans dépendance externe
function decodeJwt(token: string): { exp?: number } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    return JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8')) as { exp?: number };
  } catch {
    return null;
  }
}

const token = process.env.CODEX_ACCESS_TOKEN || '';
const payload = decodeJwt(token);

if (payload && payload.exp) {
  const expiresInSeconds = payload.exp - Math.floor(Date.now() / 1000);
  console.log(`Le jeton expire dans ${expiresInSeconds} secondes.`);
} else {
  console.log('Jeton absent ou invalide, rafraîchissement requis.');
}
```

## Cas Particuliers & Variantes

### Variante A : Utilisation en Streaming SSE
Pour streamer la réponse événement par événement :

```typescript
if (codexAdapter.chatStream) {
  const stream = codexAdapter.chatStream(messages, { model: 'gpt-5.5' });
  for await (const chunk of stream) {
    if (chunk.content) {
      process.stdout.write(chunk.content);
    }
  }
}
```

### Variante B : Exécution d'Outils (Tool Calling)
Passez la liste des définitions d'outils dans les options :

```typescript
const toolResult = await codexAdapter.chat(messages, {
  model: 'gpt-5.5',
  tools: [
    {
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Lit le contenu d’un fichier.',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
        },
      },
    },
  ],
});
```

## Vérification & Validation

Exécutez la suite de tests unitaires dédiée aux adaptateurs OAuth :

```bash
NODE_ENV=test SUPABASE_URL=http://localhost:54321 SUPABASE_KEY=dummy REDIS_URL=redis://localhost:6379 NODE_OPTIONS='--experimental-vm-modules --no-warnings' npx jest src/tests/unit/providers/antigravity.test.ts --runInBand
```

Résultat attendu dans le terminal :
```text
PASS src/tests/unit/providers/antigravity.test.ts
  Antigravity Adapter
    ✓ decodes Google JWT securely without throwing on malformed input
    ✓ triggers proactive token refresh when exp margin < 300s
    ✓ builds CodeAssistRequest with Gemini schema and tools
    ✓ executes chat request with impersonated TLS headers

Test Suites: 1 passed, 1 total
Tests:       8 passed, 8 total
```

## Guide de Dépannage (Troubleshooting)

| Symptôme / Message d'Erreur | Cause Probable | Solution Immédiate |
| :--- | :--- | :--- |
| `Error: Aucun token d'accès Codex disponible` | Ni variable d'environnement ni fichier `~/.codex/auth.json` n'ont été trouvés. | Se connecter avec la CLI OpenAI officielle ou définir `CODEX_ACCESS_TOKEN` dans `.env`. |
| `Error: Échec du rafraîchissement OAuth (401/400)` | Le `refresh_token` a expiré ou la session a été révoquée depuis le compte web. | Relancer la commande de login de la CLI pour générer une nouvelle paire de tokens. |
| `TLS Handshake Rejection` | Les passerelles distantes ont détecté une incompatibilité de cipher TLS. | Vérifier que `src/utils/TlsImpersonator.ts` est bien activé et que Node.js est en version $\ge 22$. |
