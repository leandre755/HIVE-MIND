# Concepts et Architecture de la TUI (Explanation)

Cette section fournit des explications de fond, des choix architecturaux et des perspectives de conception pour comprendre le fonctionnement sous-jacent de la TUI HIVE-MIND.

---

## 🧭 Sommaire des Explications

### 1. 🌐 [Pourquoi une Architecture Client-Serveur Découplée ?](file:///home/omni/Code/HIVE-MIND-RAILWAY/documentations/tui/explanation/websocket-architecture.md)

Comprenez pourquoi la TUI a été découplée du Core via un pont WebSocket local sécurisé et les alternatives envisagées.

### 2. 🖨️ [Comment Ink Gère-t-il le Rendu dans un Terminal ?](file:///home/omni/Code/HIVE-MIND-RAILWAY/documentations/tui/explanation/ink-rendering-tty.md)

Explication sur l'adaptation de React dans le terminal via la bibliothèque Ink, la capture clavier et le comportement dans les environnements non-TTY.

### 3. ⚙️ [Comment AppContainer Structure-t-il l'État Global ?](file:///home/omni/Code/HIVE-MIND-RAILWAY/documentations/tui/explanation/app-container-design.md)

Analyse approfondie de la brique de vue principale `AppContainer`, de son histoire (héritage de Gemini) et de la centralisation de ses transitions d'état.
