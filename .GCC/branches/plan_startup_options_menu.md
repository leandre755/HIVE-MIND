# Execution Plan: Startup Options Menu (UX CLI)

## 📋 Target Invariant & Pre-requisites

- **Target Invariant**: Aucun log ni message de démarrage de `botCore` ne doit s'afficher avant la validation ou le Skip du menu d'options CLI. La détection des comptes connectés doit être passive et sans effets de bord réseau. Toutes les actions du menu (connexion/déconnexion WhatsApp, Telegram, Discord) doivent mettre à jour l'état de session ou le fichier `.env` de façon atomique et persister correctement.
- **Pre-requisites**: `prompts` (présent dans `package.json`), `baileys` (pour QR et Pairing Code), `dotenv`/`safeFs`.

## 🛠️ Step-by-Step Sequence

### Step 1: Module de gestion des sessions et des identifiants (`src/cli/authSessionManager.ts`)

- [x] **Action**: Créer `src/cli/authSessionManager.ts` exposant :
  - `isWhatsAppConnected()`: vérifie l'existence de `session/creds.json`
  - `isTelegramConnected()`: vérifie la présence de `TELEGRAM_BOT_TOKEN` ou `TELEGRAM_SESSION` dans `.env` / `process.env`
  - `isDiscordConnected()`: vérifie la présence de `DISCORD_TOKEN` dans `.env` / `process.env`
  - `areAllAccountsConnected()`: vérifie si tous les transports configurés dans `ACTIVE_TRANSPORTS` (ou par défaut whatsapp, telegram, discord) sont connectés
  - `disconnectWhatsApp()`, `disconnectTelegram()`, `disconnectDiscord()`: suppression atomique des sessions/clés `.env`.
- [x] **Verify**: `npx tsc --noEmit`
- **Verification Proof**:

```text
npx tsc --noEmit: EXIT CODE 0 (Clean 0 errors)
```

### Step 2: Implémentation du Pairing Code & QR Code autonome WhatsApp (`src/cli/whatsappAuthHelper.ts`)

- [x] **Action**: Créer `src/cli/whatsappAuthHelper.ts` permettant l'authentification interactive WhatsApp :
  - Mode 1: QR Code affiché proprement dans le terminal avec attente de scan
  - Mode 2: Pairing Code (demande du numéro de téléphone international, appel de `requestPairingCode()`, affichage du code 8 chiffres, attente de confirmation).
- [x] **Verify**: `npx tsc --noEmit`
- **Verification Proof**:

```text
npx tsc --noEmit: EXIT CODE 0 (Clean 0 errors)
```

### Step 3: Implémentation de l'arborescence du Menu CLI (`src/cli/startupMenu.ts`)

- [x] **Action**: Créer `src/cli/startupMenu.ts` avec la boucle d'interaction `prompts` :
  - Menu principal: 1. Connecter un compte, 2. Déconnecter un compte, 3. Skip / Continuer.
  - Sous-menu Connexion: WhatsApp (QR Code / Saisir Numéro -> Code 8 chiffres), Telegram (Bot Token / User Session), Discord (User Token).
  - Sous-menu Déconnexion: Choix du compte à déconnecter.
  - Gestion du Skip automatique de 2 secondes avec possibilité de presser n'importe quelle touche pour interrompre.
- [x] **Verify**: `npx tsc --noEmit`
- **Verification Proof**:

```text
npx tsc --noEmit: EXIT CODE 0 (Clean 0 errors)
```

### Step 4: Branchement dans le point d'entrée principal CLI (`src/bin/hive-mind.ts`)

- [x] **Action**: Injecter `await runStartupMenu()` au début de la commande `start` dans `src/bin/hive-mind.ts` avant l'affichage du banner `🚀 Lancement de HIVE-MIND...` et `acquireLock()`.
- [x] **Verify**: `npx tsc --noEmit && npx eslint src/cli/ src/bin/hive-mind.ts`
- **Verification Proof**:

```text
npx tsc --noEmit: EXIT CODE 0 (Clean 0 errors)
npx eslint src/cli/ src/bin/hive-mind.ts: EXIT CODE 0 (Clean 0 errors, 0 warnings)
```

### Step 5: Tests unitaires & validation fonctionnelle (`src/tests/unit/cli/startupMenu.test.ts`)

- [x] **Action**: Créer la suite de tests unitaires simulant les sélections dans le menu CLI, la vérification des états de connexion, l'auto-skip et la déconnexion.
- [x] **Verify**: `NODE_OPTIONS='--experimental-vm-modules --no-warnings' npx jest src/tests/unit/cli/`
- **Verification Proof**:

```text
npx tsc --noEmit : EXIT CODE 0 (0 error)
npx eslint src/cli/ src/tests/unit/cli/ : EXIT CODE 0 (0 error, 0 warning)
Jest src/tests/unit/cli/startupMenu.test.ts : 6 passed, 6 total (EXIT CODE 0)
npm run test:unit : 64 passed, 64 total, 498 tests passed (EXIT CODE 0)
```

## ⚠️ Mitigations & Edge Cases

- **Risk**: En environnement Headless ou non-TTY (ex: Railway / Docker / CI), le menu `prompts` pourrait bloquer indéfiniment en attendant une saisie utilisateur.
- **Mitigation**: Détecter `process.stdout.isTTY` et `process.env.CI` / `APP_ENV === 'production'`. Si non-TTY ou CI/Prod headless, le menu s'auto-skippe immédiatement sans bloquer le processus.
- **Risk**: Logs parasites émis par Baileys ou d'autres modules pendant l'affichage du QR Code ou du Pairing Code.
- **Mitigation**: Utiliser un logger Baileys en niveau `'silent'` ou `'error'` pendant la phase d'authentification interactive dans le menu CLI.
