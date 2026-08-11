import {
  safeExistsSync,
  safeReaddirSync,
  safeStatSync,
  safeUnlinkSync,
  resolveWithinRoot,
} from '../utils/safeFs.js';

const sessions = ['./session_test_admin', './session_test_user'];

sessions.forEach((sessionDir) => {
  const dir = resolveWithinRoot(process.cwd(), sessionDir);
  console.log(`🔧 [Repair] Repairing ${sessionDir}...`);

  if (!safeExistsSync(dir)) {
    console.warn(`⚠️ ${sessionDir} not found.`);
    return;
  }

  const files = safeReaddirSync(dir);
  let cleanedCount = 0;

  files.forEach((file) => {
    if (file === 'creds.json') return;
    const filePath = resolveWithinRoot(dir, file);
    try {
      if (safeStatSync(filePath).isFile()) {
        safeUnlinkSync(filePath);
        cleanedCount++;
      }
    } catch (e: unknown) {
      const err = e instanceof Error ? e : new Error(String(e));
      console.warn(`⚠️ Failed to delete ${file}: ${err.message}`);
    }
  });

  console.log(`✅ ${sessionDir} repaired. ${cleanedCount} cache files removed.`);
});
