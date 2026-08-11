import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  delay,
  proto,
} from '@whiskeysockets/baileys';
import createPinoLogger from 'pino';
import qrcode from 'qrcode-terminal';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import { Boom } from '@hapi/boom';
import { Command } from 'commander';
import {
  safeExistsSync,
  safeMkdirSync,
  safeWriteFileSync,
  safeAppendFile,
} from '../utils/safeFs.js';

// --- CONFIGURATION ---
const program = new Command();
program
  .option('-a, --account <type>', 'Account type (admin or user)', 'user')
  .option('-t, --target <jid>', 'Target bot JID (e.g. 123456789@s.whatsapp.net)')
  .option('--no-logs', 'Disable Railway logs streaming')
  .parse(process.argv);

const options = program.opts();

// Default target detection from local session
let defaultTarget = '2250704414707@s.whatsapp.net';
try {
  const creds = JSON.parse(fs.readFileSync('./session/creds.json', 'utf-8'));
  if (creds?.me?.id) {
    defaultTarget = creds.me.id.split(':')[0] + '@s.whatsapp.net';
  }
} catch {
  // pas de session locale — on garde la cible par défaut
}

const targetJID = options.target || defaultTarget;
const SESSION_BASE_PATH = './session_test_';
const accountType = options.account;
const sessionPath = path.join(process.cwd(), `${SESSION_BASE_PATH}${accountType}`);

if (!safeExistsSync(sessionPath)) {
  safeMkdirSync(sessionPath, { recursive: true });
}

// --- LOG FILTERING ---
const filterTerms = [
  'SessionEntry',
  'Decrypted message',
  'Closing open session',
  'Closing session',
  'registrationId',
  '<Buffer',
  'printQRInTerminal',
];

function shouldFilter(message: string) {
  if (message.includes('[TEST-RUNNER]') || message.includes('[RAILWAY]')) return false;
  return filterTerms.some((term) => message.includes(term));
}

// --- RAILWAY LOGS MANAGER ---
let railwayProcess: ChildProcess | null = null;

function startRailwayLogs() {
  if (options.noLogs) return;
  console.log('\n[TEST-RUNNER] 🛰️ Spawning Railway logs stream...');
  // 'railway logs' streams by default
  railwayProcess = spawn('/usr/local/bin/railway', ['logs'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PATH: '/usr/local/bin:/usr/bin:/bin' },
  });

  railwayProcess.stdout?.on('data', (data) => {
    const lines = data.toString().split('\n');
    for (const line of lines) {
      if (line.trim()) {
        console.log(`\x1b[2m[RAILWAY]\x1b[0m ${line}`);
      }
    }
  });

  railwayProcess.stderr?.on('data', (data) => {
    const lines = data.toString().split('\n');
    for (const line of lines) {
      if (line.trim()) {
        console.log(`\x1b[31m[RAILWAY-ERROR]\x1b[0m ${line}`);
      }
    }
  });

  railwayProcess.on('error', (err) => {
    console.log(`\x1b[31m[TEST-RUNNER] ❌ Failed to start Railway process:\x1b[0m ${err.message}`);
  });
}

function stopRailwayLogs() {
  if (railwayProcess) {
    console.log('[TEST-RUNNER] 🛑 Stopping Railway logs stream...');
    railwayProcess.kill();
    railwayProcess = null;
  }
}

// --- WHATSAPP CLIENT ---
async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    logger: createPinoLogger({ level: 'debug' }) as Parameters<typeof makeWASocket>[0]['logger'],
    browser: ['HIVE-MIND E2E Tester', 'Chrome', '1.0.0'],
  });

  sock.ev.on('creds.update', saveCreds);

  return new Promise<typeof sock>((resolve, reject) => {
    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr) {
        console.log(
          `\n[TEST-RUNNER] 📷 QR Code generated for account: \x1b[1m${accountType}\x1b[0m`,
        );
        qrcode.generate(qr, { small: true });
      }
      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
        if (statusCode !== DisconnectReason.loggedOut) {
          connectToWhatsApp().then(resolve).catch(reject);
        } else {
          reject(new Error('Logged out'));
        }
      } else if (connection === 'open') {
        console.log(
          `[TEST-RUNNER] ✅ Connected successfully as \x1b[32m${accountType}\x1b[0m (${sock.user?.id})`,
        );
        resolve(sock);
      }
    });
  });
}

// --- PROGRAMMATIC TEST UTILS ---

