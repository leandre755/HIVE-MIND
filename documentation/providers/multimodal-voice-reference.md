# Multimodal Voice Synthesis & Real-Time Streaming — Référence Technique

Ce document fournit la spécification formelle et exhaustive du sous-système de synthèse vocale et d'audio temps réel **SS-14**.

- **Fichiers sources :** `src/providers/adapters/ttsTypes.ts`, `src/providers/adapters/geminiTTS.ts`, `src/providers/adapters/minimaxTTS.ts`, `src/providers/adapters/gttsTTS.ts`, `src/providers/geminiLive.ts`, `src/providers/adapters/geminiLive.ts`
- **Conteneur IoC :** Classes instanciées par le service `VoiceProvider`
- **Dépendances majeures :** `@google/genai`, `fluent-ffmpeg`, `@ffmpeg-installer/ffmpeg`, `src/utils/safeFs.ts`

## 1. Interfaces & Types TypeScript

```typescript
export interface TTSOptions {
  model?: string;
  voice?: string;
  voice_id?: string;
  language?: string;
  speed?: number;
  vol?: number;
  pitch?: number;
  style?: string;
  tone?: string;
  accent?: string;
  pace?: string;
  speaker_1?: string;
  speaker_2?: string;
}

export interface TTSResult {
  audioBuffer: Buffer;
  format: string;
  filePath?: string;
  provider?: string;
  model?: string;
}

export interface TTSAdapterConfig {
  speed?: number;
  vol?: number;
  pitch?: number;
  language?: string;
}

export interface GeminiLiveResponse {
  audioParts: string[];
  audioBuffer: Buffer | null;
  transcription: string;
  emotion: string | null;
  filePath?: string;
}

export interface GeminiLiveProviderOptions {
  model?: string;
  voice?: string;
  tools?: unknown[];
  onToolCall?: ((call: unknown) => Promise<Record<string, unknown>>) | null;
}
```

## 2. Classes & Signatures de Méthodes

### `MinimaxTTSAdapter` (`src/providers/adapters/minimaxTTS.ts`)

#### Constructeur
```typescript
constructor(apiKey: string | undefined, config?: TTSAdapterConfig)
```

#### Méthode `synthesize(text, options)`
```typescript
public async synthesize(text: string, options?: TTSOptions): Promise<TTSResult>
```
Génère une note vocale OGG Opus via l'API Minimax `POST https://api.minimax.io/v1/t2a_v2`.

**Paramètres :**
| Paramètre | Type | Obligatoire | Description |
| :--- | :--- | :--- | :--- |
| `text` | `string` | Oui | Le texte à synthétiser. |
| `options.model` | `string` | Oui | Modèle résolu (ex. `speech-01-turbo`). |
| `options.voice_id` | `string` | Oui | Identifiant de voix Minimax (ex. `male-qn-qingse`). |
| `options.speed` | `number` | Non | Vitesse d'élocution (défaut `1.0`). |

---

### `GeminiTTSAdapter` (`src/providers/adapters/geminiTTS.ts`)

#### Constructeur
```typescript
constructor(apiKey: string | undefined, config?: TTSAdapterConfig)
```

#### Méthode `synthesize(text, options)`
```typescript
public async synthesize(text: string, options?: TTSOptions): Promise<TTSResult>
```
Injecte les *Director's Notes* en préfixe et génère l'audio via l'API Generative Language.

