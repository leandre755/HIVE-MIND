# Hardening Foundations & Execution Utilities (SS-26) — Architecture & Principes de Fonctionnement

Le sous-système **Hardening Foundations & Execution Utilities** regroupe les bibliothèques d'infrastructure de bas niveau garantissant la sécurité des entrées/sorties disque, l'atomicité de la concurrence distribuée, la réparation résiliente des flux JSON, l'invisibilité des signatures TLS et la continuité d'état des sessions de shell interactif.

## 1. Contexte & Problématique d'Ingénierie

L'exécution d'un agent autonome doté de capacités d'édition de code, d'exécution de scripts shell et d'appels réseau l'expose directement aux vulnérabilités du système d'exploitation et du réseau :

1. **Les attaques par évasion d'arborescence (_Path Traversal_)** : L'utilisation imprudente de primitives de système de fichiers brutes (`node:fs`) permet à un LLM égaré ou à un prompt injecté d'accéder à des fichiers sensibles hors bac à sable (`../../../../etc/passwd`, clés privées, variables `.env`).
2. **Les courses concurrentielles distribuées (_Race Conditions_)** : Lorsque plusieurs sous-agents ou répliques de processus tentent de modifier simultanément un même fichier ou une ressource d'état partagé, l'absence de verrous distribués atomiques conduit à la corruption de données.
3. **La malformation des sorties JSON des LLM** : Les modèles de langage génèrent fréquemment des réponses JSON incomplètes, tronquées ou polluées par du texte libre, des commentaires de code (`// ...`) ou des guillemets simples.
4. **Le blocage anti-bot par empreinte TLS (JA3/JA4)** : Les requêtes HTTP émises par les bibliothèques standards de Node.js présentent une signature de négociation TLS facilement repérable par les WAF (Cloudflare, Akamai), bloquant les extractions documentaires légitimes.
5. **La perte d'état entre commandes shell** : L'exécution classique de commandes bash via `child_process.exec` recrée un sous-processus isolé à chaque appel, perdant le répertoire de travail (`cd /mon/dossier`), les variables d'environnement exportées et les processus d'arrière-plan.

HIVE-MIND adresse ces risques fondamentaux par un ensemble de cinq utilitaires durcis sans dépendance vers les couches supérieures.

## 2. Modèle Mental & Architecture Conceptuelle

Le socle de durcissement forme la couche de fondation technique ($C_e = 0, I = 0.00$) supportant l'ensemble des modules du démon.

```
+-------------------------------------------------------------------------------+
|             FONDATIONS DE DURCISSEMENT & UTILITAIRES SYSTEME (SS-26)          |
+-------------------------------------------------------------------------------+
                                        │
        +-------------------------------+-------------------------------+
        │                               │                               │
        ▼                               ▼                               ▼
+-----------------------+   +-----------------------+   +-----------------------+
| 1. SafeFs             |   | 2. LockManager        |   | 3. ResponseEnforcer   |
| - resolveWithinRoot   |   | - Redlock Pattern     |   | - tryParseJson multi  |
| - Anti-Path Traversal |   | - crypto.randomBytes  |   | - jsonrepair moteur   |
| - Wrappers Sync/Async |   | - Script Lua Atomique |   | - [SYSTEM REJECTION]  |
| - Banning raw node:fs |   | - TTL PX + NX Redis   |   | - Boucle d'invalidation|
+-----------------------+   +-----------------------+   +-----------------------+
        │                                                               │
        +-------------------------------+-------------------------------+
        │                               │
        ▼                               ▼
+-----------------------+   +-----------------------+
| 4. TlsImpersonator    |   | 5. PersistentShell    |
| - Agent HTTPS JA3/JA4 |   | - bash -i daemonisé   |
| - Ciphers Chromium/Go |   | - Maintien du CWD     |
| - Bypass WAF/AntiBot  |   | - Jeton Sentinelle    |
| - ALPN http/1.1       |   | - Interruption Ctrl+C |
+-----------------------+   +-----------------------+
```

### Décomposition des 5 Piliers

