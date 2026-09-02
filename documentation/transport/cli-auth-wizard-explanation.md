# SS-17 : CLI Interactive Auth Wizard & Multi-Account Session Manager — Architecture & Principes de Fonctionnement

Le sous-système **SS-17** (`CLI Interactive Auth Wizard & Multi-Account Session Manager`) constitue l'assistant interactif en ligne de commande dédié à l'initialisation, à la configuration, à l'authentification et au diagnostic des canaux de communication de HIVE-MIND avant le démarrage du démon principal.

---

## 1. Contexte & Problématique d'Ingénierie

La configuration manuelle des identifiants et clés d'API pour des passerelles multi-canaux (WhatsApp, Discord, Telegram) est traditionnellement source d'erreurs majeures en production :
1. **Échecs au Boot Post-Démarrage** : Un jeton Discord ou Telegram mal copié dans un fichier `.env` n'est souvent détecté qu'après l'initialisation lourde du conteneur IoC et des moteurs de mémoire, entraînant un crash applicatif brutal et des redémarrages en boucle.
2. **Complexité du Jumelage WhatsApp Sans Caméra** : Sur un serveur distant (VPS / conteneur Docker sans interface graphique), scanner un QR code dans un terminal dégradé est souvent impossible. WhatsApp permet un jumelage par code à 8 chiffres (*pairing code*), mais ce protocole requiert une synchronisation cryptographique stricte (handshake Noise) sous peine de rejet silencieux par les serveurs WhatsApp.
3. **Risques de Corruption du `.env` & Injections CRLF** : L'écriture non assainie de variables d'environnement peut écraser des commentaires critiques ou introduire des retours chariot malveillants (*CRLF injection*).

SS-17 résout ces défis en fournissant une couche interactive pré-boot isolée garantissant la validation réseau en temps réel des identifiants et l'écriture atomique et sécurisée des configurations.

---

## 2. Modèle Mental & Architecture Conceptuelle

