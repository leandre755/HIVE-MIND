import promptsPkg from 'prompts';
import {
  getAccountStatus,
  areAllAccountsConnected,
  disconnectWhatsApp,
  disconnectTelegram,
  disconnectDiscord,
  updateEnvVariable,
  verifyTelegramBotToken,
  verifyDiscordToken,
} from './authSessionManager.js';
import { authenticateWhatsApp } from './whatsappAuthHelper.js';

const prompts = promptsPkg;

/** Options globales pour tous les prompts afin de traiter Ctrl+C proprement par process.exit(0) */
const PROMPT_OPTIONS = {
  onCancel: () => {
    console.log("\n👋 Annulation par l'utilisateur. Fermeture...");
    process.exit(0);
  },
};

/**
 * Attend pendant un délai spécifié en ms avec possibilité d'interruption par une touche dans TTY.
 */
function waitWithInterruption(timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      setTimeout(() => resolve(false), timeoutMs);
      return;
    }

    const timer = setTimeout(() => {
      cleanup();
      resolve(false);
    }, timeoutMs);

    const onData = () => {
      cleanup();
      resolve(true);
    };

    const cleanup = () => {
      clearTimeout(timer);
      try {
        if (process.stdin.isRaw) {
          process.stdin.setRawMode(false);
        }
        process.stdin.removeListener('data', onData);
      } catch {
        // Ignore TTY cleanup errors
      }
    };

    try {
      if (process.stdin.setRawMode) {
        process.stdin.setRawMode(true);
      }
      process.stdin.resume();
      process.stdin.once('data', onData);
    } catch {
      cleanup();
      resolve(false);
    }
  });
}

/**
 * Affiche le sous-menu de connexion pour WhatsApp.
 */
async function handleConnectWhatsApp(): Promise<void> {
  const choice = await prompts(
    {
      type: 'select',
      name: 'method',
      message: 'Méthode de connexion WhatsApp:',
      choices: [
        { title: '1. Scanner un QR Code', value: 'qr' },
        { title: '2. Saisir le numéro de téléphone (Code à 8 chiffres)', value: 'pairing' },
        { title: '3. Retour', value: 'back' },
      ],
    },
    PROMPT_OPTIONS,
  );

  if (choice.method === 'qr' || choice.method === 'pairing') {
    await authenticateWhatsApp(choice.method);
  }
}

/**
 * Affiche le sous-menu de connexion pour Telegram.
 */
async function handleConnectTelegram(): Promise<void> {
  const choice = await prompts(
    {
      type: 'select',
      name: 'method',
      message: 'Méthode de connexion Telegram:',
      choices: [
        { title: '1. Token de Bot Telegram (TELEGRAM_BOT_TOKEN)', value: 'bot' },
        { title: '2. Session Compte Utilisateur (TELEGRAM_SESSION)', value: 'user' },
        { title: '3. Retour', value: 'back' },
      ],
    },
    PROMPT_OPTIONS,
  );

  if (choice.method === 'bot') {
    const input = await prompts(
      {
        type: 'text',
        name: 'token',
        message: 'Saisissez votre TELEGRAM_BOT_TOKEN:',
        validate: (val: string) => (val.trim().length > 10 ? true : 'Token invalide.'),
      },
      PROMPT_OPTIONS,
    );
    if (input.token) {
      console.log('\n⏳ Vérification du token auprès des serveurs Telegram...');
      const check = await verifyTelegramBotToken(input.token.trim());
      if (check.valid) {
        updateEnvVariable('TELEGRAM_BOT_TOKEN', input.token.trim());
        console.log(`✅ TELEGRAM_BOT_TOKEN vérifié et sauvegardé (${check.username}) !`);
      } else {
        console.error(
          `❌ Échec de vérification Telegram: ${check.error || 'Token non valide'}. non sauvegardé.`,
        );
      }
    }
  } else if (choice.method === 'user') {
    const input = await prompts(
      {
        type: 'text',
        name: 'session',
        message: 'Saisissez votre chaîne TELEGRAM_SESSION GramJS:',
        validate: (val: string) => (val.trim().length > 10 ? true : 'Session invalide.'),
      },
      PROMPT_OPTIONS,
    );
    if (input.session) {
      updateEnvVariable('TELEGRAM_SESSION', input.session.trim());
      console.log('✅ TELEGRAM_SESSION sauvegardée dans .env !');
    }
  }
}

/**
 * Affiche le sous-menu de connexion pour Discord.
 */
async function handleConnectDiscord(): Promise<void> {
  const input = await prompts(
    {
      type: 'text',
      name: 'token',
      message: 'Saisissez votre jeton Utilisateur Discord (DISCORD_TOKEN):',
      validate: (val: string) => (val.trim().length > 20 ? true : 'Token Discord invalide.'),
    },
    PROMPT_OPTIONS,
  );

  if (input.token) {
    console.log('\n⏳ Vérification du jeton auprès des serveurs Discord...');
    const check = await verifyDiscordToken(input.token.trim());
    if (check.valid) {
      updateEnvVariable('DISCORD_TOKEN', input.token.trim());
      console.log(`✅ DISCORD_TOKEN vérifié et sauvegardé (${check.username}) !`);
    } else {
      console.error(
        `❌ Échec de vérification Discord: ${check.error || 'Jeton non autorisé'}. non sauvegardé.`,
      );
    }
  }
}

/**
 * Affiche le sous-menu "Connecter un compte".
 */
