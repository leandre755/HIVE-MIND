# Dynamic Plugin Pipeline & Strict Validation (SS-25) — Architecture & Principes de Fonctionnement

Le sous-système **Dynamic Plugin Pipeline & Strict Validation** orchestre le cycle de vie, la découverte dynamique, la sélection sémantique par RAG, la validation stricte des schémas et l'exécution sécurisée des outils locaux et distants (MCP) exposés à l'agent.

## 1. Contexte & Problématique d'Ingénierie

Dans les architectures d'agents à large spectre d'action, la prolifération des outils (_Tool Proliferation_) pose trois défis majeurs d'ingénierie :

1. **La saturation et dégradation de la fenêtre d'attention** : Injecter simultanément 50 à 100 définitions d'outils complètes (schémas JSON Schema volumineux) dans le prompt système dilue l'attention du modèle de langage, dégrade la précision du routage et consomme plusieurs milliers de jetons par tour de boucle.
2. **L'hallucination de paramètres non déclarés** : Les LLMs ont tendance à inventer des arguments inexistants (`extra: true`, `dry_run: false`) ou à omettre des champs obligatoires, provoquant des erreurs silencieuses ou des comportements imprévus au moment de l'exécution.
3. **L'intégration hétérogène des outils distants** : Faire interagir l'agent avec des serveurs d'outils externes standardisés (Model Context Protocol - MCP) sans modifier le cœur de l'orchestrateur nécessite une passerelle de traduction transparente.

HIVE-MIND résout ces problématiques grâce à un chargeur modulaire en briques (_Brick-Like_), un système de validation stricte Ajv générant des diagnostics auto-correcteurs pour le modèle (`<tool_use_error>`), une sélection d'outils vectorielle par RAG (`match_tools`) et un client MCP universel supportant les transports `stdio` et `sse`.

## 2. Modèle Mental & Architecture Conceptuelle

Le cycle de vie d'un outil s'articule autour d'un pipeline en cinq étapes : Découverte $\to$ Indexation/RAG $\to$ Validation Pré-Exécution $\to$ Exécution Protégée $\to$ Notification Réactive.

```
                      DEMARRAGE DU DAEMON
                                │
                                ▼
       [ PluginLoader.loadAll() - Découverte par Catégories ]
       (base/, web/, tools/, media/, whatsapp/, system/)
                                │
        ┌───────────────────────┴───────────────────────┐
        ▼                                               ▼
[ Outils Locaux Typescript ]                [ Client MCP (.mcprc) ]
(JSON Schema / Zod defineZodTool)           (Transports stdio & sse)
        │                                               │
        └───────────────────────┬───────────────────────┘
                                │
                                ▼
         [ Registre Global des Outils & TextMatchers ]
                                │
              REQUETE UTILISATEUR ENTRANTE
                                │
                                ▼
           [ Tool RAG : supabase.rpc('match_tools') ]
          Sélection des k outils + Outils Fondamentaux
                                │
                                ▼
                     INFERENCE MODELE DE LANGAGE
                                │
                 APPEL D'OUTIL (tool_call)
                                │
                                ▼
          [ Validation Stricte Ajv (toolValidator.ts) ]
    Rejet strict des hallucinations (additionalProperties: false)
                                │
        ┌───────────────────────┴───────────────────────┐
   (Invalide)                                       (Valide)
        ▼                                               ▼
[ Formatage Diagnostic ]                     [ Exécution Protégée ]
<tool_use_error>                             (plugin.execute / mcpClient)
(Auto-correction immédiate)                             │
                                                        ▼
                                             [ Dégradation Gracieuse ]
                                             (gracefulDegradation: true)
                                                        │
                                                        ▼
                                             [ Événements BotEvents ]
                                             (PLUGIN_EXECUTED / ERROR)
```

### Décomposition des Flux

1. **Découverte Modulaire au Démarrage** : `PluginLoader` explore récursivement le répertoire `src/plugins/`, valide les métadonnées de chaque module (`name`, `description`, `version`, méthode `execute`), compile les correspondances textuelles (`textMatchers`) et enregistre les schémas dans la table `toolToPlugin`.
2. **Filtrage Sémantique RAG (`getRelevantTools`)** : Lors d'un tour de dialogue, le message de l'utilisateur est vectorisé (`embeddings.embed`). La fonction RPC Supabase `match_tools` sélectionne les $k$ outils les plus pertinents (défaut $k=5$), auxquels s'agrège la liste incompressible des outils fondamentaux (`SAFE_FALLBACK_TOOLS`), garantissant un prompt compact et pertinent.
3. **Validation Pré-Exécution Ajv (`validateToolArgs`)** : Les arguments JSON bruts générés par le LLM sont validés contre le schéma JSON Schema du paramètre. L'option `additionalProperties: false` bloque les propriétés inventées, et les erreurs sont formatées en balises XML explicites pour forcer une régénération conforme au tour suivant.
4. **Passerelle MCP Universelle (`McpClientService`)** : Lit la configuration locale `.mcprc`, établit les connexions aux serveurs MCP via `StdioClientTransport` ou `SSEClientTransport`, et expose les outils distants avec le préfixe normalisé `mcp__<server>__<tool>`.
5. **Isolation et Dégradation Gracieuse** : Chaque exécution est encapsulée dans un bloc `try/catch`. En cas d'erreur de runtime, le système renvoie un objet `PluginResult` avec le drapeau `gracefulDegradation: true` et émet `BotEvents.PLUGIN_ERROR`, prévenant tout arrêt inopiné du démon.

