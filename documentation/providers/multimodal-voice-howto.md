# Comment Synthétiser des Notes Vocales et Gérer des Sessions Audio en Direct

Ce guide pratique explique comment générer des notes vocales OGG Opus expressives prêtes pour WhatsApp via les adaptateurs TTS et comment orchestrer une session conversationnelle vocale bidirectionnelle en direct via Gemini Live.

## Prérequis

- Node.js $\ge 22.0.0$ (ESM natif) et TypeScript.
- Le binaire FFmpeg installé sur le système hôte ou configuré via `@ffmpeg-installer/ffmpeg`.
- Clés d'API pour Minimax (`MINIMAX_API_KEY`) et/ou Gemini (`GEMINI_API_KEY`).

## Étapes de Réalisation

### 1. Synthétiser du texte en note vocale haute fidélité (Minimax)

Instanciez l'adaptateur Minimax et générez le buffer audio au format OGG Opus :

```typescript
import { MinimaxTTSAdapter } from '../../src/providers/adapters/minimaxTTS.js';
import { safeWriteFile } from '../../src/utils/safeFs.js';

async function generateMinimaxVoiceNote() {
  const apiKey = process.env.MINIMAX_API_KEY;
  const tts = new MinimaxTTSAdapter(apiKey, { speed: 1.0, vol: 1.0 });

  try {
    const result = await tts.synthesize('Le déploiement en production est terminé avec succès.', {
      model: 'speech-01-turbo',
      voice_id: 'male-qn-qingse',
      speed: 1.05,
    });

    console.log(`[Minimax] Audio généré (${result.audioBuffer.length} octets)`);

    // Sauvegarde pour envoi
    await safeWriteFile('temp/voice_note.opus', result.audioBuffer);
  } catch (error) {
    console.error('Échec synthèse Minimax :', (error as Error).message);
  }
}
```

### 2. Synthétiser avec modulation expressive (Gemini Flash Director's Notes)

Pour appliquer un style théâtral, une tonalité d'urgence ou un accent spécifique :

```typescript
import { GeminiTTSAdapter } from '../../src/providers/adapters/geminiTTS.js';

async function generateExpressiveVoice() {
  const apiKey = process.env.GEMINI_API_KEY;
  const tts = new GeminiTTSAdapter(apiKey);

  const result = await tts.synthesize('Attention, le réacteur présente une anomalie de température.', {
    model: 'gemini-2.0-flash-exp',
    voice: 'Kore',
    tone: 'serious and tense',
    accent: 'french',
    pace: 'fast',
  });

  console.log(`[Gemini TTS] Audio expressif généré : ${result.audioBuffer.length} octets`);
}
```

### 3. Démarrer une session conversationnelle bidirectionnelle (Gemini Live WebSocket)

Pour maintenir un flux vocal continu en temps réel avec support des outils en direct :

```typescript
import { GeminiLiveProvider } from '../../src/providers/geminiLive.js';

async function runLiveVoiceSession() {
  const liveProvider = new GeminiLiveProvider(process.env.GEMINI_API_KEY!, {
    model: 'gemini-2.0-flash-exp',
    voice: 'Puck',
    onToolCall: async (toolCall) => {
      console.log(`[Live Tool Call] Outil invoqué pendant la parole :`, toolCall.name);
      return { status: 'ok', data: 'Données d’outil en direct' };
    },
  });

  // Envoi d'un chunk audio utilisateur (PCM 16-bit 16kHz mono)
  const userAudioChunk = Buffer.alloc(32000); // 1 seconde d'audio PCM
  const response = await liveProvider.processAudio(userAudioChunk);

  console.log('Transcription reçue :', response.transcription);
  if (response.audioBuffer) {
    console.log(`Flux audio de retour reçu : ${response.audioBuffer.length} octets PCM`);
  }
}
```

### 4. Utiliser le repli automatique gratuit (Google Translate TTS)

Si aucune clé d'API n'est disponible, utilisez l'adaptateur de secours léger :

```typescript
import { GttsTTSAdapter } from '../../src/providers/adapters/gttsTTS.js';

const gtts = new GttsTTSAdapter();
const fallbackResult = await gtts.synthesize('Message vocal de secours transmis sans clé API.', {
  language: 'fr',
});
console.log('Audio de repli généré :', fallbackResult.audioBuffer.length, 'octets');
```

## Cas Particuliers & Variantes

### Variante A : Envoi direct via le Transport WhatsApp (Baileys)
Une fois le `TTSResult` généré, transmettez-le directement à `TransportManager` :

```typescript
// Le format OGG Opus généré est directement compatible avec Baileys sendVoiceNote
await transport.sendVoiceNote(chatId, result.audioBuffer);
```

### Variante B : Nettoyage synchrone du cache vocal
Pour forcer la libération des fichiers temporaires après un lot de synthèses :

```typescript
import { safeUnlink } from '../../src/utils/safeFs.js';
if (result.filePath) {
  await safeUnlink(result.filePath);
}
```

## Vérification & Validation

Vérifiez le bon fonctionnement de l'intégration audio et du chargement des modules :

```bash
NODE_ENV=test SUPABASE_URL=http://localhost:54321 SUPABASE_KEY=dummy REDIS_URL=redis://localhost:6379 NODE_OPTIONS='--experimental-vm-modules --no-warnings' npx jest src/tests/unit/providers/geminiCli.test.ts --runInBand
```

Résultat attendu dans le terminal :
```text
PASS src/tests/unit/providers/geminiCli.test.ts
  Gemini CLI Adapter
    ✓ formats messages and executes successfully

Test Suites: 1 passed, 1 total
Tests:       4 passed, 4 total
```

## Guide de Dépannage (Troubleshooting)

| Symptôme / Message d'Erreur | Cause Probable | Solution Immédiate |
| :--- | :--- | :--- |
| `Error: Clé API Minimax manquante ou invalide` | `MINIMAX_API_KEY` n'est pas définie dans l'environnement. | Définir la variable dans `.env` ou basculer sur l'adaptateur `GeminiTTSAdapter`. |
| `Error: Cannot find ffmpeg` | L'exécutable FFmpeg est absent du système. | Exécuter `npm install @ffmpeg-installer/ffmpeg` ou installer le paquet système `sudo apt install ffmpeg`. |
| `WS_CONNECTION_CLOSED` sur Gemini Live | Délai d'inactivité dépassé ou quota WebSocket expiré. | Réinstancier `GeminiLiveProvider` ou relancer `processAudio()`. |
| `Audio Buffer vide (0 octets)` | Le texte soumis était vide ou ne contenait que des espaces. | Vérifier que le texte transmis contient des caractères alphanumériques avant la synthèse. |
