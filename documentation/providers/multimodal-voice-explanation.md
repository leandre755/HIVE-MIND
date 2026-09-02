# Multimodal Voice Synthesis & Real-Time Streaming — Architecture & Principes de Fonctionnement

Le sous-système **SS-14 (Multimodal Voice Synthesis & Real-Time Streaming)** fournit une infrastructure audio complète, couvrant la synthèse vocale multi-moteurs (TTS) hautement expressive et la communication conversationnelle bidirectionnelle native en temps réel via WebSocket (Gemini Live API).

## 1. Contexte & Problématique d'Ingénierie

Pour interagir naturellement avec les utilisateurs sur des canaux de messagerie instantanée (WhatsApp, Telegram) ou au sein d'interfaces temps réel, l'agent doit disposer de capacités audio avancées :
- **Conversion Text-To-Speech (TTS) haute fidélité** : Les messages textuels doivent être transformés en notes vocales au format standard OGG Opus avec une prosodie naturelle, une gestion d'émotions et des accents variés.
- **Résilience et cascade multi-fournisseurs de voix** : En cas d'épuisement de quota ou de défaillance du moteur de voix principal (Minimax Speech-01), le système doit basculer instantanément sur des alternatives de repli (Gemini Flash TTS avec *Director's Notes*, puis Google Translate TTS).
- **Communication bidirectionnelle ultra-faible latence** : Les flux audio conversationnels en direct ne peuvent tolérer les délais d'un pipeline séquentiel Transcription $\to$ LLM $\to$ TTS. Une session WebSocket native full-duplex (PCM 24kHz) est nécessaire.
- **Exécution d'outils en direct pendant la parole (*Live Tool Calling*)** : L'agent doit être capable d'appeler des outils d'information (météo, recherche, domotique) tout en maintenant le flux vocal ouvert.

SS-14 répond à ces besoins en instaurant une couche unifiée de synthèse vocale découplée et un gestionnaire de sessions temps réel full-duplex.

## 2. Modèle Mental & Architecture Conceptuelle

```
                               ┌───────────────────────────┐
                               │   VoiceProvider / Core    │
                               │  (Résolution voix/modèle  │
                               │   dans models_config.json)│
                               └─────────────┬─────────────┘
                                             │
                      ┌──────────────────────┼──────────────────────┐
                      │                      │                      │
                      ▼ (Mode Asynchrone)    │                      ▼ (Mode Temps Réel)
        ┌───────────────────────────┐        │        ┌───────────────────────────┐
        │  Moteurs de Synthèse TTS  │        │        │   Gemini 2.5 Live Audio   │
        │                           │        │        │      (WebSocket WS)       │
        │ 1. Minimax TTS (Primary)  │        │        │                           │
        │    - Speech-01 (HD MP3)   │        │        │ - Full-Duplex PCM 24kHz   │
        │                           │        │        │ - Détection d'interruption│
        │ 2. Gemini Flash TTS       │        │        │ - Tool Calling Callbacks  │
        │    - Director's Notes     │        │        │   (onToolCall)            │
        │    - Style, Tone, Accent  │        │        └─────────────┬─────────────┘
        │                           │        │                      │
        │ 3. GTTS (Free Fallback)   │        │                      ▼
        │    - Sans clé API         │        │              [Flux Audio PCM]
        └─────────────┬─────────────┘        │
                      │                      │
                      ▼                      │
        ┌───────────────────────────┐        │
        │  Pipeline Encodage FFmpeg │        │
        │  (Conversion vers OGG     │        │
        │   Opus 16kHz WhatsApp)    │        │
        └─────────────┬─────────────┘        │
                      │                      │
                      ▼                      │
            [TTSResult: OGG Buffer]          │
```

### Mécanismes et Flux de Données

1. **Pipeline de Synthèse Vocale (TTS)** :
   - Le consommateur transmet un texte et des `TTSOptions` (`voice`, `speed`, `style`, `tone`, `accent`, `pace`).
   - Le moteur cible (Minimax ou Gemini Flash) génère un flux audio brut (MP3 ou PCM 24kHz).
   - `ffmpeg` convertit le flux brut en format standardisé `OGG Opus` avec en-têtes adaptés pour les lecteurs vocaux WhatsApp et Telegram.