## 3. Choix de Conception & Raisons d'Ingénierie

- **Rejet Systématique des Propriétés Hallucinées (`additionalProperties: false`)** : Forcer la clôture stricte des schémas JSON Schema empêche les modèles d'injecter des flags arbitraires et garantit que chaque argument transmis au handler a été explicitement conçu et typé.
- **Diagnostics en Balises XML Canoniques (`<tool_use_error>`)** : Plutôt que de lever une exception système bloquante, les erreurs de validation sont renvoyées dans le fil de discussion sous forme de diagnostic sémantique clair (`InputValidationError`), permettant au LLM de corriger ses arguments en boucle fermée sans intervention humaine.
- **Double Approche RAG + Outils Cœur Imcompressibles** : La fusion entre les résultats du RAG vectoriel et la liste des outils de base (`SAFE_FALLBACK_TOOLS` incluant `read_file`, `edit_file`, `execute_bash_command`) assure que l'agent conserve toujours ses capacités motrices élémentaires même si la similarité cosinus ne les sélectionne pas.
- **Support Dual JSON Schema / Zod (`defineZodTool`)** : Permet aux développeurs d'écrire des outils avec la fluidité et le typage strict de Zod tout en exportant automatiquement la spécification JSON Schema compatible OpenAI Function Calling.

## 4. Analyse Comparative & Alternatives Écartées

| Approche Alternative                                       | Avantages Théoriques                              | Inconvénients / Raisons du Rejet par HIVE-MIND                                                                                                      |
| :--------------------------------------------------------- | :------------------------------------------------ | :-------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Injection exhaustive de tous les outils dans le prompt** | Zéro besoin d'infrastructure RAG ou de Supabase.  | Explosion de la taille du prompt (15 000+ jetons rien qu'en définitions), baisse drastique de la précision des appels, coût d'inférence prohibitif. |
| **Validation manuelle impérative dans chaque plugin**      | Flexibilité totale par outil.                     | Redondance de code, risque d'oubli, messages d'erreur hétérogènes empêchant l'auto-correction standardisée du LLM.                                  |
| **Chargement monolithique statique (import fixe)**         | Typage direct à la compilation, démarrage rapide. | Impossibilité de recharger des outils à chaud (`reload`), rigidité face aux extensions tierces ou aux serveurs MCP dynamiques.                      |

## 5. Frontières Architecturales & Invariants

### Périmètre Strict (Dans le Sous-Système)

- Découverte dynamique, validation structurelle des plugins et enregistrement des handlers textuels.
- Validation Ajv et Zod des arguments JSON des appels d'outils.
- Orchestration de la sélection sémantique par RAG vectoriel (`match_tools`).
- Gestionnaire de clients MCP (`McpClientService`) et pont de transport (`stdio`/`sse`).
- Encapsulation des erreurs d'exécution et émission des événements de cycle de vie sur `EventBus`.

### Hors Périmètre (Délégué aux Couches Adjacentes)

- **Autorisation de sécurité HITL** : Déléguée à `PermissionManager` (SS-09).
- **Surveillance pré-action et conformité blueprint** : Déléguée à `RuntimeSentinel` (SS-21).
- **Calcul des embeddings pour le RAG** : Délégué à `EmbeddingsService` (SS-20).

### Invariants Opérationnels

1. **Invariant de Continuité (_Fail-Safe_)** : Une exception levée par la méthode `execute` d'un plugin ne provoque jamais l'interruption du processus hôte ; elle est convertie en `PluginResult` avec `gracefulDegradation: true`.
2. **Invariant de Clôture de Schéma** : Tout schéma d'outil de type `object` sans spécification explicite de `additionalProperties` se voit automatiquement assigner `additionalProperties: false`.

## 6. Liens & Navigation

- **Référence Technique :** [`plugin-pipeline-reference.md`](./plugin-pipeline-reference.md)
- **Guide Pratique d'Intégration :** [`plugin-pipeline-howto.md`](./plugin-pipeline-howto.md)
- **Index du Domaine Plugins :** [`index.md`](./index.md)
- **Index Général :** [`../00_index.md`](../00_index.md)
