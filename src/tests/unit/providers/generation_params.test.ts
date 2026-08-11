// src/tests/unit/providers/generation_params.test.ts
//
// Batterie du Step 5 du plan « generation » : module pur `GenerationParams`
// (résolution de dialecte, résolution de capacités, validation fail-closed,
// traduction filaire, annotation prompt caching), consommation par les
// moteurs de protocole (sans réseau) et fusion wireParams des trois adapters
// natifs (mockFetch).
//
// Complément (pas doublon) de src/tests/provider_families.test.ts : cette
// dernière fige la composition GenericProviderAdapter x registries ; ici on
// verrouille les contrats exacts de GenerationParams et la primauté du
// canal filaire jusqu'aux corps HTTP natifs.
//
// Les entrées de famille proviennent du models_config.json RÉEL (lecture
// identique à celle du chargeur routeur), complétées d'objets synthétiques
// là où le plan exige des formes hors JSON (surcharge modèle, erreurs de
// forme, natifs sans champ protocol_family).

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { jest, describe, it, expect, beforeEach } from '@jest/globals';

import {
  GenerationParamsError,
  applyPromptCaching,
  resolveCapabilities,
  resolveProtocolDialect,
  toWireParams,
  validateParams,
  type ModelCapabilities,
  type ThinkingParams,
} from '../../../providers/GenerationParams.js';
import { openAICompatibleProtocol } from '../../../providers/families/protocols/OpenAICompatibleProtocol.js';
import { anthropicCompatibleProtocol } from '../../../providers/families/protocols/AnthropicCompatibleProtocol.js';
import type { ProtocolContext } from '../../../providers/families/types.js';
import type { ChatMessage } from '../../../providers/types.js';

import openaiAdapter from '../../../providers/adapters/openai.js';
import anthropicAdapter from '../../../providers/adapters/anthropic.js';
import geminiAdapter from '../../../providers/adapters/gemini.js';

const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>;
global.fetch = mockFetch;

const DUMMY_API_KEY = 'DUMMY_KEY';

/** Configuration réelle, lue comme le fait le chargeur du routeur. */
const HERE = dirname(fileURLToPath(import.meta.url));
const modelsConfig = JSON.parse(
  readFileSync(join(HERE, '..', '..', '..', 'config', 'models_config.json'), 'utf-8'),
) as { familles: Record<string, Record<string, unknown>> };

const ANTHROPIC_ENTRY = modelsConfig.familles['anthropic'];
const OPENAI_ENTRY = modelsConfig.familles['openai'];

/**
 * Capacités résolues de la famille anthropic du JSON réel :
 * thinking anthropic-budget, prompt caching, température bornée à [0, 1],
 * max_tokens obligatoire.
 */
const CAPS_ANTHROPIC: ModelCapabilities = {
  thinking: 'anthropic-budget',
  promptCaching: true,
  temperatureRange: [0, 1],
  maxTokensField: 'max_tokens',
  maxTokensRequired: true,
};

/** Capacités résolues de la famille openai (gpt-5) du JSON réel. */
const CAPS_OPENAI_GPT5: ModelCapabilities = {
  thinking: 'openai-effort',
  promptCaching: false,
  temperatureRange: 'unsupported',
  maxTokensField: 'max_completion_tokens',
  maxTokensRequired: false,
};

/** Capacités résolues de la famille gemini du JSON réel. */
const CAPS_GEMINI: ModelCapabilities = {
  thinking: 'gemini-budget',
  promptCaching: false,
  temperatureRange: [0, 2],
  maxTokensField: 'maxOutputTokens',
  maxTokensRequired: false,
};

/** Profil fail-closed « nul » (aucune capacité déclarée). */
const CAPS_NONE: ModelCapabilities = {
  thinking: 'none',
  promptCaching: false,
  temperatureRange: [0, 2],
  maxTokensField: 'max_tokens',
  maxTokensRequired: false,
};

/** Capture l'erreur levée par `fn` (undefined si aucune — assertion échouée). */
function captureThrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (caught) {
    return caught;
  }
  return undefined;
}

/** Réponse HTTP 200 standard pour les adapters natifs. */
function okJsonResponse(data: unknown): Response {
  return { ok: true, json: async () => data } as Partial<Response> as Response;
}

