/**
 * Layer 1 Service Registry
 *
 * Loads service recipes, chat category recipes, and reliability defaults from
 * services_config.json and models_config.json. Resolves model fallback chains.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { safeExistsSync, safeReadFileSync } from '../../utils/safeFs.js';
import { ModelRegistry } from '../layer0/ModelRegistry.js';

export interface ReliabilityDefaults {
  max_attempts: number;
  deadline_ms: number;
  per_attempt_timeout_ms: number;
  minimum_throughput: number;
  failure_ratio_threshold: number;
}

export interface ResolvedRecipe {
  name: string;
  models: string[];
  temperature?: number;
  family?: string;
  maxAttempts: number;
  deadlineMs: number;
  timeoutMs: number;
  rawRecipe?: Record<string, unknown>;
}

const DEFAULT_RELIABILITY: ReliabilityDefaults = {
  max_attempts: 4,
  deadline_ms: 120000,
  per_attempt_timeout_ms: 45000,
  minimum_throughput: 10,
  failure_ratio_threshold: 0.5,
};

const moduleDirname = dirname(fileURLToPath(import.meta.url));

export function defaultServicesConfigPath(): string {
  const relPath = join(moduleDirname, '../../config/services_config.json');
  if (safeExistsSync(relPath)) return relPath;
  const rootPath = join(process.cwd(), 'src/config/services_config.json');
  if (safeExistsSync(rootPath)) return rootPath;
  return relPath;
}

export class ServiceRegistry {
  private static instance: ServiceRegistry | null = null;

  private reliabilityDefaults: ReliabilityDefaults = { ...DEFAULT_RELIABILITY };
  private serviceRecipes: Map<string, Record<string, unknown>> = new Map();
  private chatCategories: Map<string, Record<string, unknown>> = new Map();

  constructor(configPathOrObject?: string | Record<string, unknown>) {
    this.load(configPathOrObject);
  }

  public static getInstance(): ServiceRegistry {
    if (!ServiceRegistry.instance) {
      ServiceRegistry.instance = new ServiceRegistry();
    }
    return ServiceRegistry.instance;
  }

  public static resetInstance(): void {
    ServiceRegistry.instance = null;
  }

  public load(configPathOrObject?: string | Record<string, unknown>): void {
    let data: Record<string, unknown>;
    if (typeof configPathOrObject === 'object' && configPathOrObject !== null) {
      data = configPathOrObject;
    } else {
      const filePath = configPathOrObject ?? defaultServicesConfigPath();
      const content = safeReadFileSync(filePath, 'utf-8');
      data = JSON.parse(content) as Record<string, unknown>;
    }

    this.loadReliabilityDefaults(data);
    this.loadServiceRecipes(data);
    this.loadChatCategories(data);
  }

  private loadReliabilityDefaults(data: Record<string, unknown>): void {
    const rd = Reflect.get(data, 'reliability_defaults');
    if (typeof rd === 'object' && rd !== null) {
      const rdObj = rd as Record<string, unknown>;
      this.reliabilityDefaults = {
        max_attempts:
          typeof rdObj['max_attempts'] === 'number'
            ? rdObj['max_attempts']
            : DEFAULT_RELIABILITY.max_attempts,
        deadline_ms:
          typeof rdObj['deadline_ms'] === 'number'
            ? rdObj['deadline_ms']
            : DEFAULT_RELIABILITY.deadline_ms,
        per_attempt_timeout_ms:
          typeof rdObj['per_attempt_timeout_ms'] === 'number'
            ? rdObj['per_attempt_timeout_ms']
            : DEFAULT_RELIABILITY.per_attempt_timeout_ms,
        minimum_throughput:
          typeof rdObj['minimum_throughput'] === 'number'
            ? rdObj['minimum_throughput']
            : DEFAULT_RELIABILITY.minimum_throughput,
        failure_ratio_threshold:
          typeof rdObj['failure_ratio_threshold'] === 'number'
            ? rdObj['failure_ratio_threshold']
            : DEFAULT_RELIABILITY.failure_ratio_threshold,
      };
    }
  }

  private loadServiceRecipes(data: Record<string, unknown>): void {
    this.serviceRecipes.clear();
    const recipes = Reflect.get(data, 'service_recipes');
    if (typeof recipes === 'object' && recipes !== null) {
      for (const [key, value] of Object.entries(recipes as Record<string, unknown>)) {
        if (typeof value === 'object' && value !== null) {
          this.serviceRecipes.set(key, value as Record<string, unknown>);
        }
      }
    }
  }

  private loadChatCategories(data: Record<string, unknown>): void {
    this.chatCategories.clear();
    const chatRecipes = Reflect.get(data, 'chat_recipes');
    if (typeof chatRecipes === 'object' && chatRecipes !== null) {
      const categories = Reflect.get(chatRecipes as Record<string, unknown>, 'categories');
      if (typeof categories === 'object' && categories !== null) {
        for (const [key, value] of Object.entries(categories as Record<string, unknown>)) {
          if (typeof value === 'object' && value !== null) {
            this.chatCategories.set(key, value as Record<string, unknown>);
          }
        }
      }
    }
  }

  public getReliabilityDefaults(): ReliabilityDefaults {
    return { ...this.reliabilityDefaults };
  }

  private extractModelsFromRawRecipe(raw: Record<string, unknown>): string[] {
    const models: string[] = [];
    let primary: string | undefined;
    if (typeof raw['model'] === 'string') {
      primary = raw['model'];
    } else if (typeof raw['primary'] === 'string') {
      primary = raw['primary'];
    }
    if (primary) models.push(primary);

    for (let i = 1; i <= 5; i++) {
      const key = i === 1 ? 'fallback' : `fallback_${i}`;
      const fb = Reflect.get(raw, key);
      if (typeof fb === 'string' && fb.length > 0 && !models.includes(fb)) {
        models.push(fb);
      }
    }
    return models;
  }

  public getRecipe(serviceOrCategory: string): ResolvedRecipe {
    const name = serviceOrCategory.trim();

    if (this.serviceRecipes.has(name)) {
      const raw = this.serviceRecipes.get(name)!;
      const models = this.extractModelsFromRawRecipe(raw);
      const temp = typeof raw['temperature'] === 'number' ? raw['temperature'] : undefined;
      const family = typeof raw['family'] === 'string' ? raw['family'] : undefined;

      return {
        name,
        models,
        temperature: temp,
        family,
        maxAttempts: this.reliabilityDefaults.max_attempts,
        deadlineMs: this.reliabilityDefaults.deadline_ms,
        timeoutMs: this.reliabilityDefaults.per_attempt_timeout_ms,
        rawRecipe: raw,
      };
    }

    if (this.chatCategories.has(name)) {
      const raw = this.chatCategories.get(name)!;
      const models = this.extractModelsFromRawRecipe(raw);
      return {
        name,
        models,
        maxAttempts: this.reliabilityDefaults.max_attempts,
        deadlineMs: this.reliabilityDefaults.deadline_ms,
        timeoutMs: this.reliabilityDefaults.per_attempt_timeout_ms,
        rawRecipe: raw,
      };
    }

    let family: string | undefined;
    try {
      if (ModelRegistry.getInstance().hasModel(name)) {
        family = ModelRegistry.getInstance().getModelConfig(name).provider;
      }
    } catch {
      // Ignore
    }

    return {
      name,
      models: [name],
      family,
      maxAttempts: this.reliabilityDefaults.max_attempts,
      deadlineMs: this.reliabilityDefaults.deadline_ms,
      timeoutMs: this.reliabilityDefaults.per_attempt_timeout_ms,
    };
  }
}

export const serviceRegistry = ServiceRegistry.getInstance();
