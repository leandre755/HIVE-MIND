import { join } from 'node:path';
import { safeMkdirSync, safeReadFileSync, safeWriteFileSync } from '../utils/safeFs.js';
import {
  resolveConfigPath,
  resolveDefaultsConfigDir,
  resolveLegacyConfigDir,
  resolveUserConfigDir,
} from '../config/ConfigPathResolver.js';

type ModelEntry = {
  id: string;
  [key: string]: unknown;
};

type ModelsConfig = {
  reglages_generaux: {
    service_recipes: Record<string, { family: string; model: string }>;
  };
  familles: Record<string, { modeles: ModelEntry[] }>;
};

const configPath = resolveConfigPath('models_config.json');
const data = JSON.parse(safeReadFileSync(configPath, 'utf-8')) as ModelsConfig;

// Update service recipes
data.reglages_generaux.service_recipes.EXECUTOR.family = 'gemini';
data.reglages_generaux.service_recipes.EXECUTOR.model = 'gemma-4-31b-it';

data.reglages_generaux.service_recipes.PLANNER.family = 'gemini';
data.reglages_generaux.service_recipes.PLANNER.model = 'gemma-4-31b-it';

// Add the model to the gemini family if it doesn't exist
const geminiFamily = data.familles.gemini;
const modelExists = geminiFamily.modeles.find((m) => m.id === 'gemma-4-31b-it');
if (!modelExists) {
  geminiFamily.modeles.push({
    id: 'gemma-4-31b-it',
    description: 'Gemma via Google Gemini API',
    types: ['chat', 'agentic', 'coding', 'reasoning'],
    quota: { rpm: 15, tpm: 1000000, rpd: 1500 },
    ptc_tier: 'A',
  });
}

const defaultsDir = resolveDefaultsConfigDir();
const legacyDir = resolveLegacyConfigDir();
const isReadOnlyOrTemplate = configPath.startsWith(defaultsDir) || configPath.startsWith(legacyDir);
const writePath = isReadOnlyOrTemplate
  ? join(resolveUserConfigDir(), 'models_config.json')
  : configPath;

if (isReadOnlyOrTemplate) {
  safeMkdirSync(resolveUserConfigDir(), { recursive: true });
}

safeWriteFileSync(writePath, JSON.stringify(data, null, 4), 'utf-8');
console.log(`models_config.json updated successfully at ${writePath}.`);
