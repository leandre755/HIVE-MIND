import { resolve as resolvePath } from 'node:path';
import {
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  Browsers,
  delay,
  type WASocket,
  type ConnectionState,
  type AuthenticationState,
} from '@whiskeysockets/baileys';
import createPinoLogger from 'pino';
import qrcode from 'qrcode-terminal';
import promptsPkg from 'prompts';
import { disconnectWhatsApp } from './authSessionManager.js';
import { safeMkdirSync } from '../utils/safeFs.js';

const prompts = promptsPkg;

const WA_SESSION_DIR = resolvePath(process.cwd(), 'session');

export type WhatsAppAuthMode = 'qr' | 'pairing';

interface BoomErrorPayload {
  output?: {
    statusCode?: number;
  };
}

/** Options globales pour les prompts WhatsApp afin de fermer le CLI proprement sur Ctrl+C */
const PROMPT_OPTIONS = {
  onCancel: () => {
    console.log("\n👋 Annulation par l'utilisateur. Fermeture...");
    process.exit(0);
  },
};

/**
 * Demande le numéro de téléphone à l'utilisateur de manière synchrone avant l'initialisation du socket.
 */
async function promptForPhoneNumber(): Promise<string | null> {
  try {
    const response = await prompts(
      {
        type: 'text',
        name: 'phoneNumber',
        message:
          'Entrez votre numéro de téléphone (au format international sans +, ex: 33612345678):',
        validate: (val: string) =>
          /^\d{8,15}$/.test(val.replace(/\D/g, ''))
            ? true
            : 'Veuillez entrer un numéro valide composé de 8 à 15 chiffres.',
      },
      PROMPT_OPTIONS,
    );

    const cleanPhone = (response.phoneNumber || '').replace(/\D/g, '');
    if (!cleanPhone) {
      console.log('⚠️ Numéro invalide.');
      return null;
    }
    return cleanPhone;
  } catch (err) {
    console.error('❌ Erreur lors de la saisie du numéro de téléphone:', err);
    return null;
  }
}

/**
 * Obtient le code de couplage auprès de WhatsApp une fois le handshake Noise complété.
 *
 * Applique un délai fixe de 3000ms après création du socket (pattern Toxic-MD pair.js:99-100)
 * pour laisser le WebSocket ET le handshake de chiffrement Noise se compléter avant d'envoyer
 * l'IQ 'link_code_companion_reg'. Un envoi prématuré (sur un canal non encore chiffré) est
 * rejeté silencieusement par WhatsApp et aucune notification push n'atteint le téléphone.
 */
async function executePairingRequest(sock: WASocket, cleanPhone: string): Promise<boolean> {
  try {
    console.log(`\n⏳ Demande du code de couplage pour ${cleanPhone}...`);
    await delay(3000);

    const code = await sock.requestPairingCode(cleanPhone);
    if (!code) {
      throw new Error("Aucun code retourné par l'API WhatsApp");
    }

    const formattedCode = code.match(/.{1,4}/g)?.join('-') || code;
    console.log(`\n🔑 VOTRE CODE DE COUPLAGE WHATSAPP: \x1b[1;\x1b[32m${formattedCode}\x1b[0m\n`);
    console.log(
      'Ouvrez WhatsApp sur votre téléphone > Appareils connectés > Connecter un appareil > Se connecter avec un code.',
    );
    console.log(
      '⏳ En attente de la saisie et validation du code sur votre téléphone (délai max 2 minutes)...\n',
    );
    return true;
  } catch (err) {
    console.error(
      '❌ Échec de la demande du code de couplage:',
      err instanceof Error ? err.message : String(err),
    );
    return false;
  }
}

/**
 * Gère la fermeture de connexion intermédiaire et les reconnexions transitoires.
 */
function handleConnectionClose(
  lastDisconnect: Partial<ConnectionState>['lastDisconnect'],
  pairingRequested: boolean,
  isRegistered: boolean,
  isFinished: boolean,
  onReconnect: () => void,
  onFail: () => void,
): void {
  const err = lastDisconnect?.error as BoomErrorPayload | undefined;
  const statusCode = err?.output?.statusCode;

  if (isFinished) return;

  if (statusCode === DisconnectReason.loggedOut) {
    console.log('❌ WhatsApp déconnecté ou session révoquée.');
    onFail();
    return;
  }

  // Cas nominal du succès de pairing : dès que le code est validé sur le
  // téléphone, `creds.update` passe `registered` à true, PUIS WhatsApp ferme la
  // connexion avec le statut 515 (restartRequired). C'est un restart attendu :
  // le socket DOIT être recréé pour finaliser la session authentifiée. Sans
  // cette reconnexion, on attend un `connection === 'open'` qui n'arrive jamais
  // et l'authentification tourne jusqu'au timeout ("impossible de se connecter").
  if (isRegistered) {
    console.log('🔄 Finalisation de la session authentifiée...');
    setTimeout(onReconnect, 1500);
    return;
  }

  // Reconnexions intermédiaires transitoires pendant l'attente de saisie du code.
  if (pairingRequested) {
    console.log('🔄 Reconnexion intermédiaire au réseau WhatsApp...');
    setTimeout(onReconnect, 1500);
    return;
  }

  onFail();
}

