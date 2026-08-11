/**
 * @license
 * Copyright 2025 HIVE-MIND
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';
import {
  getSettingsSchema,
  type SettingDefinition,
  type SettingCollectionDefinition,
  SETTINGS_SCHEMA_DEFINITIONS,
} from './hiveSettingsSchema.js';

interface JsonSchemaDef {
  type?: string;
  anyOf?: JsonSchemaDef[];
  items?: JsonSchemaDef;
  enum?: string[];
  properties?: Record<string, JsonSchemaDef>;
  required?: string[];
  [key: string]: unknown;
}

function buildObjectSchemaFromJson(def: JsonSchemaDef): z.ZodTypeAny {
  let schema;
  if (def.properties) {
    const shape = new Map<string, z.ZodTypeAny>();
    for (const [key, propDef] of Object.entries(def.properties)) {
      let propSchema = buildZodSchemaFromJsonSchema(propDef);
      if (def.required && Array.isArray(def.required) && def.required.includes(key)) {
        // keep it required
      } else {
        propSchema = propSchema.optional();
      }
      shape.set(key, propSchema);
    }
    schema = z.object(Object.fromEntries(shape)).passthrough();
  } else {
    schema = z.object({}).passthrough();
  }

  if (def.additionalProperties === false) {
    schema = schema.strict();
  } else if (def.additionalProperties && typeof def.additionalProperties === 'object') {
    schema = schema.catchall(
      buildZodSchemaFromJsonSchema(def.additionalProperties as JsonSchemaDef),
    );
  }

  return schema;
}

// Helper to build Zod schema from the JSON-schema-like definitions
function buildZodSchemaFromJsonSchema(def: JsonSchemaDef): z.ZodTypeAny {
  if (def.anyOf) {
    return z.union(
      def.anyOf.map((d: JsonSchemaDef) => buildZodSchemaFromJsonSchema(d)) as unknown as [
        z.ZodTypeAny,
        z.ZodTypeAny,
        ...z.ZodTypeAny[],
      ],
    );
  }

  if (def.type === 'string') {
    if (def.enum) return z.enum(def.enum as [string, ...string[]]);
    return buildPrimitiveSchema('string');
  }
  if (def.type === 'number') return buildPrimitiveSchema('number');
  if (def.type === 'boolean') return buildPrimitiveSchema('boolean');

  if (def.type === 'array') {
    if (def.items) {
      return z.array(buildZodSchemaFromJsonSchema(def.items));
    }
    return z.array(z.unknown());
  }

  if (def.type === 'object') {
    return buildObjectSchemaFromJson(def);
  }

  return z.unknown();
}

/**
 * Builds a Zod enum schema from options array
 */
function buildEnumSchema(
  options: ReadonlyArray<{ value: string | number | boolean; label: string }>,
): z.ZodTypeAny {
  if (!options || options.length === 0) {
    throw new Error('Enum type must have options defined. Check your settings schema definition.');
  }
  const values = options.map((opt) => opt.value);
  if (values.every((v) => typeof v === 'string')) {
    return z.enum(values as [string, ...string[]]);
  }
  return z.union(
    values.map((v) => z.literal(v)) as unknown as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]],
  );
}

/**
 * Builds a Zod object shape from properties record
 */
function buildObjectShapeFromProperties(
  properties: Record<string, SettingDefinition>,
): Record<string, z.ZodTypeAny> {
  const shape = new Map<string, z.ZodTypeAny>();
  for (const [key, childDef] of Object.entries(properties)) {
    shape.set(key, buildZodSchemaFromDefinition(childDef));
  }
  return Object.fromEntries(shape);
}

/**
 * Builds a Zod schema for primitive types (string, number, boolean)
 */
function buildPrimitiveSchema(type: 'string' | 'number' | 'boolean'): z.ZodTypeAny {
  switch (type) {
    case 'string':
      return z.string();
    case 'number':
      return z.preprocess((val) => {
        if (typeof val === 'string' && val.trim() !== '') {
          const num = Number(val);
          if (!isNaN(num)) return num;
        }
        return val;
      }, z.number());
    case 'boolean':
      return z.preprocess((val) => {
        if (typeof val === 'string') {
          const lower = val.toLowerCase();
          if (lower === 'true') return true;
          if (lower === 'false') return false;
        }
        return val;
      }, z.boolean());
    default:
      return z.unknown();
  }
}

const REF_SCHEMAS = new Map<string, z.ZodTypeAny>();

// Initialize REF_SCHEMAS
for (const [name, def] of Object.entries(SETTINGS_SCHEMA_DEFINITIONS)) {
  REF_SCHEMAS.set(name, buildZodSchemaFromJsonSchema(def as JsonSchemaDef));
}