interface CapturedCall {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/** Relit le dernier appel fetch capturé (URL, en-têtes, corps désérialisé). */
function capturedCall(index: number = 0): CapturedCall {
  const call = mockFetch.mock.calls.at(index);
  if (call === undefined) {
    throw new Error('Assertion impossible : mockFetch n a pas été appelé.');
  }
  const init = call[1] as { headers: Record<string, string>; body: string };
  return {
    url: String(call[0]),
    headers: init.headers,
    body: JSON.parse(init.body) as Record<string, unknown>,
  };
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe('A. resolveProtocolDialect', () => {
  it('A.1 protocol_family déclaré et admis -> retour du dialecte (JSON réel + synthétique)', () => {
    expect(resolveProtocolDialect('anthropic', ANTHROPIC_ENTRY)).toBe('anthropic-compatible');
    expect(resolveProtocolDialect('openai', OPENAI_ENTRY)).toBe('openai-compatible');
    expect(resolveProtocolDialect('kimi', { protocol_family: 'openai-compatible' })).toBe(
      'openai-compatible',
    );
    expect(resolveProtocolDialect('gemini', modelsConfig.familles['gemini'])).toBe('gemini-native');
  });

  it('A.2 valeur protocol_family inconnue -> GenerationParamsError', () => {
    expect(() => resolveProtocolDialect('kimi', { protocol_family: 'grpc-native' })).toThrow(
      GenerationParamsError,
    );
    expect(() => resolveProtocolDialect('kimi', { protocol_family: 'grpc-native' })).toThrow(
      /dialecte de protocole non admis pour la famille "kimi"/,
    );
  });

  it('A.3 natifs sans champ protocol_family : anthropic/openai/gemini -> dialectes natifs', () => {
    expect(resolveProtocolDialect('anthropic', {})).toBe('anthropic-compatible');
    expect(resolveProtocolDialect('openai', {})).toBe('openai-compatible');
    expect(resolveProtocolDialect('gemini', {})).toBe('gemini-native');
  });

  it('A.4 famille inconnue sans déclaration (codex, omega) -> GenerationParamsError sans vocabulaire quota', () => {
    const codexError = captureThrown(() => resolveProtocolDialect('codex', {}));
    expect(codexError).toBeInstanceOf(GenerationParamsError);
    expect((codexError as Error).message).toContain('codex');
    expect((codexError as Error).message).not.toMatch(/(quota|limit|rate|429|insufficient)/i);

    const omegaError = captureThrown(() => resolveProtocolDialect('omega', {}));
    expect(omegaError).toBeInstanceOf(GenerationParamsError);
    expect((omegaError as Error).message).toContain('omega');
    expect((omegaError as Error).message).not.toMatch(/(quota|limit|rate|429|insufficient)/i);
  });
});

describe('B. resolveCapabilities', () => {
  it('B.1 famille REELLE anthropic : anthropic-budget, promptCaching, [0,1], max_tokens, required true', () => {
    // Invariant exercé : modèle sonnet présent sans surcharge -> capacités
    // de famille.
    expect(resolveCapabilities('claude-4-5-sonnet-20250929', ANTHROPIC_ENTRY)).toEqual({
      thinking: 'anthropic-budget',
      promptCaching: true,
      temperatureRange: [0, 1],
      maxTokensField: 'max_tokens',
      maxTokensRequired: true,
    });
  });

  it('B.2 famille REELLE openai : openai-effort, max_completion_tokens, temperature unsupported', () => {
    expect(resolveCapabilities('gpt-5.2', OPENAI_ENTRY)).toEqual({
      thinking: 'openai-effort',
      promptCaching: false,
      temperatureRange: 'unsupported',
      maxTokensField: 'max_completion_tokens',
      maxTokensRequired: false,
    });
  });

  it('B.3 surcharge modèle : m1 -> gemini-budget, m2 -> capacités de famille (none)', () => {
    const synthetic = {
      modeles: [{ id: 'm1', capacites: { thinking: 'gemini-budget' } }],
      capacites: { thinking: 'none' },
    };
    expect(resolveCapabilities('m1', synthetic)).toEqual({
      thinking: 'gemini-budget',
      promptCaching: false,
      temperatureRange: [0, 2],
      maxTokensField: 'max_tokens',
      maxTokensRequired: false,
    });
    expect(resolveCapabilities('m2', synthetic)).toEqual({
      thinking: 'none',
      promptCaching: false,
      temperatureRange: [0, 2],
      maxTokensField: 'max_tokens',
      maxTokensRequired: false,
    });
  });

  it('B.4a capacités malformées (clé inconnue) -> GenerationParamsError', () => {
    expect(() =>
      resolveCapabilities('m', { capacites: { thinking: 'none', surprise: 1 } }),
    ).toThrow(GenerationParamsError);
    expect(() =>
      resolveCapabilities('m', { capacites: { thinking: 'none', surprise: 1 } }),
    ).toThrow(/clé inconnue "surprise"/);
  });

  it('B.4b capacités malformées (temperature_range [3,1]) -> GenerationParamsError', () => {
    expect(() => resolveCapabilities('m', { capacites: { temperature_range: [3, 1] } })).toThrow(
      GenerationParamsError,
    );
    expect(() => resolveCapabilities('m', { capacites: { temperature_range: [3, 1] } })).toThrow(
      /capacites\.temperature_range/,
    );
  });

  it('B.4c capacités malformées (thinking "exotique") -> GenerationParamsError', () => {
    expect(() => resolveCapabilities('m', { capacites: { thinking: 'exotique' } })).toThrow(
      GenerationParamsError,
    );
    expect(() => resolveCapabilities('m', { capacites: { thinking: 'exotique' } })).toThrow(
      /capacites\.thinking/,
    );
  });

  it('B.5 entrée sans capacites -> profil nul (none/false/[0,2]/max_tokens/false)', () => {
    expect(
      resolveCapabilities('modele-quelconque', { base_url: 'https://api.exemple.test/v1' }),
    ).toEqual({
      thinking: 'none',
      promptCaching: false,
      temperatureRange: [0, 2],
      maxTokensField: 'max_tokens',
      maxTokensRequired: false,
    });
  });
});

describe('C. validateParams (fail-closed, une violation par cas)', () => {
  it('C.1 thinking actif sous capacité "none" -> throw', () => {
    expect(() =>
      validateParams({ thinking: { mode: 'budget', budgetTokens: 100 } }, CAPS_NONE, 16000),
    ).toThrow(GenerationParamsError);
    expect(() =>
      validateParams({ thinking: { mode: 'budget', budgetTokens: 100 } }, CAPS_NONE, 16000),
    ).toThrow(/non supporté par ce modèle/);
  });

  it('C.2 mode budget sans budgetTokens -> throw', () => {
    expect(() => validateParams({ thinking: { mode: 'budget' } }, CAPS_ANTHROPIC, 16000)).toThrow(
      GenerationParamsError,
    );
    expect(() => validateParams({ thinking: { mode: 'budget' } }, CAPS_ANTHROPIC, 16000)).toThrow(
      /le mode "budget" exige budgetTokens/,
    );
  });

  it('C.3 mode budget sous capacité openai-effort -> throw', () => {
    expect(() =>
      validateParams({ thinking: { mode: 'budget', budgetTokens: 100 } }, CAPS_OPENAI_GPT5, 16000),
    ).toThrow(GenerationParamsError);
    expect(() =>
      validateParams({ thinking: { mode: 'budget', budgetTokens: 100 } }, CAPS_OPENAI_GPT5, 16000),
    ).toThrow(/exige une capacité anthropic-budget ou gemini-budget/);
  });

  it('C.4 mode effort sans capacité openai-effort (anthropic) -> throw', () => {
    expect(() =>
      validateParams({ thinking: { mode: 'effort', effort: 'high' } }, CAPS_ANTHROPIC, 16000),
    ).toThrow(GenerationParamsError);
    expect(() =>
      validateParams({ thinking: { mode: 'effort', effort: 'high' } }, CAPS_ANTHROPIC, 16000),
    ).toThrow(/le mode "effort" exige la capacité openai-effort/);
  });

  it("C.5 effort 'extreme' hors enum -> throw", () => {
    const extremeEffort = 'extreme' as ThinkingParams['effort'];
    expect(() =>
      validateParams(
        { thinking: { mode: 'effort', effort: extremeEffort } },
        CAPS_OPENAI_GPT5,
        16000,
      ),
    ).toThrow(GenerationParamsError);
    expect(() =>
      validateParams(
        { thinking: { mode: 'effort', effort: extremeEffort } },
        CAPS_OPENAI_GPT5,
        16000,
      ),
    ).toThrow(/intensité de raisonnement doit valoir/);
  });

  it('C.6 précédence KKT : budget == plafond effectif (2000) -> throw', () => {
    expect(() =>
      validateParams({ thinking: { mode: 'budget', budgetTokens: 2000 } }, CAPS_ANTHROPIC, 2000),
    ).toThrow(GenerationParamsError);
    expect(() =>
      validateParams({ thinking: { mode: 'budget', budgetTokens: 2000 } }, CAPS_ANTHROPIC, 2000),
    ).toThrow(/strictement inférieur au plafond effectif/);
  });

  it('C.7 précédence KKT : budget 1999 < plafond effectif 2000 -> accepté', () => {
    expect(() =>
      validateParams({ thinking: { mode: 'budget', budgetTokens: 1999 } }, CAPS_ANTHROPIC, 2000),
    ).not.toThrow();
  });

  it('C.8 budget 0 -> throw', () => {
    expect(() =>
      validateParams({ thinking: { mode: 'budget', budgetTokens: 0 } }, CAPS_ANTHROPIC, 16000),
    ).toThrow(/entier >= 1/);
  });

  it('C.9 budget -5 -> throw', () => {
    expect(() =>
      validateParams({ thinking: { mode: 'budget', budgetTokens: -5 } }, CAPS_ANTHROPIC, 16000),
    ).toThrow(/entier >= 1/);
  });

  it('C.10 budget 1.5 (non entier) -> throw', () => {
    expect(() =>
      validateParams({ thinking: { mode: 'budget', budgetTokens: 1.5 } }, CAPS_ANTHROPIC, 16000),
    ).toThrow(/entier >= 1/);
  });

  it("C.11 temperature demandée sous capacité 'unsupported' (openai gpt-5) -> throw", () => {
    expect(() => validateParams({ temperature: 0.7 }, CAPS_OPENAI_GPT5)).toThrow(
      GenerationParamsError,
    );
    expect(() => validateParams({ temperature: 0.7 }, CAPS_OPENAI_GPT5)).toThrow(
      /rejetée par cette API/,
    );
  });

  it('C.12 temperature 1.5 hors bornes anthropic [0,1] -> throw', () => {
    expect(() => validateParams({ temperature: 1.5 }, CAPS_ANTHROPIC)).toThrow(
      GenerationParamsError,
    );
    expect(() => validateParams({ temperature: 1.5 }, CAPS_ANTHROPIC)).toThrow(
      /température 1\.5 hors des bornes admises \[0, 1\]/,
    );
  });

  it('C.13 temperature 0.5 dans bornes anthropic [0,1] -> acceptée', () => {
    expect(() => validateParams({ temperature: 0.5 }, CAPS_ANTHROPIC)).not.toThrow();
    expect(() => validateParams({ temperature: 0 }, CAPS_ANTHROPIC)).not.toThrow();
    expect(() => validateParams({ temperature: 1 }, CAPS_ANTHROPIC)).not.toThrow();
  });

  it('C.14 promptCaching true sans capacité -> throw', () => {
    expect(() => validateParams({ promptCaching: true }, CAPS_OPENAI_GPT5)).toThrow(
      GenerationParamsError,
    );
    expect(() => validateParams({ promptCaching: true }, CAPS_OPENAI_GPT5)).toThrow(
      /prompt caching demandé mais non supporté/,
    );
  });
});

describe('D. toWireParams (traduction filaire indexée par dialecte)', () => {
  it('D.1 anthropic-compatible : budget 8000 + maxTokens 16000 -> max_tokens + thinking enabled', () => {
    const wire = toWireParams(
      'anthropic-compatible',
      { thinking: { mode: 'budget', budgetTokens: 8000 }, maxTokens: 16000 },
      CAPS_ANTHROPIC,
      16000,
    );
    expect(wire).toEqual({
      max_tokens: 16000,
      thinking: { type: 'enabled', budget_tokens: 8000 },
    });
    expect(wire).not.toHaveProperty('temperature');
    expect(wire).not.toHaveProperty('reasoning_effort');
  });

  it('D.2 openai-compatible : gpt-5 effort high + maxTokens 4000 -> max_completion_tokens + reasoning_effort, PAS de temperature', () => {
    const wire = toWireParams(
      'openai-compatible',
      { thinking: { mode: 'effort', effort: 'high' }, maxTokens: 4000 },
      CAPS_OPENAI_GPT5,
    );
    expect(wire).toEqual({
      max_completion_tokens: 4000,
      reasoning_effort: 'high',
    });
    expect(wire).not.toHaveProperty('temperature');
    expect(wire).not.toHaveProperty('max_tokens');
    expect(wire).not.toHaveProperty('thinking');
  });

  it('D.3 gemini-native : budget 512 -> maxOutputTokens + thinkingConfig.thinkingBudget', () => {
    const wire = toWireParams(
      'gemini-native',
      { thinking: { mode: 'budget', budgetTokens: 512 }, maxTokens: 2000 },
      CAPS_GEMINI,
    );
    expect(wire).toEqual({
      maxOutputTokens: 2000,
      thinkingConfig: { thinkingBudget: 512 },
    });
    expect(wire).not.toHaveProperty('thinking');
    expect(wire).not.toHaveProperty('max_tokens');
  });

  it("D.4 mode 'off' : aucune clé de raisonnement émise (anthropic comme gemini)", () => {
    const wireAnthropic = toWireParams(
      'anthropic-compatible',
      { thinking: { mode: 'off' }, maxTokens: 100 },
      CAPS_ANTHROPIC,
    );
    expect(wireAnthropic).toEqual({ max_tokens: 100 });
    expect(wireAnthropic).not.toHaveProperty('thinking');

    const wireGemini = toWireParams(
      'gemini-native',
      { thinking: { mode: 'off' }, maxTokens: 100 },
      CAPS_GEMINI,
    );
    expect(wireGemini).toEqual({ maxOutputTokens: 100 });
    expect(wireGemini).not.toHaveProperty('thinkingConfig');
  });

  it('D.5 incohérence déclarée (max_completion_tokens sous anthropic-compatible) -> GenerationParamsError', () => {
    const capsIncoherentes: ModelCapabilities = {
      ...CAPS_ANTHROPIC,
      maxTokensField: 'max_completion_tokens',
    };
    expect(() =>
      toWireParams('anthropic-compatible', { maxTokens: 100 }, capsIncoherentes, 100),
    ).toThrow(GenerationParamsError);
    expect(() =>
      toWireParams('anthropic-compatible', { maxTokens: 100 }, capsIncoherentes, 100),
    ).toThrow(/incohérent avec le dialecte "anthropic-compatible"/);
  });

  it('D.6 maxTokensRequired true + aucun plafond (ni maxTokens ni effectif) -> GenerationParamsError', () => {
    expect(() => toWireParams('anthropic-compatible', {}, CAPS_ANTHROPIC)).toThrow(
      GenerationParamsError,
    );
    expect(() => toWireParams('anthropic-compatible', {}, CAPS_ANTHROPIC)).toThrow(
      /exige un plafond de jetons de sortie/,
    );
  });
});

describe('E. applyPromptCaching (immutabilité + convention d annotation)', () => {
  it('E.1 capacité absente -> RÉFÉRENCE d origine retournée (zéro copie)', () => {
    const messages: ChatMessage[] = [{ role: 'user', content: 'bonjour' }];
    expect(applyPromptCaching(messages, CAPS_NONE)).toBe(messages);
    // Famille gemini du JSON réel : prompt_caching false.
    expect(applyPromptCaching(messages, CAPS_GEMINI)).toBe(messages);
  });

  it('E.2 tableau vide -> RÉFÉRENCE d origine retournée', () => {
    const empty: ChatMessage[] = [];
    expect(applyPromptCaching(empty, CAPS_ANTHROPIC)).toBe(empty);
  });

  it('E.3 entrée non mutée + cache_control sur le dernier bloc du 1er system (priorité system > ordre)', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'avant le system' },
      {
        role: 'system',
        content: [
          { type: 'text', text: 'bloc A' },
          { type: 'text', text: 'bloc B' },
        ],
      },
      { role: 'system', content: 'second system' },
    ];
    const snapshot = structuredClone(messages) as ChatMessage[];

    const result = applyPromptCaching(messages, CAPS_ANTHROPIC);

    expect(result).not.toBe(messages);
    expect(messages).toEqual(snapshot);
    // L'annotation ne tombe PAS sur le message user pourtant premier.
    expect(result[0]).toEqual({ role: 'user', content: 'avant le system' });
    expect(result[1]?.content).toEqual([
      { type: 'text', text: 'bloc A' },
      { type: 'text', text: 'bloc B', cache_control: { type: 'ephemeral' } },
    ]);
    // Le second system n'est pas annoté.
    expect(result[2]).toEqual({ role: 'system', content: 'second system' });
  });

