// scripts/test_models.ts
import path from 'path';
import { fileURLToPath } from 'url';
import { providerRouter } from '../providers/index.js';
import { safeReadFileSync } from '../utils/safeFs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type ModelEntry = {
  id: string;
  types?: string[];
};

type ModelsConfig = {
  familles: Record<string, { modeles?: ModelEntry[] }>;
};

type ModelTestResult = {
  family: string;
  model: string;
  status: 'SUCCESS' | 'WARNING' | 'FAILED';
  error?: string;
};

// Charger la config pour avoir le détail des modèles (types)
const modelsConfig = JSON.parse(
  safeReadFileSync(path.join(__dirname, '..', 'config', 'models_config.json')),
) as ModelsConfig;

function getStatusIcon(status: ModelTestResult['status']): string {
  if (status === 'SUCCESS') return '✅';
  if (status === 'WARNING') return '⚠️ ';
  return '❌';
}

async function testSingleModel(familyId: string, model: ModelEntry): Promise<ModelTestResult> {
  console.log(`🚀 [${familyId}] Test du modèle: ${model.id}...`);
  try {
    const response = await providerRouter.chat(
      [{ role: 'user', content: 'Réponds uniquement par "OK" si tu reçois ce message.' }],
      {
        family: familyId,
        model: model.id,
        maxTokens: 10,
      },
    );

    const content = response.content?.trim() || '';
    if (content.toUpperCase().includes('OK') || content.length > 0) {
      console.log(`✅ [${familyId}] ${model.id}: Succès !`);
      return { family: familyId, model: model.id, status: 'SUCCESS' };
    }
    console.warn(`⚠️  [${familyId}] ${model.id}: Réponse vide`);
    return {
      family: familyId,
      model: model.id,
      status: 'WARNING',
      error: 'Empty response',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`❌ [${familyId}] ${model.id}: Échec: ${message}`);
    return {
      family: familyId,
      model: model.id,
      status: 'FAILED',
      error: message,
    };
  }
}

async function runTests() {
  console.log('🔍 [Diagnostic] Démarrage du test COMPLET des modèles...\n');

  const families = providerRouter.listFamilies();
  const results: ModelTestResult[] = [];

  for (const familyInfo of families) {
    if (!familyInfo.hasApiKey) {
      console.log(`⚪ [${familyInfo.id}] Ignoré (Pas de clé API valide)`);
      continue;
    }

    const familyConfig = modelsConfig.familles[familyInfo.id];
    if (!familyConfig || !familyConfig.modeles) continue;

    const chatModels = familyConfig.modeles.filter((m: ModelEntry) => m.types?.includes('chat'));
    if (chatModels.length === 0) {
      console.log(`⚪ [${familyInfo.id}] Aucun modèle de type 'chat' à tester.`);
      continue;
    }

    for (const model of chatModels) {
      const res = await testSingleModel(familyInfo.id, model);
      results.push(res);
    }
  }

  // Affichage du résumé
  console.log('\n======================================================================');
  console.log('📊 RÉSUMÉ DES TESTS COMPLETS');
  console.log('======================================================================');
  console.log(
    `${'FAMILLE'.padEnd(12)} | ${'MODÈLE'.padEnd(30)} | ${'STATUT'.padEnd(10)} | ${'MESSAGE'}`,
  );
  console.log('----------------------------------------------------------------------');

  results.forEach((r) => {
    const icon = getStatusIcon(r.status);
    console.log(
      `${icon} ${r.family.padEnd(10)} | ${r.model.padEnd(30)} | ${r.status.padEnd(10)} | ${r.error || 'OK'}`,
    );
  });
  console.log('======================================================================\n');

  process.exit(0);
}

runTests().catch((err) => {
  console.error('Erreur fatale lors du test:', err);
  process.exit(1);
});