type WhatsAppSocket = Awaited<ReturnType<typeof connectToWhatsApp>>;

type IncomingWhatsAppMessage = proto.IWebMessageInfo;

function captureMessageText(msg: IncomingWhatsAppMessage): string {
  return msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
}

function captureReceivedFile(msg: IncomingWhatsAppMessage): string | null {
  const doc = msg.message?.documentMessage;
  if (doc) {
    console.log(`\n[TEST-RUNNER] 📥 Received document: ${doc.fileName || 'unknown'}`);
    return doc.fileName || 'document.pdf';
  }
  const img = msg.message?.imageMessage;
  if (img) {
    console.log('\n[TEST-RUNNER] 📥 Received image.');
    return 'image.jpeg';
  }
  return null;
}

async function sendAndWaitForResponse(
  sock: WhatsAppSocket,
  jid: string,
  content: string | Record<string, unknown>,
  expectedFiles: number,
  timeoutMs: number = 600000,
): Promise<{ text: string; files: string[] }> {
  console.log(
    `[TEST-RUNNER] 📤 Sending: ${typeof content === 'string' ? content : JSON.stringify(content)}`,
  );

  if (typeof content === 'string') {
    await sock.sendMessage(jid, { text: content });
  } else {
    await sock.sendMessage(jid, content as Parameters<typeof sock.sendMessage>[1]);
  }

  return new Promise((resolve) => {
    let allText = '';
    const receivedFiles: string[] = [];
    const messageListener = (upsert: { messages: proto.IWebMessageInfo[] }) => {
      for (const msg of upsert.messages) {
        if (msg.key.remoteJid !== jid || msg.key.fromMe) continue;
        const text = captureMessageText(msg);
        if (!shouldFilter(text) && text) {
          console.log(`\n[TEST-RUNNER] 📥 Received text:\n---\n${text}\n---`);
          allText += text + '\n\n';
        }
        const file = captureReceivedFile(msg);
        if (file) {
          receivedFiles.push(file);
        }
        if (receivedFiles.length >= expectedFiles) {
          console.log(
            `[TEST-RUNNER] ✅ Received all expected files (${expectedFiles}). Waiting 10s to ensure no trailing messages...`,
          );
          setTimeout(() => {
            clearTimeout(timeout);
            sock.ev.off('messages.upsert', messageListener);
            resolve({ text: allText, files: receivedFiles });
          }, 10000);
        }
      }
    };

    const timeout = setTimeout(() => {
      console.log('[TEST-RUNNER] ⚠️ Timeout reached for this test.');
      sock.ev.off('messages.upsert', messageListener);
      resolve({ text: allText, files: receivedFiles });
    }, timeoutMs);

    sock.ev.on('messages.upsert', messageListener);
  });
}

// --- MAIN TEST RUN ---

