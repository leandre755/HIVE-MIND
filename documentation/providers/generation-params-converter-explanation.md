# GenerationParams & MessageConverter — Architecture & Principes de Fonctionnement

Le sous-système **SS-11 (GenerationParams & MessageConverter)** assure la normalisation universelle des paramètres d'inférence et la conversion bidirectionnelle sans perte entre le format pivot de HIVE-MIND et les 4 grands dialectes filaires du marché (OpenAI, Anthropic, Gemini, Cohere).

## 1. Contexte & Problématique d'Ingénierie

Chaque fournisseur de modèles de fondation impose des conventions lexicales, des structures de données et des contraintes syntaxiques incompatibles :
- **Divergence des noms de paramètres** : Là où l'API OpenAI ChatCompletions attend `max_tokens`, les modèles de raisonnement récents (o1, o3-mini) exigent `max_completion_tokens`, l'API Anthropic attend `max_tokens` (obligatoire) avec un bloc `thinking: { type: 'enabled', budget_tokens }`, et l'API Gemini attend `maxOutputTokens` au sein d'un objet `generationConfig`.
- **Formats de messages et d'outils hétérogènes** : OpenAI transporte les appels d'outils via `choices[].message.tool_calls`, Anthropic via des blocs de contenu polymorphes `{ type: 'tool_use', id, name, input }` dans le corps du message assistant, et Gemini via `{ functionCall: { name, args } }`.
- **Contraintes strictes sur les identifiants d'outils** : Certains endpoints (ex. Mistral AI et Codestral) rejettent violemment (HTTP 400) tout `tool_call_id` qui ne fait pas exactement 9 caractères alphanumériques (`^[a-zA-Z0-9]{9}$`), alors qu'OpenAI génère des identifiants longs préfixés (`call_xyz123...`).
- **Économie de jetons via le Prompt Caching** : Les fournisseurs modernes (notamment Anthropic) offrent des réductions tarifaires substantielles (jusqu'à 90%) pour les préfixes de contexte mis en cache, à condition d'injecter manuellement des blocs de contrôle `{ cache_control: { type: 'ephemeral' } }`.

SS-11 résout ces disparités par une couche de **transformation purement fonctionnelle ($I = 0.00$)** garantissant zéro mutation accidentelle et une projection fidèle et déterministe.

## 2. Modèle Mental & Architecture Conceptuelle

Le système repose sur un modèle en étoile centré autour d'un **Format Pivot Unique** :

```
                               ┌───────────────────────────┐
                               │       Format Pivot        │
                               │        HIVE-MIND          │
                               │  - ChatMessage[]          │
                               │  - ToolCall[] / Def[]     │
                               │  - GenerationParams       │
                               │  - ModelCapabilities      │
                               └─────────────┬─────────────┘
                                             │
                      ┌──────────────────────┼──────────────────────┐
                      │                      │                      │
                      ▼                      ▼                      ▼
           ┌──────────────────────┐┌──────────────────────┐┌──────────────────────┐
           │   Dialecte OpenAI    ││  Dialecte Anthropic  ││    Dialecte Gemini   │
           │ - max_completion_tok ││ - thinking.budget    ││ - maxOutputTokens    │
           │ - reasoning_effort   ││ - cache_control ephem││ - thinkingConfig     │
           │ - tool_calls standard││ - content[tool_use]  ││ - functionCall       │
           └──────────────────────┘└──────────────────────┘└──────────────────────┘
                      │                      │                      │
                      └──────────────────────┼──────────────────────┘
                                             │
                                             ▼
                               ┌───────────────────────────┐
                               │   Sanitiseur Tool IDs     │
                               │   generateSafeToolId()    │
                               │  (9 chars alphanum Mistral)
                               └───────────────────────────┘
```

### Mécanismes de Transformation

1. **Résolution Déclarative des Capacités (`resolveCapabilities`)** :
   Au démarrage, le module lit l'objet `capacites` de la configuration du modèle pour instancier un profil typé `ModelCapabilities` (`thinking`, `promptCaching`, `temperatureRange`, `maxTokensField`, `maxTokensRequired`).
2. **Normalisation des Paramètres (`toWireParams`)** :
   Transforme les paramètres abstraits en clés filaires brutes prêtes à être fusionnées dans le corps HTTP selon le dialecte cible.
3. **Injection Éphémère de Prompt Caching (`applyPromptCaching`)** :
   Si le modèle supporte le cache de contexte, la fonction applique un clone défensif (`structuredClone`) et injecte `{ cache_control: { type: 'ephemeral' } }` sur les messages système et les derniers messages utilisateur.
4. **Conversion des Messages (`messageConverter`)** :
   - `convertMessagesForOpenAI` : Maintient le format standard.
   - `convertMessagesForAnthropic` : Traduit les `ToolCall` en blocs `tool_use` (avec désérialisation JSON stricte du champ `input`), convertit les réponses d'outils en `tool_result`, et adapte les images base64 (`data:image/...`).
   - `convertMessagesForGemini` : Projette les messages en structure `contents[].parts[]` avec `functionCall` et `functionResponse`.
   - `convertMessagesForCohere` : Adapte les rôles en `USER`, `CHATBOT`, `SYSTEM` et `TOOL`.

## 3. Choix de Conception & Raisons d'Ingénierie

- **Pureté Fonctionnelle & Zéro Effet de Bord** : 100% des fonctions de SS-11 sont pures : elles ne lisent aucune variable globale mutable, n'effectuent aucun I/O disque ou réseau, et ne modifient jamais les tableaux ou objets passés en argument.
- **Principe d'Immutabilité Défensive** : L'injection de blocs de métadonnées (comme le prompt caching) utilise systématiquement des copies profondes pour éviter qu'une modification apportée pour un modèle Anthropic ne pollue l'historique partagé en mémoire en cas de basculement vers un modèle OpenAI.
- **Fast-Path $O(1)$** : Si les capacités du modèle indiquent `supportsPromptCaching === false`, `applyPromptCaching` retourne immédiatement la référence du tableau sans aucune allocation mémoire superflue.
- **Désérialisation Résiliente des Arguments d'Outils (`parseJsonArgs`)** : Lors de la conversion vers Anthropic ou Gemini, si les arguments JSON d'un appel d'outil sont malformés par le LLM, la fonction logge un avertissement et bascule vers un objet vide `{}` plutôt que de faire crasher le pipeline avec un `SyntaxError`.

## 4. Analyse Comparative & Alternatives Écartées

| Approche Alternative | Avantages Théoriques | Inconvénients / Raisons du Rejet par HIVE-MIND |
| :--- | :--- | :--- |
| **Adaptateurs Monolithiques Séparés** (un fichier complet par API) | Chaque adapter gère son propre code de bout en bout. | Duplication massive de la logique de conversion des messages, désynchronisation des corrections de bugs et divergence des types d'outils. |
| **Mutation In-Place des Objets Messages** | Évite les allocations de mémoire. | Dangereux dans une architecture de cascade : si le premier modèle échoue, le message muté est corrompu pour le modèle de repli suivant. |
| **Génération d'Identifiants avec `Math.random()`** | Plus rapide en CPU. | Risque de biais de modulo et de collisions statistiques sur des millions de requêtes. HIVE-MIND impose `crypto.randomInt()`. |
| **Typage Générique `any` pour les Charges Utiles** | Moins de contraintes à l'écriture du code. | Source majeure de régressions silencieuses à l'exécution dès qu'un champ filaire est renommé. |

## 5. Frontières Architecturales & Invariants

### Ce qui est DANS le périmètre de SS-11 :
- Définition et validation du modèle de données pivot (`GenerationParams`, `ChatMessage`, `ToolCall`).
- Normalisation et projection des paramètres vers les formats filaires (`toWireParams`).
- Injection automatique des balises de Prompt Caching.
- Conversion bidirectionnelle messages/réponses pour les 4 dialectes.
- Génération et validation d'identifiants d'outils conformes à la regex `^[a-zA-Z0-9]{9}$`.

### Ce qui est EXCLU de SS-11 (délégué aux couches adjacentes) :
- L'émission des requêtes HTTP et l'encodage réseau (délégués à Layer 0 — SS-10).
- Le bridage budgétaire global et le calcul de pénalité KKT (délégués à Layer 1 et Lagrange FinOps — SS-12 & SS-21).
- L'exécution effective des fonctions d'outils (déléguée au PluginLoader — SS-25).

## 6. Liens & Navigation

- **Référence Technique :** [`generation-params-converter-reference.md`](./generation-params-converter-reference.md)
- **Guide Pratique d'Intégration :** [`generation-params-converter-howto.md`](./generation-params-converter-howto.md)
- **Index du Domaine Fournisseurs :** [`index.md`](./index.md)