async function handleConnectMenu(): Promise<void> {
  const status = getAccountStatus();
  const choice = await prompts(
    {
      type: 'select',
      name: 'network',
      message: 'Choisissez le réseau à connecter:',
      choices: [
        {
          title: `1. WhatsApp ${status.whatsapp ? '(🟢 Connecté)' : '(🔴 Non connecté)'}`,
          value: 'whatsapp',
        },
        {
          title: `2. Telegram ${status.telegram ? '(🟢 Connecté)' : '(🔴 Non connecté)'}`,
          value: 'telegram',
        },
        {
          title: `3. Discord  ${status.discord ? '(🟢 Connecté)' : '(🔴 Non connecté)'}`,
          value: 'discord',
        },
        { title: '4. Retour au menu principal', value: 'back' },
      ],
    },
    PROMPT_OPTIONS,
  );

  switch (choice.network) {
    case 'whatsapp':
      await handleConnectWhatsApp();
      break;
    case 'telegram':
      await handleConnectTelegram();
      break;
    case 'discord':
      await handleConnectDiscord();
      break;
  }
}

/**
 * Affiche le sous-menu "Déconnecter un compte".
 */
async function handleDisconnectMenu(): Promise<void> {
  const status = getAccountStatus();
  const choice = await prompts(
    {
      type: 'select',
      name: 'network',
      message: 'Choisissez le réseau à déconnecter:',
      choices: [
        {
          title: `1. WhatsApp ${status.whatsapp ? '(🟢 Connecté)' : '(⚪ Non connecté)'}`,
          value: 'whatsapp',
          disabled: !status.whatsapp,
        },
        {
          title: `2. Telegram ${status.telegram ? '(🟢 Connecté)' : '(⚪ Non connecté)'}`,
          value: 'telegram',
          disabled: !status.telegram,
        },
        {
          title: `3. Discord  ${status.discord ? '(🟢 Connecté)' : '(⚪ Non connecté)'}`,
          value: 'discord',
          disabled: !status.discord,
        },
        { title: '4. Retour au menu principal', value: 'back' },
      ],
    },
    PROMPT_OPTIONS,
  );

  if (choice.network === 'whatsapp') {
    disconnectWhatsApp();
    console.log('🗑️ Session WhatsApp supprimée.');
  } else if (choice.network === 'telegram') {
    disconnectTelegram();
    console.log('🗑️ Identifiants Telegram supprimés du .env.');
  } else if (choice.network === 'discord') {
    disconnectDiscord();
    console.log('🗑️ Token Discord supprimé du .env.');
  }
}

/**
 * Affiche le panneau du statut des comptes dans le terminal.
 */
/** Formate une ligne de statut réseau alignée sur une largeur fixe. */
function formatStatusLine(label: string, connected: boolean): string {
  const state = connected ? '🟢 Connecté' : '🔴 Déconnecté';
  return `│  ${label.padEnd(9)}${state.padEnd(14)}│`;
}

function renderStatusPanel(): void {
  const status = getAccountStatus();
  console.log('\n┌──────────────────────────┐');
  console.log('│        🤖 HIVE-MIND       │');
  console.log('├──────────────────────────┤');
  console.log(formatStatusLine('WhatsApp', status.whatsapp));
  console.log(formatStatusLine('Telegram', status.telegram));
  console.log(formatStatusLine('Discord', status.discord));
  console.log('└──────────────────────────┘\n');
}

/**
 * Vérifie si le menu doit être skippé automatiquement.
 */
async function checkShouldAutoSkip(): Promise<boolean> {
  const isHeadless =
    !process.stdout.isTTY ||
    !process.stdin.isTTY ||
    process.env.CI === 'true' ||
    process.env.HEADLESS === 'true';

  if (isHeadless) return true;

  if (areAllAccountsConnected()) {
    console.log('\n==================================================');
    console.log('🟢 HIVE-MIND: Tous les comptes supportés sont connectés.');
    console.log(
      "⏩ Passage automatique dans 2s... (Pressez n'importe quelle touche pour ouvrir le menu)",
    );
    console.log('==================================================\n');

    const interrupted = await waitWithInterruption(2000);
    if (!interrupted) return true;
  }

  return false;
}

/**
 * Traite une itération du menu principal.
 */
async function processMainMenuStep(): Promise<boolean> {
  renderStatusPanel();

  const mainChoice = await prompts(
    {
      type: 'select',
      name: 'action',
      message: 'Menu principal :',
      choices: [
        { title: '1. Connecter un compte', value: 'connect' },
        { title: '2. Déconnecter un compte', value: 'disconnect' },
        { title: '3. Continuer (Skip)', value: 'skip' },
      ],
    },
    PROMPT_OPTIONS,
  );

  if (!mainChoice || typeof mainChoice.action === 'undefined') {
    process.exit(0);
  }

  if (mainChoice.action === 'skip') {
    console.log('\n🚀 Lancement des services HIVE-MIND...\n');
    return false;
  }

  if (mainChoice.action === 'connect') {
    await handleConnectMenu();
  } else if (mainChoice.action === 'disconnect') {
    await handleDisconnectMenu();
  }

  return true;
}

/**
 * Lance le menu d'options UX de démarrage HIVE-MIND.
 */
export async function runStartupMenu(): Promise<void> {
  const skip = await checkShouldAutoSkip();
  if (skip) return;

  let keepRunning = true;
  while (keepRunning) {
    keepRunning = await processMainMenuStep();
  }
}
