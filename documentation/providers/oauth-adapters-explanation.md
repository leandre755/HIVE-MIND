# Advanced OAuth Adapters (Codex & Antigravity) — Architecture & Principes de Fonctionnement

Le sous-système **SS-13 (Advanced OAuth Adapters)** fournit un pont d'accès transparent, hautement résilient et sécurisé aux modèles de pointe (_State-of-the-Art_) en exploitant les abonnements professionnels et flux OAuth développeurs (OpenAI ChatGPT Plus/Pro via l'API Codex Responses, et Google Cloud Code Assist via le protocole Antigravity).

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
│               (Appelle chat() sur un ProviderAdapter)               │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Cycle de Vie & Résolution OAuth (SS-13)                  │
│                                                                             │
│  1. Chargement Tokens (process.env, repli ~/.codex/auth.json pour Codex)    │
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
   La fonction décode la charge utile base64 du token d'accès sans jamais lever d'exception (_Never-Throw Invariant_). Toute chaîne corrompue retourne `null`, ce qui déclenche un rafraîchissement sans faire crasher le processus.
2. **Rafraîchissement Proactif à Marge de Sécurité ($T - 300\text{ s}$)** :
   Le renouvellement du jeton s'active dès que le temps restant avant expiration passe sous la barre des 5 minutes, éliminant les échecs 401 en cours de longue génération.
3. **Impersonation TLS (`TlsImpersonator`)** :
   Configure les suites cryptographiques (Ciphers, Curves, ALPN) au niveau du socket Node.js TLS pour correspondre exactement à l'empreinte JA3 attendue par les passerelles cloud.
4. **Simulation de Télémétrie (`ClearcutSimulator`)** :
   Transmet en arrière-plan les pings de session périodiques exigés par l'infrastructure Google Cloud pour maintenir la validité du contexte de session.

## 3. Choix de Conception & Raisons d'Ingénierie

- **Polymorphisme Strict `ProviderAdapter`** :
  Tant l'adaptateur Codex que l'adaptateur Antigravity implémentent le contrat standard `chat(messages, options)` et renvoient un résultat final. Aucun des deux n'implémente `chatStream` : Codex consomme un flux SSE distant avant de consolider la réponse, tandis qu'Antigravity effectue une requête `generateContent` non streamée et lit une réponse JSON.
- **Sources d'Authentification Distinctes selon l'Adaptateur** :
  - **Codex** : Lit en priorité `CODEX_ACCESS_TOKEN` / `CODEX_REFRESH_TOKEN` dans l'environnement, avec repli transitoire sur le fichier local `~/.codex/auth.json` issu de la CLI officielle en développement.
  - **Antigravity (Google Cloud Code Assist)** : S'appuie **exclusivement** sur les variables d'environnement (`ANTIGRAVITY_ACCESS_TOKEN`, `ANTIGRAVITY_REFRESH_TOKEN`, `ANTIGRAVITY_PROJECT_ID`, etc.) et ne lit aucun fichier sur l'hôte (ni fichier Codex, ni configuration gcloud sur disque).
- **Réécriture Atomique et Préservation des Clés Étrangères (Codex)** :
  Lors de la mise à jour d'`auth.json`, le module fusionne les nouveaux jetons dans la structure existante pour ne pas écraser les champs additionnels créés par les outils externes.
- **Trajectoire Cible : Scripts de Connexion Dédiés et Suppression des Fichiers Hôte** :
  > [!IMPORTANT]
  > Dans les futures versions de HIVE-MIND orientées distribution installable (#96), **la dépendance à la lecture de fichiers d'authentification par défaut sur le système hôte (comme `~/.codex/auth.json`) sera totalement abandonnée**.
  > HIVE-MIND intégrera des **scripts de connexion dédiés** (ex. commandes CLI interactives `hive-mind login-provider <provider>`) simulant les véritables protocoles d'authentification OAuth (flux PKCE, Device Authorization Grant, ou capture locale de redirection). Les jetons acquis seront stockés directement dans le périmètre applicatif sécurisé de HIVE-MIND (`~/.hivemind/config/` ou trousseau de clés chiffré), garantissant une totale autonomie vis-à-vis des CLI et répertoires tiers de l'OS hôte.

## 4. Analyse Comparative & Alternatives Écartées

| Approche Alternative                                                          | Avantages Théoriques                            | Inconvénients / Raisons du Rejet par HIVE-MIND                                                                                                               |
| :---------------------------------------------------------------------------- | :---------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Lecture de fichiers tiers sur l'hôte (`~/.codex/auth.json`) (Transitoire)** | Pratique en développement local immédiat.       | Non portable en environnement isolé, couplage fragile avec des outils tiers. Remplacé à terme par des scripts de connexion simulant le flux OAuth réel.      |
| **CLI Wrapper Spawning** (`exec('codex prompt ...')`)                         | Utilise le binaire officiel directement.        | Latence prohibitive due au démarrage d'un processus par message, consommation excessive de RAM et impossibilité de capturer les chunks de stream en mémoire. |
| **Tokens Statiques Longue Durée**                                             | Pas de logique de rafraîchissement à maintenir. | Les fournisseurs n'offrent plus de jetons statiques sans expiration pour leurs abonnements professionnels.                                                   |
| **Ignorer la Marge d'Expiration ($T - 0\text{ s}$)**                          | Moins de requêtes de rafraîchissement.          | Si une requête démarre 2 secondes avant l'expiration, la connexion est coupée au milieu du streaming par un HTTP 401.                                        |

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
