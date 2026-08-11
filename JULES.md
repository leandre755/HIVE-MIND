# Normes de Codage et Qualité (HIVE-MIND)

Ce document définit les standards de développement et de sécurité applicables aux contributions du projet HIVE-MIND.

## 1. Architecture et Conception

- **Taille limite** : Une fonction ne doit pas dépasser 200 lignes de code.
- **Couplage et Cohésion** : Chaque module ou fichier doit posséder une responsabilité principale unique (principe de responsabilité unique). Les dépendances doivent pointer vers des abstractions ou des interfaces plutôt que des implémentations concrètes.

## 2. Gestion des Erreurs et Robustesse

- **Traitement des Rejets** : Les rejets de promesses, codes d'erreur et exceptions doivent être interceptés et traités. Les blocs vides de type `catch(console.error)` sont interdits pour les opérations modifiant l'état du système.
- **Preconditions** : Les entrées et paramètres de fonctions doivent être validés systématiquement. Tout paramètre déclaré doit être exploité dans le corps de la fonction.

## 3. Concurrence et Performance

- **E/S Concurrentes** : L'exécution d'appels d'E/S ou d'API indépendants au sein de boucles doit être parallélisée via `Promise.all` pour éviter les ralentissements séquentiels.
- **Ressources** : Les opérations réseau et disque doivent comporter des mécanismes de temporisation (timeouts) ou d'annulation (AbortSignals).

## 4. Sécurité et Commandes

- **Injection de Commandes** : L'exécution de commandes externes via des processus enfants doit se faire par passage d'arguments sous forme de tableau (`execFile`) et non par concaténation de chaînes de caractères brutes (`exec`), afin de prévenir les injections.
- **Sécurisation par défaut** : En cas d'erreur lors d'un contrôle d'autorisation ou de sécurité, la fonction doit lever une exception ou retourner une réponse restrictive (fail-closed).

## 5. Cohérence et Intégrité des Contributions

- **Liaison du Code et des Revendications** : Les modifications de fichiers doivent correspondre exactement aux fonctionnalités décrites dans le titre de la Pull Request, sa description et le fichier de suivi `.GCC/resume.md`. Une contribution affirmant implémenter ou modifier du code applicatif, mais qui ne contient en réalité que des modifications de documentation, de métadonnées ou de simples scripts de test sans le code métier associé, doit être rejetée avec demande de correction.
