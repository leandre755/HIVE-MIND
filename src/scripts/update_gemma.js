import fs from 'fs';

const path = './config/models_config.json';
const data = JSON.parse(fs.readFileSync(path, 'utf8'));

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

fs.writeFileSync(path, JSON.stringify(data, null, 4));
console.log('models_config.json updated successfully.');
