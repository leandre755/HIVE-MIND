# SubAgentEngine — Architecture & Principes de Fonctionnement

Le sous-système **SubAgentEngine** implémente le moteur de délégation en essaim (*Swarm Delegation*) et de forking contextuel de HIVE-MIND, permettant à l'agent principal d'instancier des agents spécialisés éphémères exécutant des sous-missions cloisonnées.

## 1. Contexte & Problématique d'Ingénierie

Lorsqu'un agent autonome accomplit une mission de longue haleine (ex: audit approfondi d'une base de code, recherche bibliographique sur 10 sources ou analyse financière multi-entreprises), l'exécution de l'intégralité des étapes dans le fil conversationnel unique principal pose des limites structurelles :
- **Pollution et saturation de la fenêtre de contexte** : Les dizaines d'appels d'outils intermédiaires (sorties brutes de scraping, codes sources volumineux) encombrent l'historique et dégradent la précision du modèle principal.
- **Risque d'altération de l'identité de base (*Persona Drift*)** : L'injection de consignes spécialisées temporaires dans le prompt principal perturbe les motivations fondamentales de l'agent.
- **Risques de sécurité par sur-privilèges** : Une sous-tâche de simple recherche web n'a pas besoin de droits d'écriture sur le disque ou d'accès aux commandes shell.

`SubAgentEngine` résout ces contraintes par l'instanciation de sous-agents isolés, dotés d'un espace d'outils restreint par liste blanche, de garde-fous stricts et d'une restitution synthétique sous forme de rapport Markdown consolidé.

## 2. Modèle Mental & Architecture Conceptuelle

Le cycle de vie d'un sous-agent s'exécute selon la séquence suivante :

1. **Invocation de Délégation (`spawn_sub_agent`)** : L'agent principal invoque l'outil système en définissant le nom du sous-agent, son rôle spécifique (*persona*), la liste blanche stricte de ses outils autorisés et sa mission.
2. **Enregistrement du Blueprint Éphémère en RAM** : `SubAgentEngine` génère un profil conforme à `AgenticFormatSchema` et l'enregistre en mémoire vive via `blueprintManager.registerEphemeral()`.
3. **Construction de l'Historique (Fork vs Fresh)** :
   - Mode *Fresh* : Historique vierge contenant uniquement le prompt système spécialisé et l'ordre de mission.
   - Mode *Fork* : Injection sélective de segments de l'historique parent pertinents.
4. **Boucle ReAct Isolée avec Garde-Fous** :
   - Filtrage strict des outils : seuls les outils présents dans `allowedTools` peuvent être résolus et exécutés.
   - Plafond d'itérations (10 itérations max) et timeout matériel (120 secondes).
   - Confinement de sécurité : transmission du drapeau `read_only_fs`.
5. **Nettoyage & Restitution Consolidée** :
   - Purgation des balises de réflexion interne (`<think>`, `<thought>`).
   - Nettoyage déterministe du blueprint en bloc `finally`.
   - Restitution d'un rapport structuré `SubAgentResult` au parent.

```
 [Agent Principal] ──► spawn_sub_agent(name, role, tools, mission)
                             │
                             ▼
                    SubAgentEngine.run()
                             │
       ┌─────────────────────┼─────────────────────┐
       ▼                     ▼                     ▼
 [Enregistrement RAM]   [Filtrage Outils]   [Isolation Contexte]
  Blueprint éphémère    Whitelist stricte    Historique forké
       │                     │                     │
       └─────────────────────┼─────────────────────┘
                             │
                             ▼
                  [Boucle ReAct Cloisonnée]
                  - Max 10 itérations
                  - Timeout 120s
                  - Héritage read_only_fs
                             │
                             ▼
                  [Nettoyage & Restitution]
                  - Strip des balises <think>
                  - cleanupEphemeral(blueprintId)
                  - Rapport Markdown synthétique
                             │
                             ▼
            [Retour au Contexte de l'Agent Principal]
```

## 3. Choix de Conception & Raisons d'Ingénierie

1. **Cloisonnement Strict de l'Espace d'Actions (*Tool Whitelisting*)** :
   - *Raison* : Interdire préventivement l'accès aux outils sensibles (exécution shell, écriture système) évite toute dérive d'un sous-agent lors de tâches de recherche ou de lecture.
2. **Double Disjoncteur Temporel & Itératif** :
   - *Raison* : Le délai de 120 secondes et la borne de 10 itérations garantissent qu'un sous-agent bloqué dans une boucle récursive ne monopolise pas indéfiniment les ressources hôtes.
3. **Élimination des Balises de Pensée (`<think>`)** :
   - *Raison* : Les modèles de raisonnement (DeepSeek R1, Gemini Thinking) génèrent de volumineux blocs de réflexion interne. Les supprimer avant transmission au parent économise jusqu'à 70% des jetons de transmission.

## 4. Analyse Comparative & Alternatives Écartées

| Approche Alternative | Avantages Théoriques | Inconvénients / Raisons du Rejet par HIVE-MIND |
| :--- | :--- | :--- |
| **Sous-agents par Processus Séparé (`child_process.fork`)** | Isolation mémoire totale au niveau OS. | Surcharge CPU/RAM disproportionnée, coût d'instanciation élevé (~500ms par agent). |
| **Boucle ReAct unique sans sous-agents** | Simplicité d'implémentation. | Explosion du contexte, perte de précision et confusion de l'agent sur les tâches longues. |
| **Frameworks Multi-Agents Externes (CrewAI / AutoGen)** | Écosystème riche de rôles. | Dépendances Python lourdes, non intégrable directement dans le runtime ESM natif Node.js. |

## 5. Frontières Architecturales & Invariants

- **Dans le périmètre de `SubAgentEngine`** :
  - Instanciation et exécution de la boucle ReAct isolée du sous-agent.
  - Application des listes blanches d'outils et des plafonds d'itérations.
  - Nettoyage des balises de réflexion et désallocation de la mémoire en fin de tâche.
- **Exclu du périmètre** :
  - Arbitrage des conflits entre plusieurs sous-agents concurrents (géré par `SwarmDispatcher`).
  - Définition globale des outils applicatifs (gérée par `pluginLoader`).

## 6. Liens & Navigation

- **Référence Technique :** [`sub-agent-engine-reference.md`](./sub-agent-engine-reference.md)
- **Guide Pratique d'Intégration :** [`sub-agent-engine-howto.md`](./sub-agent-engine-howto.md)
- **Index du Domaine Core :** [`index.md`](./index.md)