const TESTS = [
  {
    id: 1,
    title: "Recherche Web avec Captures d'Écran",
    prompt:
      "Va sur le site https://news.ycombinator.com, fais une capture d'écran de la page d'accueil et envoie-la moi. Ensuite, clique sur le premier article, fais une capture d'écran de l'article, et envoie-moi un résumé de son contenu avec les deux captures d'écran.",
    expectedFiles: 2,
  },
  {
    id: 2,
    title: 'Extraction de Données Structurées depuis un Site',
    prompt:
      "Rends-toi sur https://github.com/trending et fais une capture d'écran de la page. Ensuite, extrais les 5 premiers repos trending avec leur nom, leur description, le langage utilisé et le nombre d'étoiles. Formate tout ça dans un fichier markdown propre et envoie-le moi, avec la capture d'écran.",
    expectedFiles: 2,
  },
  {
    id: 3,
    title: "Installation d'un Outil et Conversion de Fichier",
    prompt:
      'J\'ai placé un fichier PDF dans ton espace de stockage (storage_hm/test_document.pdf). Installe la bibliothèque npm "pdf-parse" dans ton terminal, puis utilise-la pour extraire le texte du PDF et sauvegarde le résultat dans un fichier markdown "test_document.md" dans le même dossier. Envoie-moi le fichier MD résultant.',
    expectedFiles: 1,
  },
  {
    id: 4,
    title: 'Pipeline Terminal Avancé',
    prompt:
      'Dans ton terminal :\n1. Crée un dossier "benchmark_test" dans ton espace de stockage\n2. Génère un fichier JSON contenant 100 entrées aléatoires avec les champs : id, name, email, score (entre 0 et 100)\n3. Écris un script Node.js qui lit ce JSON, calcule la moyenne des scores, trouve le top 5 et le bottom 5, puis génère un rapport en markdown\n4. Exécute le script et envoie-moi le rapport markdown final',
    expectedFiles: 1,
  },
  {
    id: 5,
    title: "Test d'une Clé API et Listing des Modèles",
    prompt:
      "Voici ma clé API Groq : gsk_DUMMY_KEY_FOR_TESTING_12345\n\nUtilise cette clé pour :\n1. Vérifier qu'elle est valide en faisant un appel de test\n2. Lister tous les modèles disponibles sur cette clé\n3. Pour chaque modèle, indique : le nom, le context window, et s'il supporte le function calling\n4. Formate les résultats dans un tableau markdown propre et envoie-le moi",
    expectedFiles: 1,
  },
  {
    id: 6,
    title: "Création d'un Site Web",
    prompt:
      'Crée-moi un site web one-page responsive dans mon espace de stockage (storage_hm/portfolio_site/). Le site doit être un portfolio personnel fictif avec :\n- Un header avec un nom et un titre de poste\n- Une section "À propos" avec une photo placeholder (utilise une image de picsum.photos)\n- Une section "Compétences" avec des barres de progression animées\n- Une section "Projets" avec 3 cartes de projets\n- Un footer avec des liens vers des réseaux sociaux (icônes)\n- Un design moderne avec mode sombre, des gradients, et des micro-animations\n- Le tout en HTML + CSS + JS vanilla, pas de framework\n\nUne fois terminé, fais une capture d\'écran du résultat et envoie-la moi avec le lien vers les fichiers.',
    expectedFiles: 1,
  },
  {
    id: 7,
    title: 'Lecture et Analyse de ses Propres Fichiers',
    prompt:
      'Lis ton propre fichier de configuration principal (le system prompt dans persona/prompts/system.md) et fais-moi une analyse complète :\n1. Combien de sections principales contient-il ?\n2. Quelle est la taille totale en lignes et en mots ?\n3. Liste les 5 instructions les plus importantes que tu identifies\n4. Y a-t-il des contradictions ou des redondances dans les instructions ?\n5. Propose 3 améliorations concrètes\n\nFormate ta réponse dans un rapport markdown structuré.',
    expectedFiles: 1,
  },
  {
    id: 8,
    title: 'Veille Technologique Automatisée',
    prompt:
      'Réalise une veille technologique complète sur "AI Agents 2026" :\n\n1. NAVIGATEUR : Va sur ces 3 sites et fais une capture d\'écran de chacun :\n   - https://news.ycombinator.com (cherche "AI agent")\n   - https://arxiv.org/search/?query=AI+agents&searchtype=all\n   - https://github.com/trending?since=weekly\n\n2. EXTRACTION : Depuis chaque site, extrais les 3 résultats les plus pertinents sur les agents IA\n\n3. TERMINAL : Utilise ton terminal pour créer un dossier "veille_ia_2026" dans storage_hm et organise les captures par source\n\n4. SYNTHÈSE : Crée un rapport markdown complet "veille_ia_2026/rapport.md" avec :\n   - Un résumé exécutif de 5 lignes\n   - Un tableau comparatif des 9 résultats (source, titre, lien, pertinence /5)\n   - Les tendances identifiées\n   - Les captures d\'écran intégrées\n\n5. Envoie-moi le rapport final et les 3 captures d\'écran',
    expectedFiles: 4,
  },
  {
    id: 9,
    title: 'Audit de Sécurité Automatisé',
    prompt:
      'Réalise un mini-audit de sécurité de notre projet :\n\n1. FICHIERS : Lis le fichier .env et les fichiers de configuration (config/index.ts, config/credentials.json) pour identifier toutes les clés API et secrets présents\n\n2. TERMINAL : Exécute une recherche dans tout le projet pour trouver des patterns dangereux :\n   - Mots de passe en dur (grep pour "password", "secret", "token" dans le code)\n   - Fichiers .env non gitignorés (vérifie le .gitignore)\n   - Dépendances npm avec des vulnérabilités connues (npm audit)\n\n3. NAVIGATEUR : Va sur https://cve.mitre.org et cherche s\'il y a des CVE récentes pour nos 3 dépendances principales (baileys, supabase, redis)\n\n4. RAPPORT : Génère un rapport de sécurité en markdown dans storage_hm/ avec :\n   - Score de risque global (/10)\n   - Tableau des secrets détectés (masqués avec ***) et leur exposition\n   - Résultat du npm audit\n   - CVE pertinentes trouvées\n   - 5 recommandations prioritaires\n\n5. Envoie-moi le rapport + une capture d\'écran des résultats CVE',
    expectedFiles: 2,
  },
  {
    id: 10,
    title: 'Mission Complète Baileys',
    prompt:
      "Mission complète en 5 phases. Tu dois utiliser TOUS tes outils :\n\nPHASE 1 — RECHERCHE (Navigateur)\nVa sur https://api.github.com/repos/WhiskeySockets/Baileys/releases/latest et récupère la dernière version de Baileys. Ensuite va sur la page GitHub du repo et fais une capture d'écran de la page des releases.\n\nPHASE 2 — ANALYSE (Fichiers)\nLis notre package.json et compare la version de Baileys que nous utilisons avec la dernière version disponible. Lis aussi les 50 premières lignes de notre fichier core/index.ts pour identifier les imports Baileys.\n\nPHASE 3 — PROTOTYPE (Terminal + Fichiers)\nCrée un script Node.js dans storage_hm/baileys_check/ qui :\n- Fait un fetch de l'API GitHub pour récupérer les 5 dernières releases de Baileys\n- Compare avec notre version actuelle\n- Liste les breaking changes entre notre version et la dernière\n- Génère un rapport de compatibilité\n\nPHASE 4 — EXÉCUTION (Terminal)\nExécute le script et capture la sortie. Si le script échoue, corrige-le et ré-exécute.\n\nPHASE 5 — LIVRABLE (Fichiers + Envoi)\nCompile tout dans un rapport final \"baileys_upgrade_assessment.md\" dans storage_hm/ contenant :\n- Version actuelle vs dernière version\n- Changelog résumé\n- Breaking changes identifiés\n- Recommandation : upgrader maintenant ou attendre (avec justification)\n- La capture d'écran des releases GitHub\n\nEnvoie-moi le rapport final et la capture d'écran.",
    expectedFiles: 2,
  },
];

