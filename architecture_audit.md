# Audit d'Architecture - SonarCloud (HIVE-MIND)

_Date d'exécution_ : 2026-07-24  
_Projet SonarCloud_ : `leandre755_HIVE-MIND`  
_URL du projet_ : [https://sonarcloud.io/project/deviations?id=leandre755_HIVE-MIND](https://sonarcloud.io/project/deviations?id=leandre755_HIVE-MIND)  
_Périmètre analysé_ : **Déviations architecturales, enchevêtrements et violations du principe de responsabilité unique (SRP)**

---

## 📊 1. Résumé des Métriques d'Architecture

| Catégorie de Déviation                      | Nombre | Niveau d'Impact | Description Technique                                                                    |
| ------------------------------------------- | ------ | --------------- | ---------------------------------------------------------------------------------------- |
| **Oversized (Fichiers Surdimensionnés)**    | **5**  | 🔴 Critique     | Fichiers géants cumulant complexité cognitive extrême et lignes de code excédentaires.   |
| **Tangles (Dépendances Cycliques)**         | **3**  | 🔴 Critique     | Boucles d'imports circulaires et fonctions imbriquées à plus de 4 niveaux.               |
| **Split Responsibilities (Violations SRP)** | **47** | 🟡 Majeur       | Fonctions combinant plusieurs responsabilités distinctes (E/S, logique métier, état UI). |
| **Weak Tangles (Enchevêtrements Faibles)**  | **2**  | 🟡 Majeur       | Couplages indirects entre les composants UI et les hooks de gestion d'état.              |

---

## 🛑 2. Les 5 Fichiers & Composants Surdimensionnés (Oversized)

_Fichiers violant les limites de taille et présentant une complexité cognitive extrême (seuil autorisé par SonarCloud : 15)_.

1. **[src/core/index.ts](file:///home/omni/Code/HIVE-MIND-RAILWAY/src/core/index.ts#L711)** (3 119 lignes) — Complexité Cognitive : **372**
2. **[src/providers/index.ts](file:///home/omni/Code/HIVE-MIND-RAILWAY/src/providers/index.ts#L402)** (857 lignes) — Complexité Cognitive : **144**
3. **[src/providers/adapters/codex.ts](file:///home/omni/Code/HIVE-MIND-RAILWAY/src/providers/adapters/codex.ts#L128)** (327 lignes) — Complexité Cognitive : **85**
4. **[src/tui/config/settings.ts](file:///home/omni/Code/HIVE-MIND-RAILWAY/src/tui/config/settings.ts#L956)** (960+ lignes) — Complexité Cognitive : **61**
5. **[src/core/transport/baileys.ts](file:///home/omni/Code/HIVE-MIND-RAILWAY/src/core/transport/baileys.ts#L321)** (1 237 lignes) — Complexité Cognitive : **58**

---

## 🔄 3. Les 3 Tangles (Dépendances Cycliques & Imbrications Profondes)

_Fonctions ou modules imbriqués à plus de 4 niveaux de profondeur_.

1. **[src/core/transport/TuiServerTransport.ts](file:///home/omni/Code/HIVE-MIND-RAILWAY/src/core/transport/TuiServerTransport.ts#L56)** — Fonctions imbriquées à plus de 4 niveaux de profondeur (`typescript:S2004`).
2. **[src/tui/ui/hooks/useSlashCompletion.ts](file:///home/omni/Code/HIVE-MIND-RAILWAY/src/tui/ui/hooks/useSlashCompletion.ts#L236)** — Imbrication d'évaluations conditionnelles et closures à > 4 niveaux.
3. **[src/tui/ui/hooks/useSlashCompletion.ts](file:///home/omni/Code/HIVE-MIND-RAILWAY/src/tui/ui/hooks/useSlashCompletion.ts#L528)** — Imbrication de filtres et de callbacks à > 4 niveaux.

---

## ⚡ 4. Les 2 Weak Tangles (Couplages Indirects UI / Hooks)

1. **[src/tui/ui/hooks/useHeaderBanner.ts](file:///home/omni/Code/HIVE-MIND-RAILWAY/src/tui/ui/hooks/useHeaderBanner.ts#L38)** — Agrégation asynchrone invalide sur des valeurs non-Promise (`typescript:S4123`).
2. **[src/tui/ui/commands/clearCommand.ts](file:///home/omni/Code/HIVE-MIND-RAILWAY/src/tui/ui/commands/clearCommand.ts#L13)** — Mot-clé `await` inopérant sur une valeur synchrone.

---

## 🧩 5. Catalogue des 47 Responsabilités Divisées (Split Responsibilities - Violations SRP)

| N°     | Fichier & Emplacement                                                                                                                                                       | Complexité Cognitive | Description de la Déviation Architectural                 |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | --------------------------------------------------------- |
| **1**  | [src/core/index.ts:L711](file:///home/omni/Code/HIVE-MIND-RAILWAY/src/core/index.ts#L711)                                                                                   | **372**              | Boucle ReAct monolithique mélangeant routage, état et E/S |
| **2**  | [src/providers/index.ts:L402](file:///home/omni/Code/HIVE-MIND-RAILWAY/src/providers/index.ts#L402)                                                                         | **144**              | Adaptateur multi-modèles centralisé                       |
| **3**  | [src/providers/adapters/codex.ts:L128](file:///home/omni/Code/HIVE-MIND-RAILWAY/src/providers/adapters/codex.ts#L128)                                                       | **85**               | Formatage des messages et sérialisation                   |
| **4**  | [src/tui/config/settings.ts:L956](file:///home/omni/Code/HIVE-MIND-RAILWAY/src/tui/config/settings.ts#L956)                                                                 | **61**               | Validation et fusion des paramètres TUI                   |
| **5**  | [src/core/transport/baileys.ts:L321](file:///home/omni/Code/HIVE-MIND-RAILWAY/src/core/transport/baileys.ts#L321)                                                           | **58**               | Gestionnaire de connexion WebSocket WhatsApp              |
| **6**  | [src/core/index.ts:L325](file:///home/omni/Code/HIVE-MIND-RAILWAY/src/core/index.ts#L325)                                                                                   | **53**               | Handler d'exécution des outils du core                    |
| **7**  | [src/tui/ui/hooks/useShellCompletion.ts:L54](file:///home/omni/Code/HIVE-MIND-RAILWAY/src/tui/ui/hooks/useShellCompletion.ts#L54)                                           | **53**               | Auto-complétion du terminal shell Ink                     |
| **8**  | [src/tui/ui/hooks/atCommandProcessor.ts:L297](file:///home/omni/Code/HIVE-MIND-RAILWAY/src/tui/ui/hooks/atCommandProcessor.ts#L297)                                         | **51**               | Processeur des commandes `@file` / `@context`             |
| **9**  | [src/core/index.ts:L2803](file:///home/omni/Code/HIVE-MIND-RAILWAY/src/core/index.ts#L2803)                                                                                 | **49**               | Parsing et nettoyage des historiques de messages          |
| **10** | [src/utils/fuzzyMatcher.ts:L92](file:///home/omni/Code/HIVE-MIND-RAILWAY/src/utils/fuzzyMatcher.ts#L92)                                                                     | **48**               | Algorithme de recherche approximative                     |
| **11** | [src/services/agentic/Planner.ts:L93](file:///home/omni/Code/HIVE-MIND-RAILWAY/src/services/agentic/Planner.ts#L93)                                                         | **45**               | Planificateur d'étapes d'exécution ReAct                  |
| **12** | [src/tui/utils/sessionCleanup.ts:L498](file:///home/omni/Code/HIVE-MIND-RAILWAY/src/tui/utils/sessionCleanup.ts#L498)                                                       | **44**               | Purge et rotation des fichiers de session                 |
| **13** | [src/tui/ui/components/InputPrompt.tsx:L1570](file:///home/omni/Code/HIVE-MIND-RAILWAY/src/tui/ui/components/InputPrompt.tsx#L1570)                                         | **43**               | Gestionnaire principal des raccourcis clavier prompt      |
| **14** | [src/utils/readFileInRange.ts:L166](file:///home/omni/Code/HIVE-MIND-RAILWAY/src/utils/readFileInRange.ts#L166)                                                             | **43**               | Découpage des tranches de lecture de fichiers             |
| **15** | [src/tui/ui/AppContainer.tsx:L472](file:///home/omni/Code/HIVE-MIND-RAILWAY/src/tui/ui/AppContainer.tsx#L472)                                                               | **40**               | Gestion de l'état des fenêtres et bannières               |
| **16** | [src/tui/ui/contexts/KeypressContext.tsx:L445](file:///home/omni/Code/HIVE-MIND-RAILWAY/src/tui/ui/contexts/KeypressContext.tsx#L445)                                       | **40**               | Écouteur d'événements de touches TUI                      |
| **17** | [src/tui/ui/utils/MarkdownDisplay.tsx:L71](file:///home/omni/Code/HIVE-MIND-RAILWAY/src/tui/ui/utils/MarkdownDisplay.tsx#L71)                                               | **40**               | Rendu des blocs de code et tableaux Markdown              |
| **18** | [src/core/index.ts:L2304](file:///home/omni/Code/HIVE-MIND-RAILWAY/src/core/index.ts#L2304)                                                                                 | **39**               | Gestionnaire des timeouts et retry LLM                    |
| **19** | [src/tui/ui/components/InputPrompt.tsx:L844](file:///home/omni/Code/HIVE-MIND-RAILWAY/src/tui/ui/components/InputPrompt.tsx#L844)                                           | **39**               | Handler du mode édition multi-lignes                      |
| **20** | [src/services/ptc/SafeScriptValidator.ts:L405](file:///home/omni/Code/HIVE-MIND-RAILWAY/src/services/ptc/SafeScriptValidator.ts#L405)                                       | **39**               | Inspecteur AST pour la validation de scripts              |
| **21** | [src/tui/ui/components/shared/SlicingMaxSizedBox.tsx:L29](file:///home/omni/Code/HIVE-MIND-RAILWAY/src/tui/ui/components/shared/SlicingMaxSizedBox.tsx#L29)                 | **38**               | Rognage dynamique des conteneurs Ink                      |
| **22** | [src/tui/ui/hooks/shellReducer.ts:L50](file:///home/omni/Code/HIVE-MIND-RAILWAY/src/tui/ui/hooks/shellReducer.ts#L50)                                                       | **38**               | Reducer d'état du shell interactif                        |
| **23** | [src/core/handlers/schedulerHandler.ts:L279](file:///home/omni/Code/HIVE-MIND-RAILWAY/src/core/handlers/schedulerHandler.ts#L279)                                           | **38**               | Planificateur de tâches différées                         |
| **24** | [src/tui/ui/components/messages/ToolConfirmationMessage.tsx:L127](file:///home/omni/Code/HIVE-MIND-RAILWAY/src/tui/ui/components/messages/ToolConfirmationMessage.tsx#L127) | **37**               | Overlay de demande de confirmation HITL                   |
| **25** | [src/tui/ui/components/InputPrompt.tsx:L549](file:///home/omni/Code/HIVE-MIND-RAILWAY/src/tui/ui/components/InputPrompt.tsx#L549)                                           | **37**               | Gestion des suggestions d'auto-complétion                 |
| **26** | [src/services/agentic/Planner.ts:L532](file:///home/omni/Code/HIVE-MIND-RAILWAY/src/services/agentic/Planner.ts#L532)                                                       | **37**               | Synthèse des retours d'outils                             |
| **27** | [src/tui/ui/hooks/useCommandCompletion.tsx:L133](file:///home/omni/Code/HIVE-MIND-RAILWAY/src/tui/ui/hooks/useCommandCompletion.tsx#L133)                                   | **36**               | Complétion des commandes slash (`/`)                      |
| **28** | [src/tui/ui/components/shared/text-buffer.ts:L199](file:///home/omni/Code/HIVE-MIND-RAILWAY/src/tui/ui/components/shared/text-buffer.ts#L199)                               | **35**               | Manipulation du curseur de texte                          |
| **29** | [src/tui/core/connection.ts:L179](file:///home/omni/Code/HIVE-MIND-RAILWAY/src/tui/core/connection.ts#L179)                                                                 | **33**               | Reconnexion et heartbeat WebSocket                        |
| **30** | [src/services/goalsService.ts:L164](file:///home/omni/Code/HIVE-MIND-RAILWAY/src/services/goalsService.ts#L164)                                                             | **33**               | Gestionnaire d'objectifs long-terme                       |
| **31** | [src/services/anchor/AnchorStateManager.ts:L195](file:///home/omni/Code/HIVE-MIND-RAILWAY/src/services/anchor/AnchorStateManager.ts#L195)                                   | **33**               | Synchronisation du dictionnaire d'ancres                  |
| **32** | [src/providers/geminiLive.ts:L189](file:///home/omni/Code/HIVE-MIND-RAILWAY/src/providers/geminiLive.ts#L189)                                                               | **32**               | Streaming audio/texte Gemini Live                         |
| **33** | [src/tui/ui/components/shared/text-buffer.ts:L1275](file:///home/omni/Code/HIVE-MIND-RAILWAY/src/tui/ui/components/shared/text-buffer.ts#L1275)                             | **32**               | Rendu des sélections et surlignages                       |
| **34** | [src/tui/ui/utils/clipboardUtils.ts:L263](file:///home/omni/Code/HIVE-MIND-RAILWAY/src/tui/ui/utils/clipboardUtils.ts#L263)                                                 | **32**               | Interaction presse-papier OS                              |
| **35** | [src/tui/ui/components/shared/ExpandableText.tsx:L26](file:///home/omni/Code/HIVE-MIND-RAILWAY/src/tui/ui/components/shared/ExpandableText.tsx#L26)                         | **31**               | Expansion/réduction de texte Ink                          |
| **36** | [src/tui/ui/contexts/ScrollProvider.tsx:L115](file:///home/omni/Code/HIVE-MIND-RAILWAY/src/tui/ui/contexts/ScrollProvider.tsx#L115)                                         | **31**               | Calculs de défilement vertical                            |
| **37** | [src/plugins/whatsapp/group_manager/index.ts:L858](file:///home/omni/Code/HIVE-MIND-RAILWAY/src/plugins/whatsapp/group_manager/index.ts#L858)                               | **31**               | Gestionnaire de métadonnées de groupes WhatsApp           |
| **38** | [src/tui/ui/hooks/useShellCompletion.ts:L311](file:///home/omni/Code/HIVE-MIND-RAILWAY/src/tui/ui/hooks/useShellCompletion.ts#L311)                                         | **30**               | Filtre de fichiers du terminal                            |
| **39** | [src/plugins/base/dev_tools/FileEditTool.ts:L166](file:///home/omni/Code/HIVE-MIND-RAILWAY/src/plugins/base/dev_tools/FileEditTool.ts#L166)                                 | **29**               | Outil d'édition de fichiers                               |
| **40** | [src/tui/utils/sessionUtils.ts:L224](file:///home/omni/Code/HIVE-MIND-RAILWAY/src/tui/utils/sessionUtils.ts#L224)                                                           | **28**               | Formatage d'historique de session                         |
| **41** | [src/tui/ui/components/AskUserDialog.tsx:L423](file:///home/omni/Code/HIVE-MIND-RAILWAY/src/tui/ui/components/AskUserDialog.tsx#L423)                                       | **18**               | Rendu de dialogue choix multiples                         |
| **42** | [src/tui/ui/components/BackgroundTaskDisplay.tsx:L329](file:///home/omni/Code/HIVE-MIND-RAILWAY/src/tui/ui/components/BackgroundTaskDisplay.tsx#L329)                       | **20**               | Affichage des processus en arrière-plan                   |
| **43** | [src/tui/ui/components/ColorsDisplay.tsx:L95](file:///home/omni/Code/HIVE-MIND-RAILWAY/src/tui/ui/components/ColorsDisplay.tsx#L95)                                         | **16**               | Palette et thème de couleurs                              |
| **44** | [src/tui/ui/components/SessionBrowser.tsx:L561](file:///home/omni/Code/HIVE-MIND-RAILWAY/src/tui/ui/components/SessionBrowser.tsx#L561)                                     | **20**               | Explorateur de sessions d'historique                      |
| **45** | [src/tui/ui/components/ThemeDialog.tsx:L137](file:///home/omni/Code/HIVE-MIND-RAILWAY/src/tui/ui/components/ThemeDialog.tsx#L137)                                           | **16**               | Modal de sélection de thèmes                              |
| **46** | [src/tui/ui/components/ToastDisplay.tsx:L24](file:///home/omni/Code/HIVE-MIND-RAILWAY/src/tui/ui/components/ToastDisplay.tsx#L24)                                           | **16**               | Rendu des notifications Toasts                            |
| **47** | [src/tui/ui/components/shared/vim-buffer-actions.ts:L95](file:///home/omni/Code/HIVE-MIND-RAILWAY/src/tui/ui/components/shared/vim-buffer-actions.ts#L95)                   | **16**               | Moteur de raccourcis clavier Vim                          |

---

## 🎯 6. Alignement avec la Feuille de Route GCC (10 Sessions)

Ces 57 déviations d'architecture seront résolues progressivement lors des **Sessions 5, 6, 7 et 8** :

- **Session 5** : Découpage de `src/core/index.ts` (Issues #1, #6, #9, #18).
- **Session 6** : Découpage de `src/core/transport/baileys.ts` (#5) et `TuiServerTransport.ts` (Tangle #1).
- **Session 7** : Découpage de `AppContainer.tsx` (#15), `InputPrompt.tsx` (#13, #19, #25) et `text-buffer.ts` (#28, #33).
- **Session 8** : Découpage des services `Planner.ts` (#11, #26), `providers/index.ts` (#2) et `settings.ts` (#4).
