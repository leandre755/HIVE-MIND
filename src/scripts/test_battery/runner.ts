// Set environment for CLI testing (battery mode: no interactive readline, full logs)
process.env.ACTIVE_TRANSPORTS = 'cli';
process.env.APP_ENV = 'battery';

import { botCore } from '../../core/index.js';
import { cliTransport } from '../../core/transport/cli.js';
import * as path from 'path';
import { persistentShell } from '../../plugins/base/dev_tools/PersistentShell.js';
import {
  safeExistsSync,
  safeMkdirSync,
  safeWriteFileSync,
  safeAppendFile,
  resolveWithinRoot,
} from '../../utils/safeFs.js';

const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

export const TESTS = [
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
    expectedFiles: 0,
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
    expectedFiles: 0,
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

let currentCapturedText = '';
let currentCapturedFiles: string[] = [];

const originalSendUniversalResponse = cliTransport.sendUniversalResponse;
const originalSendFile = cliTransport.sendFile;
const originalSendMedia = cliTransport.sendMedia;
const originalSendText = cliTransport.sendText;
let activeChatId = '';

cliTransport.sendText = async (
  chatId: string,
  text: string,
  options: Record<string, unknown> = {},
) => {
  if (chatId === activeChatId) {
    currentCapturedText += text + '\n\n';
  }
  return originalSendText.call(cliTransport, chatId, text, options);
};

type IncomingMessageLike = {
  id: string;
  chatId: string;
  sender: string;
  senderName: string;
  text: string;
  isGroup: boolean;
  isSystem: boolean;
  raw: { text: string };
  authorityLevel: string;
};

async function simulateIncomingMessage(text: string, testId: number) {
  console.log(`\n[CLI-TEST] 📩 Envoi de la demande: "${text.substring(0, 55)}..."`);
  const messageObj: IncomingMessageLike = {
    id: 'cli_test_' + Date.now(),
    chatId: 'cli_chat_e2e_' + testId,
    sender: 'test_user',
    senderName: 'Tester',
    text,
    isGroup: false,
    isSystem: false,
    raw: { text },
    authorityLevel: 'DIVIN (SuperUser)',
  };

  if (cliTransport.messageCallback) {
    cliTransport.messageCallback(messageObj as Parameters<typeof cliTransport.messageCallback>[0]);
  }
}

type BatteryTest = (typeof TESTS)[number];
type TestVerdict = 'success' | 'partial' | 'timeout' | 'failed';

async function waitForTestCompletion(
  test: BatteryTest,
  timeoutMs: number,
  startTime: number,
  getTimeSinceLastActivity: () => number,
): Promise<boolean> {
  let completed = false;
  while (Date.now() - startTime < timeoutMs) {
    await delay(2000);

    const timeSinceLastActivity = getTimeSinceLastActivity();

    if (test.expectedFiles > 0 && currentCapturedFiles.length >= test.expectedFiles) {
      if (!completed) {
        console.log(
          `✅ [CLI-TEST] Reçu le nombre attendu de fichiers (${test.expectedFiles}). Attente de la réponse finale texte...`,
        );
        completed = true;
      }
    }

    // If 30 seconds have passed with no new activity and we have a text response, consider done
    if (timeSinceLastActivity > 30000 && currentCapturedText.length > 20) {
      console.log('⏳ [CLI-TEST] Inactivité détectée pendant 30s. Fin du test.');
      completed = true;
      break;
    }
  }
  return completed;
}

function computeVerdict(expectedFiles: number, startTime: number, timeoutMs: number): TestVerdict {
  const hasText = currentCapturedText.length > 20;
  const hasEnoughFiles = expectedFiles === 0 || currentCapturedFiles.length >= expectedFiles;
  const timedOut = Date.now() - startTime >= timeoutMs;

  if (timedOut && !hasText) return 'timeout';
  if (hasText && hasEnoughFiles) return 'success';
  if (hasText && !hasEnoughFiles && expectedFiles > 0) return 'partial';
  return 'failed';
}

export async function runSingleTest(testId: number) {
  const test = TESTS.find((t) => t.id === testId);
  if (!test) {
    console.error(`❌ Test ID ${testId} not found.`);
    process.exit(1);
  }

  try {
    console.log('🚀 Initializing bot core in CLI mode...');
    await botCore.init();

    // [ANTI-POLLUTION & SANDBOX CWD ENFORCEMENT]
    // Ensure PersistentShell is at the correct sandbox path
    const sandboxPath = process.env.SANDBOX_DIR
      ? path.resolve(process.env.SANDBOX_DIR)
      : path.resolve(process.cwd(), 'Sandbox1');

    if (!safeExistsSync(sandboxPath)) {
      safeMkdirSync(sandboxPath, { recursive: true });
    }

    try {
      await persistentShell.execute('cd ' + sandboxPath);
      console.log(`🧹 [CLI-TEST] Initialized PersistentShell CWD inside sandbox: ${sandboxPath}`);
    } catch (e) {
      console.error('⚠️ [CLI-TEST] Failed to set PersistentShell CWD to sandbox:', e);
    }

    const reportFile = resolveWithinRoot(process.cwd(), `e2e_test_${testId}_report.md`);
    safeWriteFileSync(
      reportFile,
      `# 🧪 HIVE-MIND E2E CLI Single Test Report (Test ${testId})\n\nDate: ${new Date().toISOString()}\n\n`,
    );

    let currentCapturedLogs = '';
    const originalStdoutWrite = process.stdout.write;
    const originalStderrWrite = process.stderr.write;

    type WriteChunk = string | Uint8Array;
    const hookStdout = function (chunk: WriteChunk, ...args: unknown[]) {
      if (typeof chunk === 'string') currentCapturedLogs += chunk;
      else if (Buffer.isBuffer(chunk)) currentCapturedLogs += chunk.toString('utf8');
      return (originalStdoutWrite as unknown as (...a: unknown[]) => boolean).apply(
        process.stdout,
        [chunk, ...args],
      );
    };

    const hookStderr = function (chunk: WriteChunk, ...args: unknown[]) {
      if (typeof chunk === 'string') currentCapturedLogs += chunk;
      else if (Buffer.isBuffer(chunk)) currentCapturedLogs += chunk.toString('utf8');
      return (originalStderrWrite as unknown as (...a: unknown[]) => boolean).apply(
        process.stderr,
        [chunk, ...args],
      );
    };

    process.stdout.write = hookStdout;
    process.stderr.write = hookStderr;

    console.log('\n==========================================');
    console.log(`🚀 STARTING SINGLE TEST ${test.id}: ${test.title}`);
    console.log('==========================================\n');

    // Reset interceptors
    currentCapturedText = '';
    currentCapturedFiles = [];
    currentCapturedLogs = '';
    activeChatId = `cli_chat_e2e_${test.id}`;

    let lastActivityTime = Date.now();

    cliTransport.sendUniversalResponse = async (
      chatId: string,
      response: { markdown?: string; text?: string },
      options: Record<string, unknown> = {},
    ) => {
      if (chatId !== activeChatId)
        return originalSendUniversalResponse.call(cliTransport, chatId, response, options);
      const text = response.markdown || response.text || '';
      if (text) currentCapturedText += text + '\n\n';
      lastActivityTime = Date.now();
      return originalSendUniversalResponse.call(cliTransport, chatId, response, options);
    };

    cliTransport.sendFile = async (chatId: string, filePath: string, fileName: string) => {
      if (chatId !== activeChatId)
        return originalSendFile.call(cliTransport, chatId, filePath, fileName);
      currentCapturedFiles.push(fileName || 'fichier_inconnu');
      lastActivityTime = Date.now();
      return originalSendFile.call(cliTransport, chatId, filePath, fileName);
    };

    cliTransport.sendMedia = async (
      chatId: string,
      media: unknown,
      options: { caption?: string } = {},
    ) => {
      if (chatId !== activeChatId)
        return originalSendMedia.call(cliTransport, chatId, media, options);
      currentCapturedFiles.push(options.caption || 'media_inconnu');
      lastActivityTime = Date.now();
      return originalSendMedia.call(cliTransport, chatId, media, options);
    };

    // Dispatch message
    await simulateIncomingMessage(test.prompt, test.id);

    const timeoutMs = 600000; // 10 minutes hard limit
    const startTime = Date.now();
    const completed = await waitForTestCompletion(
      test,
      timeoutMs,
      startTime,
      () => Date.now() - lastActivityTime,
    );

    if (!completed) {
      console.log('⚠️ [CLI-TEST] Timeout atteint pour ce test (10min).');
    }

    const verdict: TestVerdict = computeVerdict(test.expectedFiles, startTime, timeoutMs);

    const verdictEmoji = new Map<string, string>([
      ['success', '✅'],
      ['partial', '⚠️'],
      ['timeout', '⏰'],
      ['failed', '❌'],
    ]);
    const verdictLabel: string = verdictEmoji.get(verdict) ?? verdict;

    const promptBlock = test.prompt.replace(/\n/g, '\n> ');
    const filesList = currentCapturedFiles.map((f) => `- ${f}`).join('\n');
    const reportContent =
      `## ${verdictLabel} Test ${test.id}: ${test.title} — **${verdict.toUpperCase()}**\n\n` +
      `**Prompt:**\n> ${promptBlock}\n\n` +
      `**Verdict:** ${verdict} (Files: ${currentCapturedFiles.length}/${test.expectedFiles}, Text length: ${currentCapturedText.length} chars)\n\n` +
      `### 📥 Response Text:\n\n${currentCapturedText}\n\n` +
      `### 📎 Received Files:\n\n${filesList}\n\n` +
      `### 📜 Logs:\n\n\`\`\`\n${currentCapturedLogs}\n\`\`\`\n\n---\n\n`;
    safeAppendFile(reportFile, reportContent);

    // Restore real originals
    cliTransport.sendUniversalResponse = originalSendUniversalResponse;
    cliTransport.sendFile = originalSendFile;
    cliTransport.sendMedia = originalSendMedia;
    cliTransport.sendText = originalSendText;
    activeChatId = '';

    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;

    console.log('==========================================');
    console.log(`🏁 SINGLE TEST ${test.id} complete: ${verdict.toUpperCase()}`);
    console.log('==========================================\n');

    process.exit(verdict === 'success' ? 0 : 1);
  } catch (error) {
    console.error('❌ E2E CLI Single Test failed:', error);
    process.exit(1);
  }
}