1. **SafeFs (`safeFs.ts`)** : Encapsule toutes les méthodes synchrones et asynchrones du système de fichiers. La fonction clé `resolveWithinRoot(rootPath, childPath)` normalise les chemins relatifs et absolus et vérifie qu'ils demeurent strictement à l'intérieur du répertoire racine désigné. Tout dépassement lève immédiatement une exception bloquante `Path outside allowed root`.
2. **LockManager (`LockManager.ts`)** : Implémente le pattern Redlock sur Redis. La prise de verrou utilise `SET lock:prefix:key lockId PX ttl NX`. La libération est garantie atomique par un script Lua (`if redis.call("get") == ARGV[1] then return redis.call("del")`), évitant qu'un processus ne libère par erreur le verrou d'un tiers après expiration du TTL.
3. **ResponseFormatEnforcer (`ResponseFormatEnforcer.ts`)** : Algorithme multi-candidats extrayant les blocs JSON les plus probables d'une réponse brute, appliquant `jsonrepair` pour corriger les erreurs de syntaxe mineures, et réinjectant une directive corrective `[SYSTEM REJECTION]` vers le LLM en cas d'échec répété.
4. **TlsImpersonator (`TlsImpersonator.ts`)** : Construit un `https.Agent` dont l'ordre des suites de chiffrement (`ciphers`), les courbes elliptiques (X25519, P-256) et les protocoles ALPN imitent fidèlement l'empreinte cryptographique JA3 de navigateurs réels ou du client Go standard.
5. **PersistentShell (`PersistentShell.ts`)** : Processus bash interactif persistant synchronisé par injection de jetons sentinelles (`__HIVE_MIND_SHELL_DONE__<exitCode>|<cwd>`), préservant le répertoire courant et gérant l'interruption par caractère `0x03` (Ctrl+C) en cas de timeout.

## 3. Choix de Conception & Raisons d'Ingénierie

- **Interdiction Formelle des Imports `node:fs` Bruts** : Les règles de gouvernance du projet et les linters interdisent l'usage direct de `node:fs` au profit exclusif de `safeFs.ts`, garantissant qu'aucune opération d'écriture ou de lecture ne puisse contourner le contrôle d'accès.
- **Script Lua pour la Libération de Verrou** : Dans un environnement asynchrone distribué, un simple `GET` suivi d'un `DEL` est soumis à un entrelacement critique. L'exécution d'un script Lua au sein du moteur Redis garantit l'atomicité absolue de la vérification du détenteur et de la suppression du verrou.
- **Protocole Sentinelle dans PersistentShell** : L'injection de la commande `echo "__HIVE_MIND_SHELL_DONE__$?|$(pwd)"` immédiatement après chaque instruction utilisateur permet de capturer à la fois la fin exacte d'exécution, le code de retour numérique et le nouveau chemin de travail effectif sans bloquer le flux standard `stdout`.

## 4. Analyse Comparative & Alternatives Écartées

| Approche Alternative                       | Avantages Théoriques                                     | Inconvénients / Raisons du Rejet par HIVE-MIND                                                                    |
| :----------------------------------------- | :------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------- |
| **Appels `node:fs` non encapsulés**        | Aucun wrapper, performance native brute.                 | Vulnérabilité critique aux attaques par traversée de répertoires (`../../etc/shadow`).                            |
| **Verrous mémoire locaux (`async-mutex`)** | Zéro dépendance à Redis.                                 | Inopérant en architecture multi-processus ou lors d'un déploiement distribué en grappe.                           |
| **`child_process.exec` ponctuel**          | Simplicité d'appel, gestion automatique du cycle de vie. | Perte complète du répertoire de travail (`cd`) et des variables d'environnement entre deux commandes successives. |
| **Agent HTTPS standard de Node.js**        | Zéro configuration.                                      | Empreinte JA3 caractéristique immédiatement bloquée par les solutions de protection anti-bot lors du scraping.    |

## 5. Frontières Architecturales & Invariants

### Périmètre Strict (Dans le Sous-Système)

- Sécurisation absolue des entrées/sorties du système de fichiers local.
- Gestion des verrous distribués Redlock sur Redis avec boucle d'attente à gigue aléatoire (_jitter_).
- Réparation syntaxique et extraction résiliente de structures JSON.
- Forgeage d'agents TLS personnalisés pour l'alignement d'empreinte JA3.
- Cycle de vie d'un processus shell persistant.

### Hors Périmètre (Délégué aux Couches Adjacentes)

- **Règles métier de validation des commandes** : Déléguées à `PermissionManager` (SS-09).
- **Routage des modèles et inférence** : Délégués à `Layer0`/`Layer1` (SS-10 / SS-12).

### Invariants Opérationnels

1. **Invariant de Clôture Arborescente** : Toute tentative de résolution d'un chemin relatif ou absolu sortant de la racine définie par `rootPath` lève immédiatement une exception explicite `Error: Path outside allowed root`.
2. **Invariant de Résilience Shell** : Si une commande exécutée dans `PersistentShell` dépasse son délai imparti (`timeoutMs`), le signal d'interruption `0x03` est transmis sur `stdin` et le tampon de lecture est vidé pour éviter de corrompre les commandes futures.

## 6. Liens & Navigation

- **Référence Technique :** [`system-hardening-reference.md`](./system-hardening-reference.md)
- **Guide Pratique d'Intégration :** [`system-hardening-howto.md`](./system-hardening-howto.md)
- **Index du Domaine Plugins :** [`index.md`](./index.md)
- **Index Général :** [`../00_index.md`](../00_index.md)
