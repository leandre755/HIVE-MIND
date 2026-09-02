# SS-17 : CLI Interactive Auth Wizard & Multi-Account Session Manager — Référence Technique

Ce document constitue la référence d'API autoritaire pour le sous-système **SS-17** (`CLI Interactive Auth Wizard & Multi-Account Session Manager`), détaillant les modules d'authentification interactive, de validation réseau et de gestion des fichiers d'environnement.

- **Fichiers sources :** `src/cli/authSessionManager.ts`, `src/cli/startupMenu.ts`, `src/cli/whatsappAuthHelper.ts`
- **Dépendances directes :** `prompts`, `qrcode-terminal`, `@whiskeysockets/baileys`, `pino`, `src/utils/safeFs.ts`

---

## 1. Interfaces & Types TypeScript

### Types de Statut et de Diagnostic (`src/cli/authSessionManager.ts`)

```typescript
/** Statut de connexion des comptes de communication */
export interface AccountConnectionStatus {
  whatsapp: boolean;
  telegram: boolean;
  discord: boolean;
}

/** Résultat de la vérification réseau d'un jeton d'API */
export interface VerificationResult {
  valid: boolean;
  username?: string;
  error?: string;
}
```

### Types d'Authentification WhatsApp (`src/cli/whatsappAuthHelper.ts`)

```typescript
/** Modes d'authentification WhatsApp supportés */
export type WhatsAppAuthMode = 'qr' | 'pairing';

/** Structure de l'erreur Boom issue de Baileys */
export interface BoomErrorPayload {
  output?: {
    statusCode?: number;
  };
}
```

---

## 2. Fonctions & Signatures de Méthodes

### Module `authSessionManager.ts`

#### `updateEnvVariable(rawKey: string, rawValue: string | null): void`
Met à jour ou supprime une variable d'environnement dans le fichier `.env` local et synchronise `process.env`.
- **Paramètres :**
  - `rawKey` (`string`) : Nom de la clé d'environnement.
  - `rawValue` (`string | null`) : Valeur à assigner, ou `null` pour supprimer la ligne du fichier.
- **Sécurité :** Filtre automatiquement les sauts de ligne (`\r`, `\n`) dans la clé et la valeur via `sanitizeEnvString()`.

#### `verifyTelegramBotToken(token: string): Promise<VerificationResult>`
Effectue une requête HTTP `GET` vers `https://api.telegram.org/bot<TOKEN>/getMe` avec un timeout de 8 000 ms (`AbortSignal.timeout(8000)`).
- **Retour :** `{ valid: true, username: "@NomDuBot" }` si le statut HTTP est 200 et `data.ok === true`, sinon `{ valid: false, error: string }`.

#### `verifyDiscordToken(token: string): Promise<VerificationResult>`
Effectue une requête HTTP `GET` vers `https://discord.com/api/v9/users/@me` avec le header `Authorization: <token>` et un timeout de 8 000 ms.
- **Retour :** `{ valid: true, username: "Username#0000" }` si le jeton est valide, sinon `{ valid: false, error: string }`.

#### `isWhatsAppConnected(): boolean`
Vérifie la présence du fichier `session/creds.json` et s'assure que `registered === true` et `me.id` sont définis.

#### `isTelegramConnected(): boolean`
Vérifie si `TELEGRAM_BOT_TOKEN` ou `TELEGRAM_SESSION` est défini et non vide dans `.env` ou `process.env`.

#### `isDiscordConnected(): boolean`
Vérifie si `DISCORD_TOKEN` est défini et non vide.

#### `getAccountStatus(): AccountConnectionStatus`
Retourne un objet synthétique indiquant l'état de connexion de chaque canal.

#### `areAllAccountsConnected(): boolean`
Retourne `true` si et seulement si WhatsApp, Telegram et Discord sont tous connectés.

#### Fonctions de Déconnexion
- `disconnectWhatsApp(): void` : Supprime récursivement le dossier `session/` via `safeRemoveDirectorySync`.
- `disconnectTelegram(): void` : Supprime `TELEGRAM_BOT_TOKEN` et `TELEGRAM_SESSION` de `.env` et `process.env`.
- `disconnectDiscord(): void` : Supprime `DISCORD_TOKEN` de `.env` et `process.env`.

