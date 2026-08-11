// src/utils/toolExecution.ts

import { z } from 'zod';
import { ToolExecutionError, ValidationRetryError } from './toolErrors.js';

export interface ToolDefinition<T extends z.ZodTypeAny> {
  name: string;
  description: string;
  schema: T;
  execute: (args: z.infer<T>, context: unknown) => Promise<unknown>;
}

export interface ZodTool {
  _zodSchema?: z.ZodTypeAny;
  _execute?: (args: never, context: never) => Promise<unknown>;
  function?: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

/**
 * Creates a standard tool definition from a native Zod JSON Schema.
 */
export function defineZodTool<T extends z.ZodTypeAny>(toolDef: ToolDefinition<T>) {
  const parameters = z.toJSONSchema(toolDef.schema) as Record<string, unknown>;

  return {
    type: 'function',
    function: {
      name: toolDef.name,
      description: toolDef.description,
      parameters,
    },
    _zodSchema: toolDef.schema,
    _execute: toolDef.execute,
  };
}

function parseRawArgs(rawArgs: string | object): unknown {
  if (typeof rawArgs !== 'string') return rawArgs;
  try {
    return JSON.parse(rawArgs);
  } catch (e) {
    const err = e as Error;
    const detail = `JSONParseError: Invalid JSON format. ${err.message}`;
    throw new ValidationRetryError(`<tool_use_error>${detail}</tool_use_error>`);
  }
}

function handleExecutionError(e: unknown, toolName: string, parsedArgs: unknown): never {
  if (e instanceof z.ZodError) {
    const errors = e.issues.map((err) => `- ${err.path.join('.')}: ${err.message}`).join('\\n');
    const body = `InputValidationError: Parameter constraints violated.\\n${errors}`;
    const formatted = `<tool_use_error>${body}</tool_use_error>`;
    throw new ValidationRetryError(formatted);
  }

  const err = e as Error;
  throw new ToolExecutionError(err.message, toolName, parsedArgs);
}

/**
 * Wraps tool execution with strict Zod validation.
 * If validation fails, throws ValidationRetryError to trigger the prompt retry loop.
 */
export async function executeZodTool(
  tool: ZodTool,
  rawArgs: string | object,
  context: unknown,
): Promise<unknown> {
  if (!tool._zodSchema || !tool._execute) {
    throw new Error(
      `[toolExecution] Tool ${tool.function?.name || 'unknown'} is not a Zod-defined tool.`,
    );
  }

  const parsedArgs = parseRawArgs(rawArgs);

  try {
    const validArgs = tool._zodSchema.parse(parsedArgs);
    const execFn = tool._execute as (args: unknown, ctx: unknown) => Promise<unknown>;
    return await execFn(validArgs, context);
  } catch (e) {
    handleExecutionError(e, tool.function?.name || 'unknown', parsedArgs);
  }
}
