/**
 * src/providers/adapters/registry.ts
 *
 * Registre statique des adaptateurs de fournisseurs de modèles natifs.
 * Élimine les imports dynamiques calculés au runtime pour permettre
 * un bundling autonome et déterministe (Node SEA, Bun compile, esbuild).
 */

import anthropicAdapter from './anthropic.js';
import cloudflareAdapter from './cloudflare.js';
import cohereAdapter from './cohere.js';
import geminiAdapter from './gemini.js';
import groqAdapter from './groq.js';
import huggingfaceAdapter from './huggingface.js';
import modalAdapter from './modal.js';
import openaiAdapter from './openai.js';
import type { ProviderAdapter } from '../types.js';

export const adapterRegistry: Readonly<Record<string, ProviderAdapter>> = Object.freeze({
  openai: openaiAdapter,
  gemini: geminiAdapter,
  anthropic: anthropicAdapter,
  groq: groqAdapter,
  huggingface: huggingfaceAdapter,
  cohere: cohereAdapter,
  cloudflare: cloudflareAdapter,
  modal: modalAdapter,
});
