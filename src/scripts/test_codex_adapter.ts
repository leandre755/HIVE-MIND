import { providerRouter, loadAdapters } from '../providers/index.js';

async function testCodex() {
  console.log('🔄 Initialisation des adaptateurs...');
  try {
    console.log('🔄 Import direct du module codex...');
    await import('../providers/adapters/codex.js');
    console.log('✅ Import direct réussi !');
  } catch (err: unknown) {
    console.error("❌ L'import direct a échoué :", err);
  }

  await loadAdapters();

  const hasAdapter = providerRouter.adapters.has('codex');
  console.log(`✅ Adaptateur codex enregistré : ${hasAdapter}`);

  if (!hasAdapter) {
    console.error("❌ L'adaptateur codex n'a pas pu être chargé.");
    process.exit(1);
  }

  const messages = [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Bonjour, qui es-tu ?' },
  ];

  console.log("🚀 Envoi d'une requête test à Codex (gpt-5.5)...");
  try {
    const result = await providerRouter.chat(messages, {
      family: 'codex',
      model: 'gpt-5.5',
      temperature: 0.7,
    });
    console.log('🎉 Succès de la requête !');
    console.log('Résultat:', JSON.stringify(result, null, 2));
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.log('❌ Résultat de la requête :');
    console.log(err.message);
  }
}

testCodex();
