/**
 * utils/toolValidator.ts
 *
 * Global Tool validation logic to verify parameters against JSON Schema
 * before allowing tool execution. Employs Ajv for strict validation
 * and formats errors in a clear, natural language format for the LLM.
 */

import createAjv from 'ajv';

const ajv = new createAjv({ allErrors: true, strict: false });

export interface ToolDefParameter {
  type?: string;
  additionalProperties?: boolean;
  required?: string[];
  properties?: Record<string, unknown>;
}

export interface ToolDef {
  function?: {
    name?: string;
    parameters?: ToolDefParameter;
  };
}

function cleanupEmptyArgs(args: Record<string, unknown>): void {
  for (const key of Object.keys(args)) {
    const val = Reflect.get(args, key);
    if (val === '' || val === null) {
      Reflect.deleteProperty(args, key);
    }
  }
}

function parseAndCleanupArgs(toolArgs: string): Record<string, unknown> | null {
  if (!toolArgs || toolArgs.trim() === '') return {};
  try {
    const parsed = JSON.parse(toolArgs) as Record<string, unknown>;
    cleanupEmptyArgs(parsed);
    return parsed;
  } catch {
    return null;
  }
}

function prepareSchema(toolName: string, parameters: ToolDefParameter): Record<string, unknown> {
  const schema = { ...parameters } as Record<string, unknown>;

  // [FALLBACK] Dynamically remove 'name' constraint for browser_screenshot
  if (toolName === 'browser_screenshot' && Array.isArray(schema.required)) {
    schema.required = schema.required.filter((param) => param !== 'name');
  }

  // Enforce no additional properties to detect LLM hallucinations
  if (schema.type === 'object' && schema.additionalProperties === undefined) {
    schema.additionalProperties = false;
  }

  return schema;
}

function formatSingleAjvError(
  err: { keyword: string; params: Record<string, unknown>; instancePath: string; message?: string },
  parsedArgs: Record<string, unknown>,
): string {
  if (err.keyword === 'required') {
    return `The required parameter '${err.params.missingProperty}' is missing.`;
  }
  if (err.keyword === 'additionalProperties') {
    return `An unexpected parameter '${err.params.additionalProperty}' was provided.`;
  }
  if (err.keyword === 'type') {
    const prop = err.instancePath.replace(/^\//, '');
    const val = prop ? Reflect.get(parsedArgs, prop) : undefined;
    const providedType = val !== undefined ? typeof val : 'undefined';
    return `The parameter '${prop}' type is expected as '${err.params.type}' but provided as '${providedType}'.`;
  }
  return `Parameter error at '${err.instancePath}': ${err.message}.`;
}

function formatAjvErrors(
  errors: unknown[] | null,
  parsedArgs: Record<string, unknown>,
): { missing: string[]; formattedError: string } {
  const missing: string[] = [];
  const errorMessages: string[] = [];
  const errList = (errors || []) as Array<{
    keyword: string;
    params: Record<string, unknown>;
    instancePath: string;
    message?: string;
  }>;

  for (const err of errList) {
    if (err.keyword === 'required' && err.params.missingProperty) {
      missing.push(err.params.missingProperty as string);
    }
    errorMessages.push(formatSingleAjvError(err, parsedArgs));
  }

  const formattedError = `<tool_use_error>InputValidationError: ${errorMessages.join(' ')}</tool_use_error>`;
  return { missing, formattedError };
}

export function validateToolArgs(
  toolName: string,
  toolArgs: string,
  toolDefs: ToolDef[],
): { valid: boolean; missing: string[]; schema: unknown; formattedError?: string } {
  const toolDef = toolDefs.find((t) => t.function?.name === toolName);
  if (!toolDef?.function?.parameters) return { valid: true, missing: [], schema: null };

  const parsedArgs = parseAndCleanupArgs(toolArgs);
  if (!parsedArgs) {
    return {
      valid: false,
      missing: ['(unparseable JSON)'],
      schema: toolDef.function.parameters,
      formattedError:
        '<tool_use_error>InputValidationError: Failed to parse JSON.</tool_use_error>',
    };
  }

  const schema = prepareSchema(toolName, toolDef.function.parameters);
  const validate = ajv.compile(schema);
  if (validate(parsedArgs)) return { valid: true, missing: [], schema };

  const { missing, formattedError } = formatAjvErrors(validate.errors || null, parsedArgs);
  return { valid: false, missing, schema, formattedError };
}