2. **Consignes de Jeu Acteur ("Director's Notes")** :
   Pour l'adaptateur `GeminiTTSAdapter`, les options de prosodie (`style`, `tone`, `accent`, `pace`, `speaker_1`) sont injectées dynamiquement en préfixe du prompt sous la forme `(Tone: calm. Accent: french. Pace: moderate)`.
3. **Session Temps Réel Bidirectionnelle (Gemini Live)** :
   - Établissement d'une connexion WebSocket persistante vers l'API Live de Google via le SDK `@google/genai`.
   - Streaming continu des paquets audio utilisateur encodés en PCM 24kHz.
   - Réception en temps réel des fragments `modelTurn` et accumulation des buffers audio.
   - Interception des événements `LiveServerToolCall` et exécution des callbacks `onToolCall` sans couper la session vocale.

## 3. Choix de Conception & Raisons d'Ingénierie

- **Découplage Total des Modèles et Voix** : Aucun identifiant de voix en dur n'est présent dans le code source. Toutes les voix et correspondances proviennent de `src/config/models_config.json` (`voice_provider.tts_models[]`).
- **Chaîne de Repli en 3 Niveaux** :
  1. *Niveau 1 : Minimax Speech-01* — Voix ultra-réaliste haute fidélité.
  2. *Niveau 2 : Gemini Flash TTS* — Voix polyvalente à faible latence ($< 300\text{ ms}$) avec contrôle expressif.
  3. *Niveau 3 : Google Translate TTS (GTTS)* — Filet de secours gratuit, sans clé d'authentification ni quota.
- **Isolation Fichier et Nettoyage Automatique** : Les fichiers intermédiaires générés dans `temp/voice_cache` utilisent `safeUnlink` dans des blocs `finally` pour garantir qu'aucun résidu temporaire ne sature l'espace disque.

## 4. Analyse Comparative & Alternatives Écartées

| Approche Alternative | Avantages Théoriques | Inconvénients / Raisons du Rejet par HIVE-MIND |
| :--- | :--- | :--- |
| **Pipeline Séquentiel STT $\to$ LLM $\to$ TTS** | Réutilise les briques existantes séparées. | Latence incompressible de 3 à 5 secondes, rendant impossible une véritable conversation vocale fluide en direct. |
| **Génération Audio MP3 Directe sans Conversion** | Pas de dépendance à `ffmpeg`. | Les notes vocales WhatsApp exigent le conteneur OGG avec le codec Opus pour être affichées sous forme d'ondes audio interactives. |
| **Bibliothèques TTS Web Audio API** | Pas de serveurs distants. | Incompatible avec un démon Node.js headless tournant sur un serveur Linux sans navigateur graphique. |

## 5. Frontières Architecturales & Invariants

### Ce qui est DANS le périmètre de SS-14 :
- Définition des contrats universels `TTSOptions`, `TTSResult`, `TTSAdapterConfig`.
- Adaptateurs de synthèse `MinimaxTTSAdapter`, `GeminiTTSAdapter`, `GttsTTSAdapter`.
- Encodage audio et conversion de formats via `fluent-ffmpeg`.
- Gestion des sessions WebSocket bidirectionnelles `GeminiLiveProvider`.

### Ce qui est EXCLU de SS-14 :
- L'envoi physique des messages vocaux sur les canaux WhatsApp/Discord (délégué à `TransportManager` — SS-15).
- L'arbitrage de priorité entre réponse texte et réponse vocale (délégué au Core — SS-01..SS-09).

## 6. Liens & Navigation

- **Référence Technique :** [`multimodal-voice-reference.md`](./multimodal-voice-reference.md)
- **Guide Pratique d'Intégration :** [`multimodal-voice-howto.md`](./multimodal-voice-howto.md)
- **Index du Domaine Fournisseurs :** [`index.md`](./index.md)
