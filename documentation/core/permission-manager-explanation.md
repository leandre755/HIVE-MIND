# PermissionManager — Architecture & Principes de Fonctionnement

Le sous-système **PermissionManager** constitue le contrôleur de sécurité pré-action, le garde-fou d'isolation du système de fichiers et la passerelle d'approbation humaine (*Human-In-The-Loop* - HITL) de HIVE-MIND.

## 1. Contexte & Problématique d'Ingénierie

Dans un environnement où un agent autonome dispose de capacités d'exécution de commandes système (`bash`) et de manipulation du système de fichiers (`write_file`), les risques d'intégrité sont critiques :
- **Destruction ou altération du code source de l'hôte** : Sans confinement strict, un modèle halluciné pourrait écraser des fichiers du projet ou altérer ses propres dépendances.
- **Attaques par évasion de bac à sable (*Sandbox Escape*)** : L'utilisation de liens symboliques pointant vers `/etc` ou la racine hôte, ou de séquences `../../` permettrait de contourner les vérifications de chemins simples.
- **Élévation de privilèges et exécution de code non supervisé** : L'invocation de `sudo` ou l'exécution en ligne de scripts (`node -e "..."`, `python -c "..."`) échappe à l'analyse statique d'AST du moteur PTC.

`PermissionManager` applique une politique de sécurité en profondeur combinant sanctuarisation physique à double disque, filtrage déterministe et protocole HITL à 3 voies avec principe de repli fermé (*Fail-Closed*).

## 2. Modèle Mental & Architecture Conceptuelle

La sécurité du composant repose sur trois barrières successives :

### 1. Sanctuarisation du Système de Fichiers (Double Disque)
Toute tentative d'écriture de fichier est systématiquement confinée dans deux répertoires autorisés :
- `Sandbox1/` : Espace de travail volatile de l'agent.
- `storage_hm/` : Répertoire de stockage persistant (données, rapports, téléchargements).
La résolution des chemins s'effectue via `safeRealPathSync` et `resolvePathWithSymlinks`, neutralisant immédiatement les attaques par liens symboliques ou traversée de répertoires.

### 2. Filtrage Déterministe des Commandes Shell
- **Commandes formellement bannies (`BANNED_COMMANDS`)** : `su`, `sudo` (toute tentative d'élévation de privilèges est rejetée sans appel).
- **Motifs de drapeaux interdits (`BANNED_FLAG_PATTERNS`)** : `node -e`, `python -c`, `bash -c`, `sh -c`, `ruby -e` (bloque l'exécution de code en ligne non supervisé).
- **Commandes sûres en lecture seule (`SAFE_COMMANDS`)** : `git status`, `pwd`, `ls`, `cat`, `date` (autorisées immédiatement sans sollicitation humaine).

### 3. Architecture d'Approbation Humaine (HITL) à 3 Niveaux
Lorsqu'une action sensible est détectée, `PermissionManager` génère une requête d'autorisation avec un identifiant numérique unique et la soumet selon la hiérarchie suivante :
- **Logique 0 (Local TUI/CLI)** : Notification RPC WebSocket directe vers le terminal interactif de l'administrateur.
- **Logique 1 (Admin Security Hub)** : Escalade vers un groupe administrateur dédié (WhatsApp, Discord, Telegram) avec commandes de validation (`.approve <id>`, `.reject <id> [instructions]`).
- **Logique 2 (In-Band Fallback)** : Sollicitation dans la conversation active avec analyse du langage naturel (`oui`, `non`, consignes correctives).

```
 [Action Sensible : Bash / WriteFile]
                   │
                   ▼
       [Vérification Double Disque]
     Chemin dans Sandbox1 / storage_hm ?
            /               \
          NON               OUI
          /                   \
         ▼                     ▼
    [Rejet Immédiat]    [Validation Commande]
                        Bannie (sudo, node -e) ?
                               /        \
                             OUI        NON
                             /            \
                            ▼              ▼
                    [Rejet Immédiat]  [Protocole HITL 3 Niveaux]
                                      ├─ Logique 0 : TUI / CLI WebSocket
                                      ├─ Logique 1 : Admin Hub (.approve <id>)
                                      └─ Logique 2 : In-Band Conversationnel
                                             │
                                             ▼
                                  Décision Humaine / Timeout (10 min)
                                  ├─ Accordé ──► Exécution
                                  └─ Rejeté / Expiré ──► Fail-Closed
```

## 3. Choix de Conception & Raisons d'Ingénierie

1. **Sécurité par Défaut Fermée (*Fail-Closed Invariant*)** :
   - *Raison* : En cas d'expiration du minuteur de 10 minutes, de coupure réseau ou d'indisponibilité du transport d'administration, toute requête en attente est systématiquement rejetée (`granted: false`).
2. **Rétroaction Constructive Humaine** :
   - *Raison* : Lorsqu'un administrateur rejette une commande (ex: `.reject 42 utilise plutôt npm test`), le motif explicatif `feedback` est directement réinjecté dans la mémoire de réflexion de l'agent, lui permettant d'adapter sa stratégie au tour suivant.
3. **Résolution Symlinks Segment par Segment** :
   - *Raison* : La fonction `resolveSegmentedPath` évalue récursivement chaque segment de chemin pour garantir qu'aucun lien symbolique intermédiaire ne pointe en dehors des dossiers sanctuarisés.

## 4. Analyse Comparative & Alternatives Écartées

| Approche Alternative | Avantages Théoriques | Inconvénients / Raisons du Rejet par HIVE-MIND |
| :--- | :--- | :--- |
| **Validation par simple Regex de chaîne** | Très rapide à exécuter. | Vulnérable aux encodages alternatifs, aux liens symboliques et aux séquences `../` imbriquées. |
| **Confirmation uniquement dans le chat utilisateur** | Simple, aucun hub d'administration nécessaire. | Risque si l'utilisateur n'a pas les compétences techniques pour évaluer le danger d'une commande système. |
| **Isolation par conteneur Docker éphémère** | Isolation OS native. | Impossibilité pour l'agent de modifier des fichiers persistants utiles sans synchronisation de volumes complexe. |

## 5. Frontières Architecturales & Invariants

- **Dans le périmètre de `PermissionManager`** :
  - Confinement strict des chemins de fichiers autorisés en écriture.
  - Interception et filtrage des commandes bash sensibles.
  - Gestion du cycle de vie des requêtes HITL (émission, timeout 10min, résolution).
- **Exclu du périmètre** :
  - Exécution effective du processus shell (déléguée à `bashTool` / `safeFs`).
  - Filtrage des entrées réseau de l'utilisateur (délégué à `moderationService`).

## 6. Liens & Navigation

- **Référence Technique :** [`permission-manager-reference.md`](./permission-manager-reference.md)
- **Guide Pratique d'Intégration :** [`permission-manager-howto.md`](./permission-manager-howto.md)
- **Index du Domaine Core :** [`index.md`](./index.md)