**Options Expressives (Director's Notes) :**
| Option | Type | Exemple | Rôle |
| :--- | :--- | :--- | :--- |
| `style` | `string` | `"enthusiastic"`, `"storyteller"` | Style global de narration. |
| `tone` | `string` | `"calm"`, `"authoritative"` | Tonalité émotionnelle. |
| `accent` | `string` | `"french"`, `"british"` | Accent ou variante régionale. |
| `pace` | `string` | `"fast"`, `"slow"` | Rythme d'élocution. |

---

### `GttsTTSAdapter` (`src/providers/adapters/gttsTTS.ts`)

#### Méthode `synthesize(text, options)`
```typescript
public async synthesize(text: string, options?: TTSOptions): Promise<TTSResult>
```
Moteur de repli de dernier recours sans clé API. Découpe le texte en segments de $\le 200$ caractères et concatène les flux MP3 avant conversion en OGG Opus.

---

### `GeminiLiveProvider` (`src/providers/geminiLive.ts`)

#### Constructeur
```typescript
constructor(options?: GeminiLiveProviderOptions)
```

#### Méthodes Principales
| Méthode | Signature | Rôle |
| :--- | :--- | :--- |
| `initSession` | `public async initSession(customPrompt?: string): Promise<void>` | Ouvre la session WebSocket vers l'API Live de Google. |
| `processAudio` | `public async processAudio(audioBuffer: Buffer, mimeType?: string): Promise<GeminiLiveResponse>` | Envoie un paquet audio PCM 24kHz et attend la réponse du modèle. |
| `textToSpeech` | `public async textToSpeech(text: string, options?: GeminiLiveCallOptions): Promise<GeminiLiveResponse>` | Synthétise du texte en direct via la session Live. |
| `close` | `public async close(): Promise<void>` | Ferme proprement la socket WebSocket et libère les verrous. |

---

## 3. Schéma de Configuration dans `models_config.json`

```json
{
  "voice_provider": {
    "default_provider": "minimax",
    "minimax_config": {
      "speed": 1.0,
      "vol": 1.0,
      "pitch": 0
    },
    "tts_models": [
      {
        "provider": "minimax",
        "model": "speech-01-turbo",
        "voice_id": "male-qn-qingse",
        "priority": 1
      },
      {
        "provider": "gemini",
        "model": "gemini-2.0-flash-exp",
        "voice": "Zephyr",
        "priority": 2
      },
      {
        "provider": "gtts",
        "language": "fr",
        "priority": 99
      }
    ]
  }
}
```

---

## 4. Codes d'Erreur & États Internes

| Code / Message | Signification | Comportement Système |
| :--- | :--- | :--- |
| `Clé API Minimax manquante ou invalide` | L'adaptateur Minimax n'a pas trouvé de clé dans la configuration. | `VoiceProvider` bascule automatiquement sur le modèle de priorité suivante (Gemini TTS). |
| `FFMPEG_CONVERSION_ERROR` | L'utilitaire ffmpeg a échoué lors du transcodage vers OGG Opus. | Nettoyage des fichiers temporaires et levée d'exception typée. |
| `WS_CONNECTION_CLOSED` | La connexion WebSocket Gemini Live a été fermée par le serveur distant. | Reconnexion automatique lors de l'appel suivant via `initSession()`. |

---

## 5. Exemple d'Utilisation Minimal

```typescript
import { MinimaxTTSAdapter } from '../../src/providers/adapters/minimaxTTS.js';
import { GeminiTTSAdapter } from '../../src/providers/adapters/geminiTTS.js';

// 1. Synthèse avec Minimax
const minimax = new MinimaxTTSAdapter(process.env.MINIMAX_API_KEY);
const audioResult = await minimax.synthesize('Bonjour, voici votre résumé quotidien.', {
  model: 'speech-01-turbo',
  voice_id: 'male-qn-qingse',
});

console.log('Audio OGG généré :', audioResult.audioBuffer.length, 'octets');

// 2. Synthèse avec Gemini et Director's Notes
const gemini = new GeminiTTSAdapter(process.env.GEMINI_API_KEY);
const geminiResult = await gemini.synthesize('Attention, une alerte système a été détectée.', {
  model: 'gemini-2.0-flash-exp',
  voice: 'Puck',
  tone: 'urgent',
  pace: 'fast',
});
```

---

## 6. Limitations & Invariants Opérationnels

- **Fréquence d'Échantillonnage Audio** :
  - Flux d'entrée/sortie Gemini Live : PCM 24kHz mono 16-bit.
  - Sortie finale TTS : OGG Opus 16kHz mono (optimisé pour WhatsApp).
- **Gestion des Fichiers Temporaires** : Répertoire `temp/voice_cache/` nettoyé de manière synchrone ou asynchrone après chaque transcodage.
