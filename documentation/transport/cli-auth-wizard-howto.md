# Comment Configurer et Authentifier les Canaux Multi-Comptes via l'Assistant CLI Interactif

Ce guide pratique détaille la procédure pour initialiser, configurer et tester l'ensemble des comptes de messagerie (WhatsApp, Telegram, Discord) à l'aide du menu interactif CLI et des utilitaires de gestion de session.

---

## Prérequis

- Node.js >= 22 (ESM natif).
- Terminal interactif TTY.
- Numéro de téléphone pour WhatsApp, jeton de bot Telegram ou jeton utilisateur Discord.

---

## Étapes de Réalisation

### 1. Lancer le Menu d'Options de Démarrage

Exécutez le script d'entrée CLI ou invoquez `runStartupMenu()` au point d'entrée de votre application :

```typescript
// src/scripts/auth.ts
import { runStartupMenu } from '../cli/startupMenu.js';

console.log('Démarrage de l\'assistant de configuration des comptes...');
await runStartupMenu();
console.log('Configuration terminée. Prêt pour le démarrage du démon.');
```

À l'écran, le panneau de statut récapitule l'état actuel de chaque canal :
```text
┌──────────────────────────┐
│        🤖 HIVE-MIND       │
├──────────────────────────┤
│  WhatsApp 🔴 Déconnecté  │
│  Telegram 🟢 Connecté    │
│  Discord  🔴 Déconnecté  │
└──────────────────────────┘
```

---

### 2. Authentifier un Compte WhatsApp

Dans le menu, sélectionnez `1. Connecter un compte` puis `1. WhatsApp` :

#### Option A : Jumelage par Code à 8 Chiffres (Recommandé sur VPS / Docker)
1. Choisissez l'option `2. Saisir le numéro de téléphone (Code à 8 chiffres)`.
2. Saisissez votre numéro au format international (ex. `33612345678`).
3. Le terminal affiche votre code formaté : `🔑 VOTRE CODE DE COUPLAGE WHATSAPP: 1234-5678`.
4. Ouvrez WhatsApp sur votre téléphone > **Appareils connectés** > **Connecter un appareil** > **Se connecter avec un code** et entrez la combinaison.
5. Le CLI détecte la validation, redémarre la socket et confirme la sauvegarde de `session/creds.json`.

#### Option B : Scan de QR Code
1. Choisissez l'option `1. Scanner un QR Code`.
2. Scannez le QR code affiché en mode texte dans la console à l'aide de l'application WhatsApp.

---

### 3. Valider et Sauvegarder un Jeton Telegram

1. Dans le menu, sélectionnez `1. Connecter un compte` puis `2. Telegram`.
2. Choisissez `1. Token de Bot Telegram (TELEGRAM_BOT_TOKEN)`.
3. Saisissez le jeton obtenu auprès de `@BotFather`.
4. L'assistant interroge immédiatement l'API Telegram en direct :
   ```text
   ⏳ Vérification du token auprès des serveurs Telegram...
   ✅ TELEGRAM_BOT_TOKEN vérifié et sauvegardé (@MonBotTelegram) !
   ```
5. La variable est inscrite de manière sécurisée dans `.env`.

---

### 4. Valider et Sauvegarder un Jeton Discord

1. Dans le menu, sélectionnez `1. Connecter un compte` puis `3. Discord`.
2. Collez votre jeton utilisateur Discord.
3. L'assistant effectue une requête de vérification auprès de `discord.com/api/v9/users/@me`.
4. En cas de succès, la clé `DISCORD_TOKEN` est enregistrée dans le fichier `.env`.

---

### 5. Déconnecter ou Réinitialiser un Compte

Pour révoquer une session ou supprimer une clé :
1. Dans le menu principal, sélectionnez `2. Déconnecter un compte`.
2. Choisissez le canal à désactiver.
3. Le gestionnaire supprime le dossier `session/` (pour WhatsApp) ou retire la ligne correspondante dans `.env` (pour Discord et Telegram).

---

## Cas Particuliers & Variantes

### Variante A : Automatisation en Environnement CI / Non-Interactif

Pour démarrer HIVE-MIND sans interruption interactive dans un conteneur ou une pipeline de test, exportez la variable `HEADLESS=true` ou `CI=true` :

```bash
CI=true node build/index.js
```

Le menu détecte l'environnement non-TTY et passe immédiatement à l'initialisation du démon sans bloquer.

---

## Vérification & Validation

Validez le bon fonctionnement du gestionnaire de sessions, de l'assainissement `.env` et du comportement d'auto-skip à l'aide de la suite de tests unitaires dédiée :

```bash
npx jest src/tests/unit/cli/startupMenu.test.ts --runInBand
```

Résultat attendu dans le terminal :
```text
PASS src/tests/unit/cli/startupMenu.test.ts
  Startup Options Menu CLI & Session Manager
    authSessionManager
      ✓ should correctly evaluate account status (2 ms)
      ✓ should evaluate areAllAccountsConnected correctly (1 ms)
      ✓ should update and remove env variables via updateEnvVariable (1 ms)
      ✓ should sanitize newlines in updateEnvVariable to prevent env injection (1 ms)
      ✓ should disconnect Telegram and Discord correctly (1 ms)
      ✓ should execute disconnectWhatsApp without throwing (1 ms)
    startupMenu auto-skip
      ✓ should skip immediately when running in CI or headless mode (2 ms)

Test Suites: 1 passed, 1 total
Tests:       7 passed, 7 total
Snapshots:   0 total
Time:        ...s
Ran all test suites matching /startupMenu/i.
```

---

## Guide de Dépannage (Troubleshooting)

| Symptôme / Message d'Erreur | Cause Probable | Solution Immédiate |
| :--- | :--- | :--- |
| `❌ Échec de la demande du code de couplage: rate-overlimit` | Trop de demandes de code d'association consécutives émises vers WhatsApp. | Attendre 15 à 30 minutes avant de réitérer ou utiliser le mode QR Code. |
| `❌ Échec de vérification Telegram: Erreur HTTP 401` | Le jeton de bot est mal orthographié ou a été révoqué auprès de `@BotFather`. | Régénérer un nouveau token avec `/token` dans `@BotFather` et le saisir à nouveau. |
| `❌ Échec de vérification Discord: Token non autorisé` | Le jeton utilisateur Discord a expiré ou le compte fait l'objet d'un verrouillage de sécurité. | Extraire un jeton actif depuis les en-têtes réseau du client Discord. |
| `⚠️ Numéro invalide` | Le numéro de téléphone contient le caractère `+` ou des espaces non supportés. | Saisir uniquement les chiffres au format international (ex. `33612345678` sans `+`). |
