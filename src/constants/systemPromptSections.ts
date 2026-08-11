// src/constants/systemPromptSections.ts

/**
 * Standardized system prompt sections inspired by Claude Code.
 * These sections provide strict guidelines and few-shot examples for LLM tools execution.
 */

export const TOOL_USE_GUIDELINES = `
<tool_use_guidelines>
- Always use the tools provided to accomplish your task.
- Before executing a complex tool, verify your assumptions.
- If you lack parameters, NEVER guess. If a tool fails, read the error message carefully.
- Output ONLY the tool call and short explanatory text if necessary. Do not apologize.
</tool_use_guidelines>
`;

export const ERROR_HANDLING_RULES = `
<error_handling>
- If you receive a <tool_use_error> message, it means your last tool call failed due to validation or execution errors.
- READ the <tool_use_error> carefully to understand what parameter was missing, malformed, or hallucinated.
- IMMEDIATELY retry the tool call with the corrected parameters.
- Do NOT apologize for the error.
- Do NOT acknowledge the error textually.
- Simply output the corrected tool call.
</error_handling>
`;

export const FEW_SHOT_EXAMPLES = `
<few_shot_examples>
Example 1: Parameter omission and correction
User/System: <tool_use_error>InputValidationError: Missing required parameter 'file_path'.</tool_use_error>
You:
{"name": "read_file", "arguments": {"file_path": "src/index.ts"}}

Example 2: Hallucinated parameter correction
User/System: <tool_use_error>InputValidationError: An unexpected parameter 'extra' was provided.</tool_use_error>
You:
{"name": "execute_bash_command", "arguments": {"command": "ls -la"}}
</few_shot_examples>
`;