function buildObjectFromDefinition(definition: SettingDefinition): z.ZodTypeAny {
  if (definition.properties) {
    const shape = buildObjectShapeFromProperties(definition.properties);
    let baseSchema = z.object(shape).passthrough();

    if (definition.additionalProperties) {
      const additionalSchema = buildZodSchemaFromCollection(definition.additionalProperties);
      baseSchema = z.object(shape).catchall(additionalSchema);
    }
    return baseSchema;
  }
  if (definition.additionalProperties) {
    const valueSchema = buildZodSchemaFromCollection(definition.additionalProperties);
    return z.record(z.string(), valueSchema);
  }
  return z.record(z.string(), z.unknown());
}

/**
 * Recursively builds a Zod schema from a SettingDefinition
 */
function buildZodSchemaFromDefinition(definition: SettingDefinition): z.ZodTypeAny {
  let baseSchema: z.ZodTypeAny;

  // Special handling for TelemetrySettings which can be boolean or object
  if (definition.ref === 'TelemetrySettings') {
    const objectSchema = REF_SCHEMAS.get('TelemetrySettings');
    if (objectSchema) {
      return z.union([buildPrimitiveSchema('boolean'), objectSchema]).optional();
    }
  }

  // Handle refs using registry
  if (definition.ref && REF_SCHEMAS.has(definition.ref)) {
    return REF_SCHEMAS.get(definition.ref)!.optional();
  }

  switch (definition.type) {
    case 'string':
    case 'number':
    case 'boolean':
      baseSchema = buildPrimitiveSchema(definition.type);
      break;

    case 'enum': {
      baseSchema = buildEnumSchema(definition.options!);
      break;
    }

    case 'array':
      if (definition.items) {
        const itemSchema = buildZodSchemaFromCollection(definition.items);
        baseSchema = z.array(itemSchema);
      } else {
        baseSchema = z.array(z.unknown());
      }
      break;

    case 'object':
      baseSchema = buildObjectFromDefinition(definition);
      break;

    default:
      baseSchema = z.unknown();
  }

  // Make all fields optional since settings are partial
  return baseSchema.optional();
}

/**
 * Builds a Zod schema from a SettingCollectionDefinition
 */
function buildZodSchemaFromCollection(collection: SettingCollectionDefinition): z.ZodTypeAny {
  if (collection.ref && REF_SCHEMAS.has(collection.ref)) {
    return REF_SCHEMAS.get(collection.ref)!;
  }

  switch (collection.type) {
    case 'string':
    case 'number':
    case 'boolean':
      return buildPrimitiveSchema(collection.type);

    case 'enum': {
      return buildEnumSchema(collection.options!);
    }

    case 'array':
      if (collection.properties) {
        const shape = buildObjectShapeFromProperties(collection.properties);
        return z.array(z.object(shape));
      }
      return z.array(z.unknown());

    case 'object':
      if (collection.properties) {
        const shape = buildObjectShapeFromProperties(collection.properties);
        return z.object(shape).passthrough();
      }
      return z.record(z.string(), z.unknown());

    default:
      return z.unknown();
  }
}

/**
 * Builds the complete Zod schema for Settings from SETTINGS_SCHEMA
 */
function buildSettingsZodSchema(): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const schema = getSettingsSchema();
  const shape = new Map<string, z.ZodTypeAny>();

  for (const [key, definition] of Object.entries(schema)) {
    shape.set(key, buildZodSchemaFromDefinition(definition));
  }

  return z.object(Object.fromEntries(shape)).passthrough();
}

export const settingsZodSchema = buildSettingsZodSchema();

/**
 * Validates settings data against the Zod schema
 */
export function validateSettings(data: unknown): {
  success: boolean;
  data?: unknown;
  error?: z.ZodError;
} {
  const result = settingsZodSchema.safeParse(data);
  return result;
}

/**
 * Format a Zod error into a helpful error message
 */
export function formatValidationError(error: z.ZodError, filePath: string): string {
  const lines: string[] = [];
  lines.push(`Invalid configuration in ${filePath}:`);
  lines.push('');

  const MAX_ERRORS_TO_DISPLAY = 5;
  const displayedIssues = error.issues.slice(0, MAX_ERRORS_TO_DISPLAY);

  for (const issue of displayedIssues) {
    const pathStr = issue.path.reduce((acc: string, curr: string | number | symbol): string => {
      const keyStr = String(curr);
      const prefix = acc ? `${acc}.` : '';
      return typeof curr === 'number' ? `${acc}[${curr}]` : `${prefix}${keyStr}`;
    }, '');
    lines.push(`Error in: ${String(pathStr) || '(root)'}`);
    lines.push(`    ${issue.message}`);

    if (issue.code === 'invalid_type') {
      const expected = (issue as unknown as Record<string, unknown>).expected;
      const received = (issue as unknown as Record<string, unknown>).received;
      lines.push(`Expected: ${expected}, but received: ${received}`);
    }
    lines.push('');
  }

  if (error.issues.length > MAX_ERRORS_TO_DISPLAY) {
    lines.push(`...and ${error.issues.length - MAX_ERRORS_TO_DISPLAY} more errors.`);
    lines.push('');
  }

  lines.push('Please fix the configuration.');
  lines.push('See HIVE-MIND documentation for reference.');

  return lines.join('\n');
}