  it('E.4 system absent -> 1er message ; content string converti en bloc text annoté', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'premier' },
      { role: 'user', content: 'second' },
    ];
    const snapshot = structuredClone(messages) as ChatMessage[];

    const result = applyPromptCaching(messages, CAPS_ANTHROPIC);

    expect(result).not.toBe(messages);
    expect(messages).toEqual(snapshot);
    expect(result[0]?.content).toEqual([
      { type: 'text', text: 'premier', cache_control: { type: 'ephemeral' } },
    ]);
    expect(result[1]?.content).toBe('second');
  });

  it('E.5 aucun contenu annotable -> copie retournée, non annotée', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: '' },
      { role: 'assistant', content: null },
    ];

    const result = applyPromptCaching(messages, CAPS_ANTHROPIC);

    expect(result).not.toBe(messages);
    expect(result).toEqual(messages);
    expect(JSON.stringify(result)).not.toContain('cache_control');
  });
});

describe('F. Consommation moteurs de protocole (buildBody direct, sans fetch)', () => {
  it('F.1 openai-compatible : wireParams ont le dernier mot sur extra_body (temperature 0.9 écrasée par 0.5)', () => {
    const ctx: ProtocolContext = {
      model: 'gpt-5.2',
      apiKey: DUMMY_API_KEY,
      messages: [{ role: 'user', content: 'bonjour' }],
      options: {},
      protocolOptions: { extra_body: { temperature: 0.9 } },
      wireParams: { temperature: 0.5, max_completion_tokens: 1200 },
    };

    const body = openAICompatibleProtocol.buildBody(ctx);

    expect(body).toEqual({
      model: 'gpt-5.2',
      messages: [{ role: 'user', content: 'bonjour' }],
      temperature: 0.5,
      max_completion_tokens: 1200,
    });
    expect(body['temperature']).toBe(0.5);
    expect(body['max_completion_tokens']).toBe(1200);
  });

  it('F.2 anthropic-compatible : max_tokens filaire (3000) prime sur le plancher moteur (4096) + thinking fusionné', () => {
    const ctx: ProtocolContext = {
      model: 'claude-4-5-sonnet-20250929',
      apiKey: DUMMY_API_KEY,
      messages: [
        { role: 'system', content: 'Tu es utile.' },
        { role: 'user', content: 'Réfléchis.' },
      ],
      options: {},
      wireParams: {
        thinking: { type: 'enabled', budget_tokens: 2048 },
        max_tokens: 3000,
      },
    };

    const body = anthropicCompatibleProtocol.buildBody(ctx);

    expect(body).toEqual({
      model: 'claude-4-5-sonnet-20250929',
      max_tokens: 3000,
      system: 'Tu es utile.',
      messages: [{ role: 'user', content: 'Réfléchis.' }],
      thinking: { type: 'enabled', budget_tokens: 2048 },
    });
  });
});