---

### Module `startupMenu.ts`

#### `runStartupMenu(): Promise<void>`
Point d'entrée du menu interactif de démarrage.
- Vérifie si le mode headless ou CI est actif (`checkShouldAutoSkip`).
- Si tous les comptes sont connectés, lance un compte à rebours de 2 000 ms interrompable par n'importe quelle frappe clavier.
- Affiche la boucle interactive `prompts` permettant de connecter ou déconnecter des comptes.

---

### Module `whatsappAuthHelper.ts`

#### `authenticateWhatsApp(mode: WhatsAppAuthMode): Promise<boolean>`
Gère le processus complet d'authentification WhatsApp.
- **Paramètres :**
  - `mode` (`'qr'` | `'pairing'`) : Mode d'authentification par scan de QR code ou par saisie de numéro international.
- **Fonctionnement :**
  - Initialise le socket Baileys avec `useMultiFileAuthState(WA_SESSION_DIR)`.
  - En mode `pairing`, applique un délai de 3 000 ms pour stabiliser le handshake Noise, puis invoque `sock.requestPairingCode(phone)`.
  - Gère les reconnexions automatiques en cas de statut 515 (*restartRequired*) après validation sur smartphone.
  - Sauvegarde de force les identifiants via `saveCreds()` avant de résoudre la promesse avec `true`.
  - Annule le processus avec `false` après un délai global d'inactivité de 120 000 ms (2 minutes).

---

## 3. Schéma de Configuration & Variables d'Environnement

| Variable d'Environnement | Type | Description |
| :--- | :--- | :--- |
| `TELEGRAM_BOT_TOKEN` | `string` | Jeton d'authentification du Bot Telegram. |
| `TELEGRAM_SESSION` | `string` | Chaîne de session GramJS sérialisée. |
| `DISCORD_TOKEN` | `string` | Jeton utilisateur Discord. |
| `CI` | `string` | Si `'true'`, contourne immédiatement l'affichage interactif. |
| `HEADLESS` | `string` | Si `'true'`, force le mode non-interactif. |

---

## 4. Codes de Statut Réseau & Diagnostics

| Étape / Réseau | Code / Réponse | Diagnostic |
| :--- | :--- | :--- |
| **Telegram API** | HTTP `200` + `{ ok: true }` | Jeton valide et opérationnel. |
| **Telegram API** | HTTP `401` / `404` | Format de jeton invalide ou révoqué. |
| **Discord API** | HTTP `200` + `{ id: "..." }` | Jeton autorisé. |
| **Discord API** | HTTP `401` | Jeton Discord non autorisé ou expiré. |
| **Baileys WebSocket** | Statut `515` (*restartRequired*) | Jumelage validé sur le téléphone ; reconnexion automatique nécessaire pour finaliser la session. |
| **Baileys WebSocket** | `DisconnectReason.loggedOut` (`401`) | Session révoquée ou déconnectée manuellement depuis WhatsApp. |

---

## 5. Exemple d'Utilisation Minimal

```typescript
import {
  verifyTelegramBotToken,
  updateEnvVariable,
  getAccountStatus,
} from '../../src/cli/authSessionManager.js';

// 1. Valider un jeton Telegram auprès des serveurs
const token = '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ';
const check = await verifyTelegramBotToken(token);

if (check.valid) {
  console.log(`Jeton validé avec succès pour le bot ${check.username}`);
  // 2. Persister dans .env de manière sécurisée
  updateEnvVariable('TELEGRAM_BOT_TOKEN', token);
} else {
  console.error(`Échec de vérification : ${check.error}`);
}

// 3. Consulter le statut global
const status = getAccountStatus();
console.log('Statut des comptes :', status);
```

---

## 6. Limitations & Invariants Opérationnels

- **Concurrence & Verrouillage :** L'authentification interactive est conçue pour une exécution séquentielle mono-thread au démarrage de l'application.
- **Délai Maximal WhatsApp :** Le processus d'association WhatsApp est limité à 120 secondes par sécurité.
- **Sanctuarisation des Identifiants :** Les jetons et sessions sont stockés localement sur le disque dans `.env` et `session/` et sont exclus du suivi Git par `.gitignore`.
