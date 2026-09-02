# Advanced OAuth Adapters (Codex & Antigravity) — Architecture & Principes de Fonctionnement

Le sous-système **SS-13 (Advanced OAuth Adapters)** fournit un pont d'accès transparent, hautement résilient et sécurisé aux modèles de pointe (*State-of-the-Art*) en exploitant les abonnements professionnels et flux OAuth développeurs (OpenAI ChatGPT Plus/Pro via l'API Codex Responses, et Google Cloud Code Assist via le protocole Antigravity).

## 1. Contexte & Problématique d'Ingénierie

L'accès direct aux modèles de fondation les plus récents (famille GPT-5 / Codex Responses API, Claude 3.7 Sonnet Thinking via Cloud Code, Gemini Pro 2.5) soulève des difficultés d'intégration uniques :
- **Absence de clés d'API statiques traditionnelles** : Ces services reposent sur des jetons OAuth 2.0 à courte durée de vie (généralement 3600 secondes) nécessitant un rafraîchissement proactif et une persistance sécurisée sur disque.
- **Dialectes RPC et protocoles internes non standardisés** : L'API OpenAI Codex Responses n'utilise pas la route classique `/v1/chat/completions`, mais un format d'entrée/sortie spécifique avec des flux d'événements multiplexés. De même, Google Antigravity encapsule les requêtes dans une enveloppe RPC `CodeAssistRequest` exigeant une émulation de télémétrie.
- **Contrôles d'empreinte réseau (JA3/JA4 TLS Fingerprinting)** : Les endpoints officiels Google Cloud et OpenAI inspectent la signature TLS du client HTTP pour s'assurer qu'il s'agit d'un client officiel autorisé.
- **Principe de transparence pour le noyau** : Le moteur d'orchestration (`BotCore`, `Planner`, `SmartLayer`) ne doit avoir aucune connaissance des particularités OAuth ou TLS de ces plateformes.

SS-13 résout ces exigences en encapsulant l'intégralité du cycle de vie des jetons, le décodage JWT sans exception, la négociation TLS et l'émulation de télémétrie derrière l'interface polymorphe standard `ProviderAdapter`.

## 2. Modèle Mental & Architecture Conceptuelle

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            Consommateur Noyau                               │
│           (Appelle chat() ou chatStream() sur un ProviderAdapter)           │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Cycle de Vie & Résolution OAuth (SS-13)                  │
│                                                                             │
│  1. Chargement des Tokens (depuis process.env ou ~/.codex/auth.json)        │
│  2. Décodage Sécurisé JWT (decodeJwt -> { exp, account_id })                │
│                                                                             │
│         [Vérification Expiration : T_exp - Now < 300 secondes]              │
│               │                                       │                     │
│               ▼ (Jeton expiré ou manquant)            ▼ (Jeton valide)      │
│      ┌───────────────────────────────┐     ┌───────────────────────┐        │
│      │ Rafraîchissement OAuth        │     │  Jeton Immédiatement  │        │
│      │ POST auth.openai.com/oauth/...│     │       Exploitable     │        │
│      │ Mise à jour atomique auth.json│     └───────────┬───────────┘        │
│      └───────────────┬───────────────┘                 │                    │
│                      └────────────────┬────────────────┘                    │
└───────────────────────────────────────┼─────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     Impersonation & Transport Réseau                        │
│                                                                             │
│   - Adaptateur Codex : Encodage codexProtocol (buildResponsesInput)         │
│   - Adaptateur Antigravity : TlsImpersonator (JA3) + ClearcutSimulator      │
│   - Lecture du flux d'événements en streaming (SSE / RPC chunks)            │
└───────────────────────────────────────┬─────────────────────────────────────┘
                                        │
                                        ▼
                            [AdapterChatResult / SSE]
