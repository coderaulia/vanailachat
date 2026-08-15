/**
 * Pluggable tool interface.
 * Tools implement this contract and can be registered dynamically.
 */
export interface ToolSchema {
  type: 'object';
  properties: Record<string, { type: string; description: string }>;
  required: string[];
}

export interface Tool {
  /** Unique tool identifier (e.g. "search_web", "read_file") */
  name: string;
  /** Description shown to the LLM */
  description: string;
  /** JSON Schema for tool arguments */
  parameters: ToolSchema;
  /** Execute the tool. Returns result string. */
  execute: (args: unknown, projectRoot: string | null) => Promise<string>;
  /** Optional timeout in ms (default: 30_000) */
  timeoutMs?: number;
}

export interface ToolExecutionResult {
  success: boolean;
  output: string;
  durationMs: number;
  toolName: string;
}

/** Create an Ollama-compatible tool definition for the chat API */
export function toToolDefinition(tool: Tool): Record<string, unknown> {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}
