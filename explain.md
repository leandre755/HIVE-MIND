# Architecture Détaillée et Fonctionnement de la TUI HIVE-MIND

Ce document fournit une explication complète, technique et exhaustive de l'architecture de l'interface utilisateur pour terminal (TUI) de HIVE-MIND, de son fonctionnement actuel, et du module de connexion à l'IDE.

---

## 🧭 1. Métaphore Globale : Le Moteur HIVE-MIND vs Le Tableau de Bord TUI

Pour bien comprendre l'intégration, il faut distinguer deux entités :

1. **Le Core HIVE-MIND (Le Moteur)** : C'est l'agent d'IA autonome niveau 5. Il gère l'orchestration ReAct, la mémoire (L0, L1 Redis, L2 pgvector, L3 PostgreSQL), la sécurité (Sentinel, SafeScriptValidator, PermissionManager) et l'accès aux API des grands modèles (Smart Router V2). Il est totalement agnostique de l'interface d'affichage.
2. **La TUI (Le Tableau de Bord)** : C'est une application React Ink qui tourne localement dans le terminal de l'utilisateur. Elle ne prend aucune décision d'IA et ne contient aucun modèle de langage. Son rôle est de capturer la saisie clavier de l'utilisateur, de l'envoyer au Core, d'écouter les événements asynchrones renvoyés par celui-ci (pensée interne, appels d'outils, réponses textuelles) et de les afficher de manière ergonomique et esthétique dans la console.

La TUI se comporte exactement comme les autres canaux (WhatsApp, Discord). Elle n'a aucun privilège particulier à part celui d'être exécutée dans le même processus système en mode TTY local.

---

## 📂 2. Analyse Modulaire de `src/tui/` : Rôle des Répertoires et Fichiers

La TUI est structurée en plusieurs sous-modules sous `src/tui/` :

```
src/tui/
├── core/            ← Connexion bas niveau, interception et redirection des flux standards
├── transport/       ← Implémentation du pont de communication (TransportInterface)
├── commands/        ← Utilitaires d'enregistrement de commandes locales
├── services/        ← Résolution et routage des commandes slash
├── config/          ← Schémas de configuration et validation des options de la TUI
├── utils/           ← Gestionnaires de sessions, journaux d'activité et helpers système
└── ui/              ← Composants d'interface utilisateur Ink (React dans le terminal)
```

### ⚙️ A. Le module d'initialisation et de redirection (`src/tui/core/`)

- **`connection.ts` (HiveCoreConnection)** : C'est le chef d'orchestre de la liaison. Il accomplit deux tâches critiques :
  1. **Interception des flux standards (`stdout/stderr`)** : Au boot, il redirige les écritures bas niveau de la console vers un _ring buffer_ en mémoire (200 lignes max) et, si configuré, dans un fichier journal (`HIVE_TUI_LOG_FILE`). Cela évite que les logs de démarrage du core, de débogage ou d'exécution d'outils n'écrasent et ne corrompent l'interface graphique Ink.
  2. **Cycle de vie de la réponse (Fin Native)** : Plutôt que de reposer sur un minuteur de silence artificiel (_debounce_) de 1,5 seconde (qui ralentit l'interface) ou sur un garde-fou de 60 secondes (qui risquerait d'avorter une requête légitime en cas de rotation de clés ou de latence provider), la TUI s'appuiera sur les **signaux de présence natifs** émis directement par le Core HIVE-MIND :
     - `composing` : Émis par le Core au début de la boucle ReAct (déclenche `agent_start` dans l'UI).
     - `paused` : Émis par le Core à la toute fin du traitement (déclenche `agent_end` dans l'UI).
       Cela élimine l'attente artificielle et fiabilise la gestion d'état de l'agent.
- **`theme.ts` & `initializer.ts`** : Initialisent la palette graphique et les paramètres par défaut au lancement.

### 🔌 B. La couche d'échange (`src/tui/transport/`)

- **`HiveTransport.ts`** : Classe implémentant l'interface officielle `TransportInterface` de HIVE-MIND. Elle enregistre la TUI auprès du `TransportManager` du Core sous le nom `ink-cli`. Elle reçoit les messages de l'utilisateur et les soumet à la file d'attente d'exécution du Core, et distribue les réponses en émettant des événements `message` que l'UI capture.
- **`HiveFileService.ts`** : Gère l'accès et le transfert des fichiers locaux/médias demandés par le Core dans le cadre des interactions (comme la lecture de fichiers dans la sandbox).

### 🛠️ C. Le service de commandes slash (`src/tui/services/` & `src/tui/commands/`)

- **`SlashCommandResolver.ts` & `CommandService.ts`** : Résolvent et routent les commandes commençant par `/` tapées par l'utilisateur. Elles complètent les commandes CLI de HIVE-MIND (ex: `hive-mind tool:index`) par des commandes terminal interactives équivalentes :
  - `/index tools` : Reconstruit et affiche l'index des outils.
  - `/redis stats` : Affiche l'utilisation mémoire et les métriques de L1 Redis.
  - `/quota` : Affiche les limites et clés actives dans le Smart Router V2.

### 🎛️ D. Les composants graphiques et l'état (`src/tui/ui/`)

- **`AppContainer.tsx`** : Le composant React Ink racine qui gère l'affichage général, le mode Vim, l'historique et le themer.
- **`InputPrompt.tsx` & `useMessageQueue.ts`** : Assurent une zone de saisie non-bloquante. Conformément à l'expérience WhatsApp, l'utilisateur peut continuer à saisir et envoyer des messages pendant que l'agent réfléchit. Ces messages ne sont pas ignorés : ils sont automatiquement empilés dans une file d'attente (`messageQueue`) et transmis de manière ordonnée au Core dès qu'il repasse à l'état inactif.
- **`HistoryItemDisplay.tsx`** : Affiche les tours de conversation dans la console. Il doit être modifié pour utiliser la structure de données `HistoryTurn` de HIVE-MIND (avec extraction propre des blocs de pensée `<thought>`).
- **`contexts/`** : Un ensemble de Contextes React gérant l'état applicatif. `UIStateContext.tsx` contient la logique centrale de l'état (messages en cours, confirmation de l'exécution des outils par l'utilisateur (HITL), et stubs d'intégration).

---

## 🔌 3. Le Module d'Intégration IDE : Fonctionnement et Raccordement

Le superviseur a explicitement demandé de conserver le module de connexion à l'IDE pour permettre à HIVE-MIND d'écrire directement du code dans l'éditeur (VS Code, etc.).

### 🔍 A. Fonctionnement hérité (Gemini CLI)

Dans le système d'origine, l'interaction repose sur un modèle **Client-Serveur Local** :

1. **Initialisation (Extension VS Code / Host)** :
   - L'utilisateur ouvre un projet dans son IDE équipé de l'extension compagne.
   - L'extension démarre un serveur TCP/WebSocket local en arrière-plan.
   - Elle injecte automatiquement deux variables d'environnement dans le terminal intégré de l'IDE :
     - `GEMINI_CLI_IDE_SERVER_PORT` : Le port de communication local.
     - `GEMINI_CLI_IDE_WORKSPACE_PATH` : Le répertoire racine ouvert dans l'éditeur.
2. **Détection par la TUI** :
   - Au boot, la TUI vérifie la présence de ces variables d'environnement.
   - Si elles existent, elle instancie la classe `IdeClient` pour établir une connexion réseau locale.
3. **Protocole de messages JSON** :
   - La TUI envoie des requêtes et reçoit des réponses structurées :
     - **`getEditorContext()`** : Demande à l'IDE le nom du fichier actif, son contenu intégral, la position du curseur, et le texte actuellement sélectionné par l'utilisateur. Cela donne un contexte de travail hyper-précis à l'IA.
     - **`resolveDiffFromCli()`** : Lorsque l'IA propose une modification de code, la TUI transmet les changements à appliquer sous forme de diff à l'IDE. L'extension applique le diff directement dans l'éditeur sous les yeux de l'utilisateur.
     - **`useIdeTrustListener`** : Permet de synchroniser et de valider le niveau de confiance accordé par l'utilisateur pour les accès en lecture/écriture.

### 🚧 B. État actuel (Mock / Stub)

Dans la phase de nettoyage précédente, les dépendances vers les paquets Google d'origine ont été coupées. En conséquence :

- La classe `IdeClient` dans `src/tui/ui/contexts/UIStateContext.tsx` a été transformée en **Mock** statique. Ses méthodes comme `getCurrentIde()`, `isDiffingEnabled()` et `resolveDiffFromCli()` renvoient des valeurs par défaut (`null`, `false`, résolutions immédiates sans opération).
- Le composant d'invitation visuelle `IdeIntegrationNudge.tsx` affiche simplement un texte statique indiquant que l'intégration n'est pas disponible.

### 🎯 C. Raccordement cible pour HIVE-MIND

Pour réactiver et adapter cette fonctionnalité à HIVE-MIND sans dépendance externe :

1. **Spécification des variables d'environnement** :
   - Le système écoutera les variables `HIVE_MIND_IDE_SERVER_PORT` (ou par rétrocompatibilité `GEMINI_CLI_IDE_SERVER_PORT`) et `HIVE_MIND_IDE_WORKSPACE_PATH` (ou `GEMINI_CLI_IDE_WORKSPACE_PATH`).
2. **Protocole WebSocket Léger** :
   - Nous allons réimplémenter la logique interne d'`IdeClient` pour initier une connexion WebSocket (`ws://localhost:${port}`) vers le serveur démarré par l'extension IDE.
   - Les requêtes de lecture de contexte de l'éditeur et d'application de diffs utiliseront un schéma JSON simple et standardisé :
     ```json
     // Requête de contexte de l'IDE
     { "action": "get_context" }

     // Réponse de l'IDE
     {
       "action": "context_response",
       "data": {
         "filePath": "/chemin/absolu/fichier.ts",
         "content": "const code = ...",
         "selection": "code",
         "cursor": { "line": 10, "character": 5 }
       }
     }

     // Envoi de modifications (Diff) vers l'IDE
     {
       "action": "apply_diff",
       "data": {
         "filePath": "/chemin/absolu/fichier.ts",
         "diff": "@@ -10,5 +10,5 @@\n-const code = ...\n+const newCode = ..."
       }
     }
     ```
3. **Intégration au Core via les Outils** :
   - Les informations de contexte extraites par `IdeClient` seront injectées dans le contexte système envoyé à l'IA (`getHiveMdContext` dans `HiveTransport`).
   - L'IA pourra utiliser un outil dédié ou la TUI interceptera les modifications de fichiers validées par l'utilisateur pour appeler `ideClient.resolveDiffFromCli()` au lieu d'écrire directement sur le disque si le mode IDE est actif.
