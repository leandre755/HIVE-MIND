# 📐 Matrice d'Évaluation de la Santé du Codebase (Codebase Health Framework)

Ce document définit la méthodologie standard d'évaluation de la santé et de la qualité du projet **HIVE-MIND**. La note globale sur **100 points** mesure non seulement la propreté statique du code, mais aussi sa qualité architecturale et la valeur réelle délivrée à l'utilisateur.

---

## 📊 Répartition du Score de Santé (100 Points)

```
                    SCORE DE SANTÉ GLOBAL HIVE-MIND (100 PTS)
┌──────────────────────────────────────┬──────────────────────────────────────────────────────────┐
│   Pilier 1 : Statique & Opérationnel │            Pilier 2 : Cohérence Globale                  │
│               (40 / 100)             │                      (60 / 100)                          │
├──────────────────────────────────────┼────────────────────────────┬─────────────────────────────┤
│ - Fonct. sans bug runtime            │ Architecture du Code       │ Logique Fonctionnelle & UX  │
│ - Linter ESLint à 0 erreur           │        (30 / 100)          │         (30 / 100)          │
│ - Compilation TypeScript (0 ts-err)  │ - Isolation des couches    │ - Fonctionnalités branchées │
│ - Validation des tests automatisés   │ - Inversion de contrôle    │ - Ergonomie & Clarté UX     │
│                                      │ - Single Responsibility    │ - Utilité réelle produit    │
└──────────────────────────────────────┴────────────────────────────┴─────────────────────────────┘
```

---

## 🟢 Pilier 1 : Santé Statique & Opérationnelle (40 / 100)

Le Pilier 1 représente le **socle sanitaire minimal obligatoire**. Un code qui ne compila pas ou qui produit des erreurs de linter ne peut pas être évalué sur le plan architectural.

### Critères de Validation (40 Points)

1. **Zéro Erreur de Compilation (`tsc --noEmit`)** : Typage TypeScript strict et cohérent sur 100% des fichiers `.ts` et `.tsx`.
2. **Zéro Erreur/Warning ESLint (`npx eslint src/`)** : Respect des règles de formatage, absence d'importations inutilisées ou d'ombrages de variables.
3. **Absence de Bugs à l'Exécution (0 Crash Runtime)** : L'application s'exécute sans exceptions non capturées (`uncaughtException`), rejet de promesse silencieux (`unhandledRejection`) ou fuite mémoire.
4. **Validité de la Suite de Tests Unitaires (`npm run test:unit`)** : Exécution au vert de l'ensemble des scénarios de test.

> **Règle** : Un Pilier 1 à 40/40 est une **condition nécessaire mais non suffisante**. Il garantit seulement que le code s'exécute correctement sans faute de frappe, mais n'assure en rien qu'il est bien conçu ou utile.

---

## 🔵 Pilier 2.1 : Architecture & Structure du Code (30 / 100)

Le premier volet de la cohérence architecturale évalue la qualité de conception logicielle et la viabilité du code à long terme.

### Critères d'Évaluation (30 Points)

1. **Séparation Stricte des Couches (Layer Isolation)** :
   - `Presentation (UI / CLI / WhatsApp)` ➔ `Domain (Logique Métier Agnostique)` ➔ `Infra (E/S, API, BD)`.
   - Le domaine métier ne doit jamais dépendre d'un adaptateur d'E/S spécifique.
2. **Principe de Responsabilité Unique (SRP - Single Responsibility)** :
   - Chaque fichier, classe ou hook gère un seul niveau d'abstraction et une seule responsabilité clairement identifiée.
3. **Inversion de Contrôle & Découplage (IoC)** :
   - Utilisation du conteneur d'injection de dépendances (`ServiceContainer`) et des bus d'événements typés (`EventBus`) pour éliminer le couplage fort entre modules.
4. **Isolation Rigide des E/S (Isolated I/O)** :
   - Présence obligatoire de `AbortSignal`, de gestion de `timeout` et de replis résilients sur toute opération réseau ou système de fichiers.
5. **Sécurité & Protection Fail-Closed** :
   - Les vérifications de sécurité (ex: `PermissionManager` HITL) échouent par défaut et bloquent l'exécution non autorisée.

---

## 🟣 Pilier 2.2 : Logique Fonctionnelle, UX & Accessibilité Produit (30 / 100)

Le second volet de la cohérence évaluera l'expérience utilisateur et l'adéquation fonctionnelle globale. **Une fonctionnalité développée dans le backend mais inaccessible ou inutilisable pour l'utilisateur perd toute sa valeur.**

### Critères d'Évaluation (30 Points)

1. **Accessibilité Effective de la Fonctionnalité (No Ghost Features)** :
   - Toute capacité développée dans le Core/Backend doit être **exposée et utilisable** via une interface (TUI, CLI, commandes WhatsApp, API). Les fonctionnalités "orphelines" non raccordées sont proscrites.
2. **Clarté & Ergonomie de l'Expérience Utilisateur (UX)** :
   - Les retours d'information (statuts de traitement, spinners, confirmations HITL) doivent être immédiats, compréhensibles et sans ambiguïté.
3. **Pertinence Fonctionnelle & Sobriété** :
   - Élimination de l'over-engineering ou des options de configuration inutiles qui complexifient l'utilisation sans apporter de valeur produit.
4. **Résilience de la Interaction (User Guidance)** :
   - En cas d'erreur réseau, de limite de quota ou d'échec d'outil, le système guide l'utilisateur vers une solution claire (retry, suggestion de commande, fallback alternatif) au lieu d'afficher un message cryptique.

---

## 📈 Grille de Notation Globale du Projet

| Score Total  | Niveau de Santé              | Diagnostic                                                                                                    |
| :----------: | :--------------------------- | :------------------------------------------------------------------------------------------------------------ |
| **90 - 100** | 🌟 **Excellence Production** | Codebase propre, architecture découplée et expérience utilisateur irréprochable.                              |
| **75 - 89**  | 🟢 **Solide & Maintenable**  | Statique parfaite (40/40), bonne architecture mais quelques améliorations UX/accessibilité possibles.         |
| **50 - 74**  | 🟡 **Dette Technique**       | Statique propre mais présence de couplage fort, de fichiers géants ou de fonctionnalités orphelines.          |
|   **< 50**   | 🔴 **Critique**              | Présence de bugs runtime, erreurs de compilation ou architecture confuse nécessitant un refactoring immédiat. |

---

_Fichier de référence généré pour le projet HIVE-MIND._
