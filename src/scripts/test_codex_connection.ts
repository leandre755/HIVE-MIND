// scripts/test_codex_connection.ts
import { safeExistsSync, safeReadFileSync } from '../utils/safeFs.js';

const AUTH_FILE_PATH = '/home/omni/.codex/auth.json';
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';

type TokenPair = {
  access_token?: string;
  refresh_token?: string;
  account_id?: string;
};

function decodeJwt(token: string): { exp?: number; [key: string]: unknown } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(global.Buffer.from(parts[1], 'base64').toString('utf8'));
    return payload as { exp?: number; [key: string]: unknown };
  } catch {
    return null;
  }
}

async function refreshIfNeeded(tokens: TokenPair): Promise<TokenPair> {
  const accessToken = tokens.access_token;
  const refreshToken = tokens.refresh_token;

  if (!accessToken) {
    console.log("Pas d'access token, refresh requis.");
    return await refresh(refreshToken ?? '');
  }

  const payload = decodeJwt(accessToken);
  if (!payload || typeof payload.exp !== 'number') {
    console.log('JWT invalide ou sans exp, refresh requis.');
    return await refresh(refreshToken ?? '');
  }

  const nowSec = Math.floor(Date.now() / 1000);
  console.log(`Token expire dans ${(payload.exp - nowSec) / 60} minutes.`);
  if (payload.exp - nowSec < 300) {
    console.log('Token expire bientôt, refresh...');
    return await refresh(refreshToken ?? '');
  }

  return tokens;
}

async function refresh(refreshToken: string): Promise<TokenPair> {
  console.log('Appel de auth.openai.com pour rafraîchir le token...');
  const res = await fetch('https://auth.openai.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Refresh failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as { access_token?: string; refresh_token?: string };
  const decoded = data.access_token ? decodeJwt(data.access_token) : null;
  const authSection =
    decoded && typeof decoded['https://api.openai.com/auth'] === 'object'
      ? (decoded['https://api.openai.com/auth'] as { chatgpt_account_id?: unknown })
      : undefined;

  console.log('Refresh réussi !');
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token || refreshToken,
    account_id: authSection?.chatgpt_account_id as string | undefined,
  };
}

async function testModel(model: string, headers: Record<string, string>): Promise<Response | null> {
  console.log(`\n--- Test du modèle : ${model} ---`);
  const body = {
    model,
    store: false,
    stream: true,
    instructions: 'You are a helpful assistant.',
    input: [
      {
        type: 'message',
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: 'Dis le mot "PONG" uniquement, sans rien d\'autre.',
          },
        ],
      },
    ],
    text: {
      verbosity: 'medium',
    },
    include: ['reasoning.encrypted_content'],
  };

  const response = await fetch('https://chatgpt.com/backend-api/codex/responses', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (response.ok) {
    console.log(`✅ Succès avec le modèle : ${model}`);
    return response;
  }
  const text = await response.text();
  console.log(`❌ Échec avec le modèle ${model} : ${response.status} ${response.statusText}`);
  console.log(text);
  return null;
}

function handleSseLine(line: string): void {
  if (!line.trim().startsWith('data:')) return;
  const jsonStr = line.substring(line.indexOf('{'));
  try {
    const parsed = JSON.parse(jsonStr);
    console.log(`[SSE Event] Type: ${parsed.type}`);
    if (parsed.type === 'response.done' || parsed.type === 'response.completed') {
      console.log('--- EVENT FINAL ---');
      console.log(JSON.stringify(parsed, null, 2));
    }
  } catch {
    // Non-JSON or partial line
  }
}

async function readSseStream(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      handleSseLine(line);
    }
  }
  console.log('Fin du stream.');
}

async function main() {
  if (!safeExistsSync(AUTH_FILE_PATH)) {
    console.error(`Fichier ${AUTH_FILE_PATH} introuvable !`);
    process.exit(1);
  }

  const authData = JSON.parse(safeReadFileSync(AUTH_FILE_PATH));
  const tokens = authData.tokens;

  console.log('Tokens chargés de auth.json :');
  console.log(`- Account ID: ${tokens.account_id}`);

  const updatedTokens = await refreshIfNeeded(tokens);

  const modelsToTest = ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex', 'gpt-5.2'];

  const headers = {
    Authorization: `Bearer ${updatedTokens.access_token}`,
    'chatgpt-account-id': updatedTokens.account_id || '',
    'OpenAI-Beta': 'responses=experimental',
    originator: 'codex_cli_rs',
    'Content-Type': 'application/json',
    accept: 'text/event-stream',
  };

  let successfulModel: string | null = null;
  let successfulResponse: Response | null = null;

  for (const model of modelsToTest) {
    const response = await testModel(model, headers);
    if (response) {
      successfulModel = model;
      successfulResponse = response;
      break;
    }
  }

  if (!successfulResponse || !successfulModel) {
    console.error("\nAucun modèle n'a fonctionné.");
    process.exit(1);
  }

  console.log(`\nStream reçu pour ${successfulModel}, lecture des événements...`);
  const reader = successfulResponse.body?.getReader();
  if (!reader) {
    console.error('Pas de body reader !');
    process.exit(1);
  }

  await readSseStream(reader);
}

main().catch(console.error);