SS-17 s'articule autour de trois modules complémentaires exécutés en amont du démarrage de l'agent :
- **`startupMenu` (Menu Interactif & Décompte Non-Bloquant)** : Affiche un tableau de bord visuel de l'état des connexions (`renderStatusPanel`), propose la connexion/déconnexion des canaux, et gère un décompte automatique de 2 secondes interrompable par n'importe quelle frappe clavier (`waitWithInterruption`).
- **`authSessionManager` (Validateur Réseau & Gestionnaire `.env`)** : Exécute des requêtes de vérification en direct (*pre-flight checks*) auprès des serveurs officiels Telegram (`api.telegram.org/bot<TOKEN>/getMe`) et Discord (`discord.com/api/v9/users/@me`) avec un timeout défensif de 8 secondes. Assainit et persiste les clés dans `.env` via `safeFs`.
- **`whatsappAuthHelper` (Assistant d'Authentification Baileys)** : Gère le cycle de vie de la session WhatsApp. Propose soit le rendu de QR code dans le terminal (`qrcode-terminal`), soit la demande de code d'association formaté `XXXX-XXXX`.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    PHASE PRÉ-BOOT : MENU CLI INTERACTIF                     │
│                                                                             │
│  1. Vérification de l'environnement : Headless ou CI ?                      │
│     ├── Oui -> Skip immédiat vers le démarrage du démon                     │
│     └── Non -> Tous les comptes sont-ils connectés ?                        │
│                ├── Oui -> Décompte 2s (Interruption possible)               │
│                └── Non -> Affichage du panneau d'état interactif            │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CHOIX DE L'UTILISATEUR                            │
│                                                                             │
│    ┌─────────────────────────┐           ┌─────────────────────────────┐    │
│    │  1. Connecter un compte │           │  2. Déconnecter un compte   │    │
│    └────────────┬────────────┘           └──────────────┬──────────────┘    │
│                 │                                       │                   │
│         ┌───────┴─────────────────┐                     │                   │
│         ▼                         ▼                     ▼                   │
│  ┌──────────────┐         ┌──────────────┐       ┌──────────────┐           │
│  │   WhatsApp   │         │  Telegram /  │       │ Suppression  │           │
│  │ (QR/Pairing) │         │   Discord    │       │ Session/Keys │           │
│  └──────┬───────┘         └──────┬───────┘       └──────┬───────┘           │
└─────────┼────────────────────────┼──────────────────────┼───────────────────┘
          │                        │                      │
          ▼                        ▼                      ▼
┌──────────────────┐     ┌──────────────────┐   ┌──────────────────┐
│ Handshake Noise  │     │ Validation HTTP  │   │ Nettoyage disque │
│ + Code 8 chiffres│     │ Réseau en direct │   │ .env & session/  │
└──────────────────┘     └──────────────────┘   └──────────────────┘
```

### Séquence de Jumelage WhatsApp par Code à 8 Chiffres

```
Utilisateur                        CLI (whatsappAuthHelper)          Serveurs WhatsApp
    │                                         │                              │
    ├─ Saisie du numéro (ex. 33612345678) ───>│                              │
    │                                         ├─ makeWASocket()             │
    │                                         │<──── WebSocket Ouvert ───────┤
    │                                         │                              │
    │                                         │ [Attente bloquante 3 000 ms] │
    │                                         │ [Stabilisation session Noise]│
    │                                         │                              │
    │                                         ├─ requestPairingCode(phone) ─>│
    │                                         │<─── Code "ABC12345" ─────────┤
    │<─ Affiche "ABC1-2345" dans console ────┤                              │
    │                                         │                              │
    │ [Saisie du code sur le smartphone]      │                              │
    │                                         │<─── creds.update (registered)┤
    │                                         │<─── Connexion fermée (515) ──┤
    │                                         │ [Reconnexion automatique 1.5s]
    │                                         ├─ makeWASocket() ────────────>│
    │                                         │<─── connection === 'open' ───┤
    │<─ Notification de succès ───────────────┤                              │
```

---

## 3. Choix de Conception & Raisons d'Ingénierie

### 3.1. Délai de Stabilisation Noise de 3 000 ms
Lors du jumelage WhatsApp sans QR code, la socket WebSocket s'ouvre avant que le chiffrement de bout en bout Noise ne soit entièrement négocié. L'envoi immédiat de la requête `requestPairingCode` provoque un rejet silencieux de l'API WhatsApp. L'application d'un délai fixe de **3 000 ms** après création du socket garantit la stabilisation du canal chiffré avant l'émission de la requête d'association.

### 3.2. Gestion du Redémarrage Statut 515 (*Restart Required*)
Dès qu'un code d'association est validé sur le smartphone, WhatsApp met à jour l'état `registered: true` puis ferme immédiatement la connexion avec le statut `515 (restartRequired)`. `whatsappAuthHelper` intercepte spécifiquement ce statut pour réinstancier le socket après 1 500 ms, finalisant l'authentification au lieu de considérer la fermeture comme une erreur.

### 3.3. Protection Anti-Injection CRLF dans le `.env`
Pour empêcher toute corruption accidentelle ou injection malveillante lors de la mise à jour du fichier `.env`, la fonction `sanitizeEnvString()` filtre systématiquement les caractères `\r` et `\n`, garantissant qu'une valeur de jeton ne peut pas définir subrepticieusement de nouvelles variables d'environnement.

### 3.4. Détection et Contournement Automatique (*Headless Bypass*)
Le menu interactif détecte automatiquement les environnements non interactifs (`!process.stdout.isTTY`, `CI=true`, `HEADLESS=true`). Dans ces contextes, l'affichage interactif est immédiatement contourné pour permettre le démarrage automatisé des conteneurs ou des suites de tests.

---

## 4. Analyse Comparative & Alternatives Écartées

| Approche Évaluée | Avantages Théoriques | Inconvénients & Raisons du Rejet par HIVE-MIND |
| :--- | :--- | :--- |
| **Édition Manuelle du `.env` Uniquement** | Zéro ligne de code CLI à maintenir. | Taux d'erreur élevé ; impossible de jumeler WhatsApp sans outil externe ; crash au runtime en cas de token invalide. |
| **Dashboard Web d'Onboarding Embarqué** | Interface graphique agréable. | Nécessite le lancement d'un serveur HTTP complet avant le boot de l'agent ; consommation inutile de mémoire ; vulnérabilités réseau sur VPS public. |
| **Crash Direct au Runtime sans Vérification** | Simplicité d'implémentation. | Mauvaise expérience développeur ; boucle de redémarrage infinie dans les orchestrateurs Docker/Kubernetes. |
| **Assistant CLI Pré-Boot avec Validation Réseau Directe (Retenue)** | Zéro dépendance lourde ; validation instantanée avant tout chargement mémoire ; jumelage WhatsApp résilient ; contournement automatique en CI. | Nécessite un terminal TTY pour la saisie interactive initiale. |

---

## 5. Frontières Architecturales & Invariants

### Ce qui est DANS le périmètre de SS-17 :
- Le menu TTY interactif, le décompte interrompable et le panneau de statut des comptes.
- La vérification HTTP fermée des jetons Discord et Telegram avec timeout de 8 secondes.
- La gestion complète du cycle d'onboarding WhatsApp (QR et code d'association Noise).
- La lecture, mise à jour et suppression atomique des variables dans `.env` et `process.env`.
- La purge des répertoires de session locaux (`session/`).

### Ce qui est STRICTEMENT EXCLU de SS-17 :
- La gestion active des sockets de messagerie en régime de croisière (déléguée à `SS-15`).
- L'instanciation des services du conteneur IoC (qui n'intervient qu'après la fin de `runStartupMenu`).
- Le traitement des commandes de l'agent ou de la TUI.

### Invariants :
1. **Validation Stricte de Session WhatsApp** : `isWhatsAppConnected()` exige strictement `registered === true` ET la présence d'un identifiant `me.id` valide dans `creds.json` pour éviter tout faux positif pendant la phase intermédiaire de couplage.
2. **Isolation Pré-Boot** : En cas d'annulation par l'utilisateur (`Ctrl+C`), le processus se termine immédiatement (`process.exit(0)`) sans laisser de socket orpheline ou de fichier temporaire corrompu.

---

## 6. Liens & Navigation

- **Référence Technique :** [`cli-auth-wizard-reference.md`](./cli-auth-wizard-reference.md)
- **Guide Pratique d'Intégration :** [`cli-auth-wizard-howto.md`](./cli-auth-wizard-howto.md)
- **Index du Domaine :** [`index.md`](./index.md)
- **Index Général :** [`../00_index.md`](../00_index.md)
