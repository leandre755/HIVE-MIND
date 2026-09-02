# Advanced OAuth Adapters (Codex & Antigravity) — Référence Technique

Ce document fournit la spécification formelle et exhaustive des adaptateurs protocolaires avancés **Codex** (OpenAI ChatGPT Plus/Pro) et **Antigravity** (Google Cloud Code Assist).

- **Fichiers sources :** `src/providers/adapters/codex.ts`, `src/providers/adapters/codexProtocol.ts`, `src/providers/adapters/antigravity.ts`, `src/utils/TlsImpersonator.ts`, `src/services/telemetry/ClearcutSimulator.ts`
- **Conteneur IoC :** Implémentations concrètes de l'interface `ProviderAdapter`
- **Dépendances majeures :** `node:crypto`, `node:buffer`, `src/utils/safeFs.ts`, `src/utils/TlsImpersonator.ts`

## 1. Interfaces & Types TypeScript

```typescript
import type {
  ChatMessage,
  AdapterChatOptions,
  AdapterChatResult,
  ProviderAdapter,
  ToolCall,
  TokenUsage,
} from '../types.js';

export interface CodexJwtPayload {
  exp?: number;
  'https://api.openai.com/auth'?: { chatgpt_account_id?: string };
}

export interface CodexAuthTokens {
  access_token?: string;
  refresh_token?: string;
  account_id?: string;
}

export interface CodexAuthFile {
  tokens?: CodexAuthTokens;
  [key: string]: unknown;
}

export interface OAuthTokenResponse {
  access_token?: string;
  refresh_token?: string;
}

export interface GoogleJwtPayload {
  exp?: number;
  iss?: string;
  aud?: string;
  sub?: string;
  email?: string;
}

export interface GoogleOAuthTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
  refresh_token?: string;
}

export interface CodeAssistRequestWrapper {
  projectNumber?: string;
  location?: string;
  model?: string;
  request: Record<string, unknown>;
}
```

## 2. Classes & Signatures de Méthodes

### Adaptateur `CodexAdapter` (`src/providers/adapters/codex.ts`)

#### Méthode `chat(messages, options)`
```typescript
public async chat(
  messages: ChatMessage[],
  options?: AdapterChatOptions
): Promise<AdapterChatResult>
```

**Paramètres :**
| Paramètre | Type | Obligatoire | Défaut | Description |
| :--- | :--- | :--- | :--- | :--- |
| `messages` | `ChatMessage[]` | Oui | — | Historique de la conversation au format standard. |
| `options` | `AdapterChatOptions` | Non | `{}` | Options : `model`, `temperature`, `max_tokens`, `tools`, `timeoutMs`. |

**Valeur de retour :**
- `Promise<AdapterChatResult>` : Résultat standardisé contenant `content`, `toolCalls`, `usage`.

**Exceptions Levées :**
| Type d'Erreur | Condition de Déclenchement |
| :--- | :--- |
| `Error: Aucun token d'accès Codex disponible` | Ni variable d'environnement ni fichier `auth.json` présent. |
| `Error: Échec du rafraîchissement OAuth Codex` | Le `refresh_token` a été révoqué ou rejeté par `auth.openai.com`. |
| `Error: Erreur Codex HTTP [status]` | L'endpoint Responses a retourné une erreur HTTP $\ge 400$. |

---

#### Méthode `chatStream(messages, options)`
```typescript
public async *chatStream(
  messages: ChatMessage[],
  options?: AdapterChatOptions
): AsyncIterable<StreamChunk>
```
Retourne un flux asynchrone émettant les blocs de texte et d'outils au format SSE Responses.

---

### Adaptateur `AntigravityAdapter` (`src/providers/adapters/antigravity.ts`)

#### Méthode `chat(messages, options)`
```typescript
public async chat(
  messages: ChatMessage[],
  options?: AdapterChatOptions
): Promise<AdapterChatResult>
```

**Paramètres :**
Identiques à `CodexAdapter.chat()`.

**Fonctionnement Interne :**
1. Valide le token Google OAuth (délai $T - 300\text{ s}$).
2. Formate le payload `CodeAssistRequest` avec dialecte Gemini.
3. Émet la requête via `TlsImpersonator` et envoie la télémétrie `ClearcutSimulator`.

---

## 3. Schéma de Configuration & Variables d'Environnement

| Variable d'Environnement | Type | Défaut | Obligatoire | Description |
| :--- | :--- | :--- | :--- | :--- |
| `CODEX_ACCESS_TOKEN` | `string` | — | Non | Jeton d'accès JWT OpenAI Codex (production). |
| `CODEX_REFRESH_TOKEN` | `string` | — | Non | Jeton de rafraîchissement OAuth OpenAI. |
| `ANTIGRAVITY_ACCESS_TOKEN` | `string` | — | Non | Jeton d'accès Google Cloud Code Assist. |
| `ANTIGRAVITY_REFRESH_TOKEN` | `string` | — | Non | Jeton de rafraîchissement Google OAuth. |
| `ANTIGRAVITY_PROJECT_ID` | `string` | `rising-fact-p41fc`| Non | Identifiant du projet Google Cloud ciblé. |

### Fichier local de développement (`~/.codex/auth.json`)
```json
{
  "tokens": {
    "access_token": "<token_jwt_exemple>",
    "refresh_token": "<token_refresh_exemple>",
    "account_id": "user_xyz123"
  },
  "last_refresh": "2026-09-01T12:00:00Z"
}
```

---

## 4. Codes d'Erreur & États Internes

| Code / Statut | Signification | Comportement Système |
| :--- | :--- | :--- |
| `AUTH_EXPIRED` | Le jeton d'accès a expiré ($T_{\text{exp}} - \text{now} \le 300\text{ s}$). | Déclenche automatiquement un appel de rafraîchissement proactif. |
| `ERR_REFRESH_FAILED` | Le `refresh_token` est invalide ou révoqué. | Lève une `AuthError` invitant l'administrateur à se réauthentifier via la CLI. |
| `TLS_HANDSHAKE_ERROR` | L'endpoint distant a rejeté la négociation de chiffrement. | Vérifier la configuration des suites de chiffrement de `TlsImpersonator`. |

---

## 5. Exemple d'Utilisation Minimal

```typescript
import { codexAdapter } from '../../src/providers/adapters/codex.js';

const messages = [
  { role: 'user' as const, content: 'Écris un algorithme de tri rapide en TypeScript.' }
];

const result = await codexAdapter.chat(messages, {
  model: 'gpt-5.5',
  temperature: 0.2,
});

console.log('Réponse Codex :', result.content);
if (result.usage) {
  console.log(`Tokens utilisés : ${result.usage.totalTokens}`);
}
```

---

## 6. Limitations & Invariants Opérationnels

- **Invariant Never-Throw de `decodeJwt`** : Tout token corrompu, vide ou tronqué retourne `null` sans jamais interrompre la boucle Node.js.
- **Marge de Sécurité Proactive** : `REFRESH_MARGIN_SECONDS = 300`. Aucun appel réseau n'est émis avec un jeton valide pour moins de 5 minutes.
- **Atomicité des Écritures Fichier** : Les écritures dans `~/.codex/auth.json` préservent l'intégralité des métadonnées existantes.