interface SocketContext {
  mode: WhatsAppAuthMode;
  isRegisteredLive: () => boolean;
  pairingState: { requested: boolean };
  isFinishedLive: () => boolean;
  finish: (result: boolean) => void;
  reconnect: () => void;
}

function processConnectionUpdate(update: Partial<ConnectionState>, ctx: SocketContext): void {
  const { connection, lastDisconnect, qr } = update;

  if (qr && ctx.mode === 'qr') {
    console.log('\n📱 Scannez ce QR Code avec WhatsApp sur votre téléphone:\n');
    qrcode.generate(qr, { small: true });
  }

  if (connection === 'open' && ctx.isRegisteredLive()) {
    console.log('\n✅ WhatsApp connecté et authentifié avec succès !\n');
    ctx.finish(true);
    return;
  }

  if (connection === 'close') {
    handleConnectionClose(
      lastDisconnect,
      ctx.pairingState.requested,
      ctx.isRegisteredLive(),
      ctx.isFinishedLive(),
      ctx.reconnect,
      () => ctx.finish(false),
    );
  }
}

/**
 * Traite le cycle complet d'authentification WhatsApp avec reconnexion automatique
 * et attente effective de la confirmation par téléphone.
 */
export async function authenticateWhatsApp(mode: WhatsAppAuthMode): Promise<boolean> {
  let cleanPhone = '';

  if (mode === 'pairing') {
    const phoneInput = await promptForPhoneNumber();
    if (!phoneInput) {
      return false;
    }
    cleanPhone = phoneInput;
  }

  console.log("\n[WhatsApp] Initialisation de l'authentification...\n");

  let state: AuthenticationState | undefined;

  try {
    safeMkdirSync(WA_SESSION_DIR, { recursive: true });
    const authResult = await useMultiFileAuthState(WA_SESSION_DIR);
    state = authResult.state;
    const { saveCreds } = authResult;

    const { version } = await fetchLatestBaileysVersion();
    const logger = createPinoLogger({ level: 'silent' });

    const authState = state;

    return await new Promise<boolean>((resolvePromise) => {
      let isFinished = false;
      let activeSocket: WASocket | null = null;
      const pairingState = { requested: false };

      const finish = (result: boolean) => {
        if (isFinished) return;
        isFinished = true;
        clearTimeout(globalTimer);

        if (activeSocket) {
          try {
            activeSocket.ev.removeAllListeners('creds.update');
            activeSocket.ev.removeAllListeners('connection.update');
            activeSocket.end(undefined);
          } catch {
            // Ignore socket cleanup error
          }
        }

        const finalize = async () => {
          // En cas de succès, on force le flush disque des creds (incluant me.id)
          // AVANT de résoudre : le menu relit creds.json immédiatement au retour et
          // les derniers `creds.update` sont persistés de façon asynchrone. Sans ce
          // flush explicite, isWhatsAppConnected() peut lire un creds.json incomplet
          // et afficher un faux "DÉCONNECTÉ" alors que la session est valide.
          if (result) {
            try {
              await saveCreds();
            } catch {
              // Ignore save error : le fichier peut déjà être écrit par le listener
            }
          } else if (!authState.creds.registered) {
            disconnectWhatsApp();
          }
          resolvePromise(result);
        };

        void finalize();
      };

      const globalTimer = setTimeout(() => {
        console.error("\n❌ Temps d'attente dépassé (2 minutes). Authentification annulée.\n");
        finish(false);
      }, 120000);

      const startSock = () => {
        if (isFinished) return;

        const sock = makeWASocket({
          version,
          logger,
          auth: authState,
          printQRInTerminal: false,
          browser: Browsers.ubuntu('Chrome'),
        });
        activeSocket = sock;

        sock.ev.on('creds.update', saveCreds);

        const connectionContext: SocketContext = {
          mode,
          isRegisteredLive: () => Boolean(authState.creds.registered),
          pairingState,
          isFinishedLive: () => isFinished,
          finish,
          reconnect: startSock,
        };

        sock.ev.on('connection.update', (update: Partial<ConnectionState>) => {
          processConnectionUpdate(update, connectionContext);
        });

        if (mode === 'pairing' && !pairingState.requested && !authState.creds.registered) {
          pairingState.requested = true;
          void executePairingRequest(sock, cleanPhone).then((ok) => {
            if (!ok) finish(false);
          });
        }
      };

      startSock();
    });
  } catch (err) {
    console.error(
      "❌ Échec de l'initialisation WhatsApp:",
      err instanceof Error ? err.message : String(err),
    );
    if (!state || !state.creds.registered) {
      disconnectWhatsApp();
    }
    return false;
  }
}