async function run() {
  let sock: WhatsAppSocket | null = null;
  try {
    sock = await connectToWhatsApp();
  } catch (err) {
    console.error('Failed to connect:', err);
    process.exit(1);
  }

  startRailwayLogs();

  const reportDir = path.join(process.cwd(), 'TEST_RESULT', 'battery_test');
  if (!safeExistsSync(reportDir)) {
    safeMkdirSync(reportDir, { recursive: true });
  }
  const reportFile = path.join(reportDir, 'e2e_battery_report.md');
  safeWriteFileSync(
    reportFile,
    `# 🧪 HIVE-MIND E2E Battery Report\n\nDate: ${new Date().toISOString()}\n\n`,
  );

  try {
    for (const test of TESTS) {
      console.log('\n\n[TEST-RUNNER] ==========================================');
      console.log(`[TEST-RUNNER] 🚀 STARTING TEST ${test.id}: ${test.title}`);
      console.log('[TEST-RUNNER] ==========================================\n');

      const promptBlock = test.prompt.replace(/\n/g, '\n> ');
      safeAppendFile(
        reportFile,
        `## 🧪 Test ${test.id}: ${test.title}\n\n**Prompt:**\n> ${promptBlock}\n\n`,
      );

      const result = await sendAndWaitForResponse(
        sock!,
        targetJID,
        test.prompt,
        test.expectedFiles,
        600000,
      );

      console.log(
        `[TEST-RUNNER] 🏁 TEST ${test.id} COMPLETED. Gathered ${result.files.length} files.`,
      );

      const filesList = result.files.map((f) => `- ${f}`).join('\n');
      safeAppendFile(
        reportFile,
        `### 📥 Response Text:\n\n${result.text}\n\n### 📎 Received Files:\n\n${filesList}\n\n---\n\n`,
      );

      // Wait 5 seconds before the next test to avoid spam
      await delay(5000);
    }
  } catch (error) {
    console.error('Test Execution Error:', error);
  } finally {
    await delay(3000);
    stopRailwayLogs();
    console.log(`\n[TEST-RUNNER] Finished battery test. Report saved to ${reportFile}`);
    process.exit(0);
  }
}

process.on('SIGINT', () => {
  stopRailwayLogs();
  process.exit(0);
});

run();
