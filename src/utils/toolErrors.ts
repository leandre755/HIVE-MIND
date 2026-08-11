// src/utils/toolErrors.ts

export class ToolExecutionError extends Error {
  public readonly toolName: string;
  public readonly params: unknown;

  constructor(message: string, toolName: string, params: unknown) {
    super(message);
    this.name = 'ToolExecutionError';
    this.toolName = toolName;
    this.params = params;
  }
}

export class ValidationRetryError extends Error {
  public readonly formattedError: string;

  constructor(formattedError: string) {
    super(formattedError);
    this.name = 'ValidationRetryError';
    this.formattedError = formattedError;
  }
}

export class ToolNotFoundError extends Error {
  constructor(toolName: string) {
    super(`Tool not found: ${toolName}`);
    this.name = 'ToolNotFoundError';
  }
}
