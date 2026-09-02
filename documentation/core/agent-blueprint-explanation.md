# AgentBlueprint — Architecture & Principes de Fonctionnement

Le sous-système **AgentBlueprint** régit la formalisation déclarative, la validation structurelle et la gestion du cycle de vie des topologies et profils d'agents au sein de HIVE-MIND.

## 1. Contexte & Problématique d'Ingénierie

Dans une architecture multi-agents ou en essaim (*Swarm*), l'absence de contrat formel encadrant les capacités d'un agent engendre des risques majeurs :
- **Dérives d'exécution et élévation de privilèges** : Un agent ou sous-agent créé dynamiquement pourrait accéder à des outils destructeurs (écriture de fichiers, exécution de commandes shell) s'il ne dispose pas d'une liste blanche stricte (*Action Space Whitelist*).
- **Explosion des coûts d'API LLM** : L'absence de plafonds budgétaires et d'itérations maximales sur les agents secondaires expose le système à des boucles de raisonnement infinies et coûteuses.
- **Pollution de la mémoire persistante** : La multiplication d'agents éphémères spécialisés génère des fuites de mémoire si leurs profils ne sont pas purgés de manière déterministe en fin de mission.

`AgentBlueprint` résout ces risques en imposant une validation de schéma stricte via Zod et une gestion de registre hybride (Disque pour les profils stables, RAM pour les agents éphémères).

## 2. Modèle Mental & Architecture Conceptuelle

Le système repose sur deux structures fondamentales :
1. **Le Schéma Zod Standard `AgenticFormatSchema`** : Valide exhaustivement les 4 sections obligatoires de tout profil d'agent :
   - `metadata` : Identifiant unique, nom lisible, version sémantique.
   - `mindos` : Motivations intrinsèques de l'agent (*drives*).
   - `action_space` : Liste blanche exhaustive des noms d'outils autorisés (`allowed_tools`).
   - `constraints` : Garde-fous d'exécution (`read_only_fs`, `max_budget_usd`, `max_iterations`).
2. **Le Registre Hybride `BlueprintManager`** :
   - *Recherche Prioritaire en RAM* (`ephemeralRegistry`) : Vérifie si le profil a été instancié dynamiquement par un sous-agent.
   - *Repli Sécurisé sur Disque* (`src/config/blueprints/*.json`) : Si absent de la RAM, charge le fichier JSON correspondant en appliquant une résolution confinée anti-traversée de répertoires (`resolveWithinRoot`).

```
 [loadBlueprint(id)]
          │
          ▼
   Présent en RAM ? ─────── OUI ──────► [Retourne Blueprint Éphémère]
          │ (NON)
          ▼
   Recherche sur Disque
   src/config/blueprints/{id}.json
          │
          ▼
   Validation Zod (AgenticFormatSchema)
          │
          ├─► Valide ────► [Retourne Blueprint Statique]
          └─► Invalide ──► [Lance Exception ZodError]
```

## 3. Choix de Conception & Raisons d'Ingénierie

1. **Validation Stricte par Schéma Zod** :
   - *Raison* : Garantit l'immuabilité et la conformité des types à l'exécution, interdisant toute injection de paramètres inattendus ou de types corrompus.
2. **Confinement Strict du Système de Fichiers (`safeFs`)** :
   - *Raison* : L'utilisation systématique de `resolveWithinRoot` neutralise les attaques par traversée de répertoires (*Path Traversal* / Symlinks) lors du chargement des fichiers de configuration.
3. **Cycle de Vie Déterministe des Agents Éphémères** :
   - *Raison* : Les méthodes `registerEphemeral` et `cleanupEphemeral` permettent d'instancier des sous-agents en RAM en microsecondes sans écriture disque, et de libérer la mémoire dès l'achèvement de leur tâche.

## 4. Analyse Comparative & Alternatives Écartées

| Approche Alternative | Avantages Théoriques | Inconvénients / Raisons du Rejet par HIVE-MIND |
| :--- | :--- | :--- |
| **Profils purs en System Prompt (Texte brut)** | Flexibilité totale, aucune contrainte de code. | Absence totale de garde-fous programmatiques ; le LLM peut tenter d'appeler des outils interdits. |
| **Base de Données SQL / Redis pour les Blueprints** | Persistance distribuée multi-instances. | Complexité superflue pour des fichiers de configuration système versionnés par Git. |
| **Validation manuelle sans schéma (`typeof`)** | Zéro dépendance sur Zod. | Code verbeux, fragile, sujet aux omissions sur les valeurs par défaut et les structures imbriquées. |

## 5. Frontières Architecturales & Invariants

- **Dans le périmètre de `AgentBlueprint`** :
  - Définition et validation du schéma standard des profils.
  - Chargement sécurisé depuis le disque et stockage éphémère en RAM.
  - Garbage collection des profils volatils.
- **Exclu du périmètre** :
  - Exécution des boucles ReAct (déléguée à `BotCore` ou `SubAgentEngine`).
  - Filtrage effectif des appels d'outils au moment de l'exécution (délégué à `toolValidator` et `RuntimeSentinel`).

## 6. Liens & Navigation

- **Référence Technique :** [`agent-blueprint-reference.md`](./agent-blueprint-reference.md)
- **Guide Pratique d'Intégration :** [`agent-blueprint-howto.md`](./agent-blueprint-howto.md)
- **Index du Domaine Core :** [`index.md`](./index.md)
