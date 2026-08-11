/**
 * Layer 0 Model Registry
 *
 * Loads models_config.json and resolves the configuration for each model.
 */

import { join } from 'node:path';
import { safeExistsSync, safeReadFileSync } from '../../utils/safeFs.js';
import {
  ModelCapabilities,
  ProtocolDialect,
  resolveCapabilities,
  resolveProtocolDialect,
} from '../GenerationParams.js';
import {
  validateCrossReferences,
  validateModelsConfig,
  validateServicesConfig,
} from './configValidator.js';
import { InvalidRequestError } from './errors.js';

export interface ResolvedModelConfig {
  modelId: string;
  provider: string;
  base_url?: string;
  protocol_family: ProtocolDialect;
  header_family: string;
  capabilities: ModelCapabilities;
  familyConfig?: Record<string, unknown>;
  modelMeta?: Record<string, unknown>;
}

export function defaultModelsConfigPath(): string {
  const cwdPath = join(process.cwd(), 'src/config/models_config.json');
  if (safeExistsSync(cwdPath)) return cwdPath;
  const rootPath = join(process.cwd(), 'config/models_config.json');
  if (safeExistsSync(rootPath)) return rootPath;
  return cwdPath;
}

/**
 * Resolves the default path for services_config.json.
 * Uses the same cwd-based resolution as defaultModelsConfigPath() to avoid
 * importing ServiceRegistry (which would create a circular dependency).
 */
function defaultServicesConfigPath(): string {
  const cwdPath = join(process.cwd(), 'src/config/services_config.json');
  if (safeExistsSync(cwdPath)) return cwdPath;
  const rootPath = join(process.cwd(), 'config/services_config.json');
  if (safeExistsSync(rootPath)) return rootPath;
  return cwdPath;
}

/**
 * Reads and parses a JSON file synchronously, returning undefined on failure.
 * Used for optional config loading (services_config.json) where absence is non-fatal.
 */
function tryReadJson(filePath: string): Record<string, unknown> | undefined {
  try {
    const content = safeReadFileSync(filePath, 'utf-8');
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

export class ModelRegistry {
  private static instance: ModelRegistry | null = null;
  private modelMap: Map<string, ResolvedModelConfig> = new Map();
  private rawConfig: Record<string, unknown> = {};

  constructor(configPathOrObject?: string | Record<string, unknown>) {
    this.load(configPathOrObject);
  }

  public load(configPathOrObject?: string | Record<string, unknown>): void {
    let configData: Record<string, unknown>;
    if (typeof configPathOrObject === 'object' && configPathOrObject !== null) {
      configData = configPathOrObject;
    } else {
      const filePath = configPathOrObject ?? defaultModelsConfigPath();
      const content = safeReadFileSync(filePath, 'utf-8');
      configData = JSON.parse(content) as Record<string, unknown>;
    }
    this.rawConfig = configData;
    this.buildIndex(configData);
    this.runConfigValidation(configData);
  }

  /**
   * Runs structural validation on both config files (warn-only).
   * Loads services_config.json independently to enable cross-reference checks.
   * Validation failures are logged as warnings and never block boot.
   */
  private runConfigValidation(modelsConfig: Record<string, unknown>): void {
    try {
      validateModelsConfig(modelsConfig);
    } catch (err) {
      console.warn('[ModelRegistry] models_config validation failed:', (err as Error).message);
    }

    const servicesConfig = tryReadJson(defaultServicesConfigPath());
    if (servicesConfig === undefined) {
      console.warn(
        '[ModelRegistry] services_config.json not found — skipping service validations.',
      );
      return;
    }

    try {
      validateServicesConfig(servicesConfig);
    } catch (err) {
      console.warn('[ModelRegistry] services_config validation failed:', (err as Error).message);
    }

    try {
      validateCrossReferences(modelsConfig, servicesConfig);
    } catch (err) {
      console.warn('[ModelRegistry] cross-reference validation failed:', (err as Error).message);
    }
  }

  private buildIndex(configData: Record<string, unknown>): void {
    this.modelMap.clear();
    const familles = (Reflect.get(configData, 'familles') ?? {}) as Record<
      string,
      Record<string, unknown>
    >;
    for (const [providerName, familyEntry] of Object.entries(familles)) {
      if (typeof familyEntry === 'object' && familyEntry !== null) {
        this.indexFamily(providerName, familyEntry);
      }
    }
  }

  private indexFamily(providerName: string, familyEntry: Record<string, unknown>): void {
    let protocolFamily: ProtocolDialect;
    try {
      protocolFamily = resolveProtocolDialect(providerName, familyEntry);
    } catch {
      if (typeof familyEntry['base_url'] === 'string' && familyEntry['base_url'].length > 0) {
        protocolFamily = 'openai-compatible';
      } else {
        return;
      }
    }

    const headerFamily = this.resolveHeaderFamily(familyEntry);
    const rawBaseUrl = familyEntry['base_url'];
    const baseUrl = typeof rawBaseUrl === 'string' ? rawBaseUrl : undefined;

    const modeles = Array.isArray(familyEntry['modeles']) ? familyEntry['modeles'] : [];
    for (const m of modeles) {
      if (typeof m !== 'object' || m === null) continue;
      const mObj = m as Record<string, unknown>;
      const modelId = mObj['id'];
      if (typeof modelId !== 'string' || modelId.length === 0) continue;

      const capabilities = resolveCapabilities(modelId, familyEntry);
      this.warnIfCollision(modelId, providerName);

      this.modelMap.set(modelId, {
        modelId,
        provider: providerName,
        base_url: baseUrl,
        protocol_family: protocolFamily,
        header_family: headerFamily,
        capabilities,
        familyConfig: familyEntry,
        modelMeta: mObj,
      });
    }
  }

  private resolveHeaderFamily(familyEntry: Record<string, unknown>): string {
    const rawHeaderName = familyEntry['header_family'];
    if (typeof rawHeaderName === 'string' && rawHeaderName.trim().length > 0) {
      return rawHeaderName.trim();
    }
    return 'standard-bearer';
  }

  private warnIfCollision(modelId: string, providerName: string): void {
    if (!this.modelMap.has(modelId)) return;
    const existing = this.modelMap.get(modelId);
    if (existing) {
      console.warn(
        '[ModelRegistry] Collision: ' +
          modelId +
          ' dans ' +
          existing.provider +
          ' et ' +
          providerName,
      );
    }
  }

  public getModelConfig(modelId: string): ResolvedModelConfig {
    const modelConfig = this.modelMap.get(modelId);
    if (!modelConfig) {
      throw new InvalidRequestError(`Model "${modelId}" is not registered in models_config.json`, {
        providerCode: 'MODEL_NOT_FOUND',
      });
    }
    return modelConfig;
  }

  public hasModel(modelId: string): boolean {
    return this.modelMap.has(modelId);
  }

  public listModels(): string[] {
    return Array.from(this.modelMap.keys());
  }

  public getRawConfig(): Record<string, unknown> {
    return this.rawConfig;
  }

  public static getInstance(): ModelRegistry {
    if (!ModelRegistry.instance) {
      ModelRegistry.instance = new ModelRegistry();
    }
    return ModelRegistry.instance;
  }

  public static resetInstance(): void {
    ModelRegistry.instance = null;
  }
}

export function getModelConfig(modelId: string): ResolvedModelConfig {
  return ModelRegistry.getInstance().getModelConfig(modelId);
}
