// scripts/health-check.js
import { ServiceContainer } from '../core/ServiceContainer.js';
import { providerRouter } from '../providers/index.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

type HealthReport = {
  config: Record<string, string>;
  credentials: Record<string, string>;
  services: Record<string, string>;
  providers: Record<string, string>;
  infrastructure: Record<string, string>;
};

function maskCredentialValue(value: unknown, envValue: string | undefined): string {
  if (typeof value !== 'string') return '❌ Missing/Placeholder';
  const resolvedValue = value.startsWith('VOTRE_') && envValue ? envValue : value;
  if (resolvedValue.length > 10 && !resolvedValue.startsWith('VOTRE')) {
    return '✅ Present';
  }
  return '❌ Missing/Placeholder';
}

function checkConfigSection(report: HealthReport): void {
  console.log('--- 1. Configuration & Credentials ---');
  try {
    const modelsConfig = JSON.parse(
      readFileSync(join(__dirname, '..', 'config', 'models_config.json'), 'utf-8'),
    );
    const credentials = JSON.parse(
      readFileSync(join(__dirname, '..', 'config', 'credentials.json'), 'utf-8'),
    );

    report.config.status = '✅ Loaded';
    report.config.providers_defined = Object.keys(modelsConfig.familles).join(', ');

    const keys: Record<string, unknown> = credentials.familles_ia || {};
    const maskedKeys = new Map<string, string>();
    for (const [k, v] of Object.entries(keys)) {
      const envValue = v ? process.env[String(v)] : undefined;
      maskedKeys.set(k, maskCredentialValue(v, envValue));
    }
    report.credentials = Object.fromEntries(maskedKeys);
    console.table(report.credentials);
  } catch (e: unknown) {
    const err = e instanceof Error ? e : new Error(String(e));
    console.error('❌ Config Error:', err.message);
    process.exit(1);
  }
}

async function checkServicesSection(report: HealthReport): Promise<void> {
  console.log('\n--- 2. Services Initialization ---');
  const container = new ServiceContainer();
  try {
    await container.init();
    report.services.supabase = container.has('supabase') ? '✅ Ready' : '❌ Failed';
    report.services.memory = container.has('memory') ? '✅ Ready' : '❌ Failed';
    report.services.quota = container.has('quotaManager') ? '✅ Ready' : '❌ Failed';
    report.services.voice = container.has('voiceService') ? '✅ Ready' : '❌ Failed';
    report.services.transcription = container.has('transcriptionService')
      ? '✅ Ready'
      : '❌ Failed';

    // PING Supabase
    const dbService = container.get('supabase');
    const healthResult = await dbService.checkHealth();
    report.infrastructure.supabase_ping = healthResult.error
      ? `❌ Error: ${healthResult.error}`
      : '✅ Connected';
  } catch (e: unknown) {
    const err = e instanceof Error ? e : new Error(String(e));
    console.error('❌ Service Init Error:', err.message);
  }
  console.table(report.services);
}

async function checkProvidersSection(report: HealthReport): Promise<void> {
  console.log('\n--- 3. AI Providers Connectivity ---');

  // Attendre le chargement des adaptateurs (async)
  console.log('⏳ Waiting for adapters to load...');
  await new Promise((r) => setTimeout(r, 2000));

  const providersToTest = ['mistral', 'github', 'groq']; // Focus on new ones
  const providerStatuses = new Map<string, string>();
  for (const p of providersToTest) {
    try {
      const res = await providerRouter.chat([{ role: 'user', content: 'Ping' }], { family: p });
      providerStatuses.set(p, res.content ? '✅ OK' : '⚠️ No Content');
    } catch (e: unknown) {
      const err = e instanceof Error ? e : new Error(String(e));
      providerStatuses.set(p, `❌ Failed: ${err.message.slice(0, 50)}...`);
    }
  }
  report.providers = Object.fromEntries(providerStatuses);
  console.table(report.providers);
}

async function runHealthCheck() {
  console.log('🏥 Lancement du Diagnostic Système Complet (V3/V4)...\n');
  const report: HealthReport = {
    config: {},
    credentials: {},
    services: {},
    providers: {},
    infrastructure: {},
  };

  checkConfigSection(report);
  await checkServicesSection(report);
  await checkProvidersSection(report);

  // 4. SUMMARY
  console.log('\n--- 🏁 DIAGNOSTIC SUMMARY 🏁 ---');
  console.log(JSON.stringify(report, null, 2));
}

runHealthCheck();
