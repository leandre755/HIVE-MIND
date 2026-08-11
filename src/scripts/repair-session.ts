// scripts/repair-session.js
// ============================================================================
// UTILITAIRE DE RÉPARATION DE SESSION
// ============================================================================
// Nettoie les fichiers de cache de session Baileys tout en gardant
// les identifiants principaux (creds.json).
// À utiliser en cas de "MessageCounterError".

import { existsSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { safeStatSync, safeUnlinkSync, resolveWithinRoot } from '../utils/safeFs.js';

const SESSION_DIR = resolve(process.cwd(), 'session');

console.log('🔧 [Repair] Analyse du dossier session...');

if (!existsSync(SESSION_DIR)) {
  console.error('❌ Dossier session introuvable. Rien à réparer.');
  process.exit(1);
}

const files = readdirSync(SESSION_DIR);
let cleanedCount = 0;

console.log(`📂 Fichiers trouvés: ${files.length}`);

// Liste des fichiers à NE PAS supprimer car ils contiennent l'appairage
const PROTECTED_FILES = ['creds.json'];

files.forEach((file) => {
  // Ne pas supprimer les fichiers protégés
  if (PROTECTED_FILES.includes(file)) {
    console.log(`🟢 Conservation de: ${file}`);
    return;
  }

  let filePath: string;
  try {
    filePath = resolveWithinRoot(SESSION_DIR, file);
  } catch {
    return;
  }

  try {
    if (safeStatSync(filePath).isFile()) {
      safeUnlinkSync(filePath);
      cleanedCount++;
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`⚠️ Impossible de supprimer ${file}: ${msg}`);
  }
});

console.log('---');
console.log(`✅ Réparation terminée. ${cleanedCount} fichiers de cache supprimés.`);
console.log('🚀 Tu peux maintenant relancer le bot : npm start');
console.log('💡 Tes identifiants QR Code ont été conservés.');