describe('G. Adapters natifs via mockFetch : fusion wireParams', () => {
  it('G.1 openai.ts sans options.temperature -> corps SANS clé temperature (gpt-5)', async () => {
    mockFetch.mockResolvedValue(
      okJsonResponse({
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
      }),
    );

    const result = await openaiAdapter.chat([{ role: 'user', content: 'bonjour gpt' }], {
      model: 'gpt-5.2',
      apiKey: DUMMY_API_KEY,
    });

    const call = capturedCall();
    expect(call.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(call.headers).toEqual({
      Authorization: `Bearer ${DUMMY_API_KEY}`,
      'Content-Type': 'application/json',
    });
    expect(call.body).toEqual({
      model: 'gpt-5.2',
      messages: [{ role: 'user', content: 'bonjour gpt' }],
    });
    expect(call.body).not.toHaveProperty('temperature');
    expect(call.body).not.toHaveProperty('max_completion_tokens');
    expect(call.body).not.toHaveProperty('max_tokens');
    expect(result.content).toBe('ok');
  });

  it('G.2 openai.ts avec wireParams {temperature:0.7, max_completion_tokens:500} -> corps porte les deux', async () => {
    mockFetch.mockResolvedValue(
      okJsonResponse({
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      }),
    );

    await openaiAdapter.chat([{ role: 'user', content: 'bonjour gpt' }], {
      model: 'gpt-5.2',
      apiKey: DUMMY_API_KEY,
      wireParams: { temperature: 0.7, max_completion_tokens: 500 },
    });

    const call = capturedCall();
    expect(call.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(call.headers).toEqual({
      Authorization: `Bearer ${DUMMY_API_KEY}`,
      'Content-Type': 'application/json',
    });
    expect(call.body).toEqual({
      model: 'gpt-5.2',
      messages: [{ role: 'user', content: 'bonjour gpt' }],
      temperature: 0.7,
      max_completion_tokens: 500,
    });
  });

  it('G.3 anthropic.ts avec wireParams thinking + temperature -> body.thinking et body.temperature présents', async () => {
    mockFetch.mockResolvedValue(
      okJsonResponse({
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 3, output_tokens: 4 },
      }),
    );

    await anthropicAdapter.chat([{ role: 'user', content: 'salut anthropic' }], {
      model: 'claude-4-5-sonnet-20250929',
      apiKey: DUMMY_API_KEY,
      wireParams: {
        thinking: { type: 'enabled', budget_tokens: 800 },
        temperature: 0.4,
      },
    });

    const call = capturedCall();
    expect(call.url).toBe('https://api.anthropic.com/v1/messages');
    expect(call.headers).toEqual({
      'x-api-key': DUMMY_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    });
    expect(call.body).toEqual({
      model: 'claude-4-5-sonnet-20250929',
      max_tokens: 4096,
      system: '',
      messages: [{ role: 'user', content: 'salut anthropic' }],
      thinking: { type: 'enabled', budget_tokens: 800 },
      temperature: 0.4,
    });
  });

  it('G.4 anthropic.ts sans wireParams ni options.max_tokens -> max_tokens = 4096 (plancher)', async () => {
    mockFetch.mockResolvedValue(
      okJsonResponse({
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn',
      }),
    );

    await anthropicAdapter.chat([{ role: 'user', content: 'salut anthropic' }], {
      model: 'claude-4-5-sonnet-20250929',
      apiKey: DUMMY_API_KEY,
    });

    const call = capturedCall();
    expect(call.body).toEqual({
      model: 'claude-4-5-sonnet-20250929',
      max_tokens: 4096,
      system: '',
      messages: [{ role: 'user', content: 'salut anthropic' }],
    });
    expect(call.body).not.toHaveProperty('thinking');
    expect(call.body).not.toHaveProperty('temperature');
  });

  it('G.5 gemini.ts avec options.max_tokens 777 -> generationConfig.maxOutputTokens === 777 (régression plafond figé à 1000)', async () => {
    mockFetch.mockResolvedValue(
      okJsonResponse({
        candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
        usageMetadata: {},
      }),
    );

    const result = await geminiAdapter.chat([{ role: 'user', content: 'salut gemini' }], {
      model: 'gemini-2.5-flash',
      apiKey: DUMMY_API_KEY,
      max_tokens: 777,
    });

    const call = capturedCall();
    expect(call.url).toBe(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${DUMMY_API_KEY}`,
    );
    expect(call.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(call.body).toEqual({
      contents: [{ role: 'user', parts: [{ text: 'salut gemini' }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 777 },
    });
    const generationConfig = call.body['generationConfig'] as Record<string, unknown>;
    expect(generationConfig['maxOutputTokens']).toBe(777);
    expect(result.content).toBe('ok');
  });

  it('G.6 gemini.ts : wireParams {maxOutputTokens:9000, thinkingConfig:{thinkingBudget:300}} priment sur options.max_tokens', async () => {
    mockFetch.mockResolvedValue(
      okJsonResponse({
        candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
        usageMetadata: {},
      }),
    );

    await geminiAdapter.chat([{ role: 'user', content: 'salut gemini' }], {
      model: 'gemini-2.5-flash',
      apiKey: DUMMY_API_KEY,
      max_tokens: 777,
      wireParams: { maxOutputTokens: 9000, thinkingConfig: { thinkingBudget: 300 } },
    });

    const call = capturedCall();
    expect(call.body).toEqual({
      contents: [{ role: 'user', parts: [{ text: 'salut gemini' }] }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 9000,
        thinkingConfig: { thinkingBudget: 300 },
      },
    });
    const generationConfig = call.body['generationConfig'] as Record<string, unknown>;
    expect(generationConfig['maxOutputTokens']).toBe(9000);
    expect(generationConfig['thinkingConfig']).toEqual({ thinkingBudget: 300 });
  });
});
