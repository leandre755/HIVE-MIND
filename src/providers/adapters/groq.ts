// providers/adapters/groq.ts
// Adaptateur pour Groq (LPU Inference Engine)
// Base URL: https://api.groq.com/openai/v1

import type {
  AdapterChatOptions,
  AdapterChatResult,
  ApiErrorResponse,
  ChatMessage,
  OpenAIChatRequestBody,
  ProviderAdapter,
  TokenUsage,
} from '../types.js';
import { requireModel } from '../requireModel.js';
import {
  convertMessagesForOpenAI,
  convertResponseForOpenAI,
} from '../families/protocols/messageConverter.js';

export default {
  name: 'groq',

  /**
   * Appel Groq Cloud
   */
  async chat(messages: ChatMessage[], options: AdapterChatOptions): Promise<AdapterChatResult> {
    const { model, apiKey, tools, temperature, max_tokens, version = 'latest' } = options;
    const modelId = requireModel(model, 'Groq Adapter');

    const wireMessages = convertMessagesForOpenAI(messages) as unknown as ChatMessage[];

    const body: OpenAIChatRequestBody = {
      model: modelId,
      messages: wireMessages,
    };
    if (typeof temperature === 'number') body.temperature = temperature;
    if (typeof max_tokens === 'number') body.max_tokens = max_tokens;

    // Note: Building tools are only for groq/compound models
    // Custom tools are not supported yet according to docs
    if (tools?.length && !modelId.includes('compound')) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    };

    // Header spécial pour Groq Compound
    if (modelId.includes('compound')) {
      headers['Groq-Model-Version'] = version;
    }

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = (await response.json()) as ApiErrorResponse;
      throw new Error(error.error?.message || `Erreur Groq (${response.status})`);
    }

    const data = (await response.json()) as Record<string, unknown>;
    const conversion = convertResponseForOpenAI(data);
    const choices = data['choices'] as Record<string, unknown>[] | undefined;
    const firstChoice = choices?.[0];
    const message = firstChoice?.['message'] as Record<string, unknown> | undefined;

    return {
      content: conversion.content,
      toolCalls: conversion.toolCalls,
      reasoningContent: conversion.reasoningContent,
      executedTools: (message?.['executed_tools'] as unknown[] | undefined) || null, // Nouveauté Groq Compound
      finishReason:
        typeof firstChoice?.['finish_reason'] === 'string'
          ? firstChoice['finish_reason']
          : undefined,
      usage: data['usage'] as TokenUsage | undefined,
      usageBreakdown: data['usage_breakdown'] ?? null, // Détails des modèles sous-jacents
    };
  },
} satisfies ProviderAdapter;