```

### Mécanismes Clés d'Exécution

1. **Décodage JWT Résilient (`decodeJwt`)** :
   La fonction décode la charge utile base64 du token d'accès sans jamais lever d'exception (*Never-Throw Invariant*). Toute chaîne corrompue retourne `null`, ce qui déclenche un rafraîchissement sans faire crasher le processus.
2. **Rafraîchissement Proactif à Marge de Sécurité ($T - 300\text{ s}$)** :
   Le renouvellement du jeton s'active dès que le temps restant avant expiration passe sous la barre des 5 minutes, éliminant les échecs 401 en cours de longue génération.
3. **Impersonation TLS (`TlsImpersonator`)** :
   Configure les suites cryptographiques (Ciphers, Curves, ALPN) au niveau du socket Node.js TLS pour correspondre exactement à l'empreinte JA3 attendue par les passerelles cloud.
4. **Simulation de Télémétrie (`ClearcutSimulator`)** :
   Transmet en arrière-plan les pings de session périodiques exigés par l'infrastructure Google Cloud pour maintenir la validité du contexte de session.

## 3. Choix de Conception & Raisons d'Ingénierie

- **Polymorphisme Strict `ProviderAdapter`** :
  Tant l'adaptateur Codex que l'adaptateur Antigravity implémentent fidèlement `chat(messages, options)` et `chatStream(messages, options)`. Pour le reste de HIVE-MIND, ces services se comportent exactement comme une API REST OpenAI standard.
- **Double Source de Persistance (Prod Railway vs Dev Local)** :
  Les adaptateurs vérifient en priorité les variables d'environnement (`CODEX_ACCESS_TOKEN`, `ANTIGRAVITY_ACCESS_TOKEN`), idéales pour les conteneurs éphémères en production, avec repli automatique sur le fichier local `~/.codex/auth.json` partagé avec la CLI officielle en développement.
- **Réécriture Atomique et Préservation des Clés Étrangères** :
  Lors de la mise à jour d'`auth.json`, le module fusionne les nouveaux jetons dans la structure existante pour ne pas écraser les champs additionnels créés par les outils externes.

## 4. Analyse Comparative & Alternatives Écartées

| Approche Alternative | Avantages Théoriques | Inconvénients / Raisons du Rejet par HIVE-MIND |
| :--- | :--- | :--- |
| **CLI Wrapper Spawning** (`exec('codex prompt ...')`) | Utilise le binaire officiel directement. | Latence prohibitive due au démarrage d'un processus par message, consommation excessive de RAM et impossibilité de capturer les chunks de stream en mémoire. |
| **Tokens Statiques Longue Durée** | Pas de logique de rafraîchissement à maintenir. | Les fournisseurs n'offrent plus de jetons statiques sans expiration pour leurs abonnements professionnels. |
| **Ignorer la Marge d'Expiration ($T - 0\text{ s}$)** | Moins de requêtes de rafraîchissement. | Si une requête démarre 2 secondes avant l'expiration, la connexion est coupée au milieu du streaming par un HTTP 401. |

## 5. Frontières Architecturales & Invariants

### Ce qui est DANS le périmètre de SS-13 :
- Parsing sécurisé des JWTs et calcul des fenêtres d'expiration.
- Renouvellement OAuth 2.0 via `refresh_token` et persistance atomique.
- Encodage/Décodage des dialectes spécifiques (Responses API, CodeAssist RPC).
- Configuration des sockets TLS via `TlsImpersonator` et transmission de télémétrie via `ClearcutSimulator`.

### Ce qui est EXCLU de SS-13 :
- La décision d'activer ou non ces adaptateurs (déléguée à la configuration de Layer 1).
- Le bridage de quota global (géré en amont par `QuotaManager`).

## 6. Liens & Navigation

- **Référence Technique :** [`oauth-adapters-reference.md`](./oauth-adapters-reference.md)
- **Guide Pratique d'Intégration :** [`oauth-adapters-howto.md`](./oauth-adapters-howto.md)
- **Index du Domaine Fournisseurs :** [`index.md`](./index.md)
