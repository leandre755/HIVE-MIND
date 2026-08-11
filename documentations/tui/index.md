# Interface TUI HIVE-MIND — Documentation

Bienvenue dans la documentation de l'interface utilisateur textuelle (TUI) de HIVE-MIND. Ce système fournit un terminal graphique complet en mode texte, écrit en React et Ink, facilitant l'interaction et la supervision en direct de l'agent.

Cette documentation est structurée selon la méthodologie **Diátaxis** pour répondre précisément à chaque intention de lecture.

---

## 🧭 Plan de la Documentation

```
                        DÉMARRER
                           │
             ┌─────────────┴─────────────┐
             ▼                           ▼
       [ Tutoriels ]               [ Explications ]
     Prise en main pas-à-pas      Comprendre l'architecture
     (Apprentissage pratique)     (Compréhension théorique)
             │                           │
             ├───────────────────────────┤
             ▼                           ▼
     [ Guides Pratiques ]          [ Références ]
     Résoudre des problèmes       Manuel technique détaillé
     (Résolution pratique)        (Consulter l'API et le code)
```

### 1. 🚀 [Tutoriels](file:///home/omni/Code/HIVE-MIND-RAILWAY/documentations/tui/tutorials/get-started.md)

_Pour apprendre à utiliser le système pas-à-pas lors d'une première prise en main._

- **[Premier Lancement de la TUI](file:///home/omni/Code/HIVE-MIND-RAILWAY/documentations/tui/tutorials/get-started.md)** : Configurez l'environnement, démarrez le serveur WebSocket du Core HIVE-MIND et lancez le client TUI.

### 2. 💡 [Guides Pratiques (How-To)](file:///home/omni/Code/HIVE-MIND-RAILWAY/documentations/tui/howto/index.md)

_Pour accomplir une tâche spécifique ou résoudre un problème concret étape par étape._

- **[Ajouter une Commande Slash](file:///home/omni/Code/HIVE-MIND-RAILWAY/documentations/tui/howto/add-slash-command.md)** : Étendre la console en ajoutant une nouvelle commande personnalisée.
- **[Personnaliser les Thèmes](file:///home/omni/Code/HIVE-MIND-RAILWAY/documentations/tui/howto/customize-theme.md)** : Modifier la charte graphique néon et adapter la palette de couleurs.

### 3. 📚 [Manuels de Référence](file:///home/omni/Code/HIVE-MIND-RAILWAY/documentations/tui/reference/index.md)

_Informations techniques neutres et complètes à consulter en cas de besoin._

- **[Anatomie des Fichiers de la TUI](file:///home/omni/Code/HIVE-MIND-RAILWAY/documentations/tui/reference/directory-structure.md)** : Cartographie exhaustive de tous les fichiers du module `src/tui/`.
- **[Architecture WebSocket Client-Serveur](file:///home/omni/Code/HIVE-MIND-RAILWAY/documentations/tui/reference/core-connection.md)** : Spécifications de la communication réseau bidirectionnelle.
- **[Contextes React et Hooks](file:///home/omni/Code/HIVE-MIND-RAILWAY/documentations/tui/reference/contexts-hooks.md)** : Cycle de vie, routage clavier, gestion de l'état global et hooks associés.
- **[Spécifications des Composants Graphiques](file:///home/omni/Code/HIVE-MIND-RAILWAY/documentations/tui/reference/main-components.md)** : Rôle et fonctionnement de `AppContainer`, `InputPrompt` et autres briques visuelles.

### 4. 🧠 [Explications Conceptuelles](file:///home/omni/Code/HIVE-MIND-RAILWAY/documentations/tui/explanation/index.md)

_Explications de fond sur l'architecture, la philosophie et les choix de conception._

- **[Pourquoi une Architecture Découplée ?](file:///home/omni/Code/HIVE-MIND-RAILWAY/documentations/tui/explanation/websocket-architecture.md)** : Raisons d'être du protocole WebSocket local et bénéfices en matière de performance.
- **[Gestion du Rendu TTY et Capture Clavier](file:///home/omni/Code/HIVE-MIND-RAILWAY/documentations/tui/explanation/ink-rendering-tty.md)** : Comment React interagit avec les flux d'E/S du terminal.
- **[Design System d'AppContainer](file:///home/omni/Code/HIVE-MIND-RAILWAY/documentations/tui/explanation/app-container-design.md)** : Organisation du "God Component" de la TUI et gestion de l'état global de l'interface.
