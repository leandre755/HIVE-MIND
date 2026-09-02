# ServiceContainer — Architecture & Principes de Fonctionnement

Le sous-système **ServiceContainer** constitue l'épine dorsale d'inversion de contrôle (IoC) et d'injection de dépendances de HIVE-MIND, orchestrant le cycle de vie, l'instanciation différée et le découplage des 32 services modulaires du démon.

## 1. Contexte & Problématique d'Ingénierie

Dans une architecture d'agent autonome multi-canal intégrant de multiples sous-systèmes hétérogènes (passerelles de transport Baileys/Discord/Telegram, modèles LLM multi-fournisseurs, bases vectorielles pgvector, caches Redis L1 et moteurs audio), le couplage direct par instanciation statique (`new MyService()`) ou imports directs pose des verrous majeurs :
- **Consommation excessive de ressources à l'amorçage** : Charger immédiatement des pilotes lourds (Chromium pour le scraping, sessions audio WebSocket, connexions de bases de données distribuées) dégrade le temps de démarrage et sature la mémoire vive sur des machines hôtes contraintes (8 Go RAM, 2 cœurs CPU).
- **Dépendances cycliques complexes** : Des services tels que `ActionMemory`, `ConsciousnessService` et `SemanticMemory` nécessitent mutuellement des références croisées lors de leurs phases de traitement.
- **Difficulté d'isolation pour les tests** : L'impossibilité de substituer des composants d'infrastructure par des doublures de test (*mocks*) compromet la validation unitaire rapide et déterministe.

`ServiceContainer` résout ces problématiques via un registre centralisé associant chaque identifiant de service à une fabrique paresseuse (*lazy factory*), un mode singleton configurable et une résolution réflexive des dépendances circulaires.

## 2. Modèle Mental & Architecture Conceptuelle

Le conteneur repose sur une table associative associant chaque clé typée de `ServiceRegistry` à une entrée de service `ServiceEntry` :
- **Enregistrement de fabrique** : Une fonction d'instanciation est stockée sans être exécutée immédiatement.
- **Résolution à la demande (Lazy Loading)** : L'évaluation de la fabrique intervient uniquement lors du premier appel à `container.get(name)`.
- **Mise en cache Singleton** : Si le service est déclaré singleton, l'instance créée est conservée dans `ServiceEntry.instance` et retournée lors des accès ultérieurs.
- **Résolution de dépendance circulaire** : Si l'instance instanciée expose une méthode `setContainer(container)`, le conteneur s'injecte lui-même réflexivement dans l'objet.

```
                  +──────────────────────────────────────+
                  |           ServiceContainer           |
                  +──────────────────┬───────────────────+
                                     |
               ┌─────────────────────┼─────────────────────┐
               │                     │                     │
               ▼                     ▼                     ▼
     +──────────────────+  +──────────────────+  +──────────────────+
     |   Base Services  |  | Memory & AI Core |  |  Voice & Stream  |
     | - logger         |  | - embeddings     |  | - voiceProvider  |
     | - supabase (db)  |  | - memory (pgvec) |  | - minimaxVoice   |
     | - redis          |  | - graphMemory    |  | - groqSTT        |
     | - adminService   |  | - consciousness  |  | - geminiLive     |
     +──────────────────+  +──────────────────+  +──────────────────+
               │                     │                     │
               └─────────────────────┼─────────────────────┘
                                     │
                                     ▼
                      +──────────────────────────────+
                      |       ServiceRegistry        |
                      |  (32 services typés stricts) |
                      +──────────────────────────────+
                                     │
                                     ▼
                get('name') ──► [Lazy Factory / Cache]
```

## 3. Choix de Conception & Raisons d'Ingénierie

1. **Absence de framework IoC tiers lourd (Zero-Dependency IoC)** :
   - *Raison* : L'évitement de frameworks tels que NestJS ou InversifyJS élimine la surcharge de réflectance expérimentale (`reflect-metadata`), préserve la compatibilité ESM native pure de Node.js 22+ et garantit une empreinte mémoire minimale.
2. **Initialisation Stratifiée (`full` vs `minimal`)** :
   - *Raison* : Le mode `full` amorce la totalité des services pour le démon opérationnel. Le mode `minimal` permet aux outils CLI d'administration et aux suites de tests unitaires d'instancier uniquement le sous-ensemble requis sans déclencher de connexions réseau inutiles.
3. **Injection Réflexive du Conteneur (`setContainer`)** :
   - *Raison* : Permet de briser les dépendances circulaires sans nécessiter de proxys d'indirection complexes ou de mutations manuelles post-instanciation.

## 4. Analyse Comparative & Alternatives Écartées

| Approche Alternative | Avantages Théoriques | Inconvénients / Raisons du Rejet par HIVE-MIND |
| :--- | :--- | :--- |
| **Monolithe d'Imports Statiques** (`import { service } from ...`) | Simplicité immédiate, autocomplétion IDE native. | Instanciation prématurée de tous les modules, impossibilité de mocker les dépendances en test, verrous sur dépendances circulaires. |
| **InversifyJS / TypeDI** | Décorateurs `@injectable()`, résolution automatique de graphe de constructeurs. | Dépendance lourde sur `reflect-metadata`, compilation TypeScript ralentie, surcoût CPU/RAM incompatible avec l'hôte 2 cœurs. |
| **Service Locator sans typage** | Implémentation minimale en 20 lignes de code. | Absence de sûreté de typage au moment de la compilation, propagation d'erreurs d'exécution silencieuses. |

## 5. Frontières Architecturales & Invariants

- **Dans le périmètre de `ServiceContainer`** :
  - Stockage des fabriques et instances de services.
  - Résolution de types via l'interface générique `ServiceRegistry`.
  - Contrôle des modes d'amorçage (`full` vs `minimal`).
  - Collecte de métriques d'instanciation (`getStats()`).
- **Exclu du périmètre** :
  - Logique métier interne des services instanciés.
  - Gestion des erreurs réseau ou reconnexions propres à chaque service (déléguée aux services respectifs).
  - Contrôle d'accès et autorisation d'appel des méthodes de service.

## 6. Liens & Navigation

- **Référence Technique :** [`service-container-reference.md`](./service-container-reference.md)
- **Guide Pratique d'Intégration :** [`service-container-howto.md`](./service-container-howto.md)
- **Index du Domaine Core :** [`index.md`](./index.md)
