import type { InstalledModelMetadata } from './ollama.js';

/**
 * Generic LLM provider interface.
 * New providers (OpenAI, vLLM, llama.cpp) implement this contract.
 */
export interface ChatMessage {
  role: string;
  content: string;
  images?: string[];
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolCall {
  id?: string;
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
  type?: string;
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, { type: string; description: string }>;
      required: string[];
    };
  };
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  stream: boolean;
  tools?: ToolDefinition[];
}

export interface ChatResponseChunk {
  model?: string;
  message?: {
    role?: string;
    content?: string;
    tool_calls?: ToolCall[];
  };
  done?: boolean;
  done_reason?: string;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

export interface ModelInfo {
  name: string;
  displayName?: string;
  description?: string;
  capabilities?: string[];
  contextWindow?: number;
  parameters?: string;
}

export interface LLMProvider {
  /** Provider identifier (e.g. "ollama", "openai", "vllm") */
  readonly id: string;

  /** Human-readable label */
  readonly label: string;

  /** List available models from this provider */
  listModels(): Promise<string[]>;

  /** Get detailed metadata for a specific model */
  getModelDetails(modelName: string): Promise<Record<string, unknown> | null>;

  /** Get detailed metadata for all models at once */
  getInstalledModelMetadata?(): Promise<InstalledModelMetadata[]>;

  /** Check if a model is available */
  isModelAvailable(modelName: string): Promise<boolean>;

  /**
   * Send a streaming chat request.
   * Returns the upstream Response whose body is an NDJSON stream.
   */
  chatStream(request: ChatRequest, signal?: AbortSignal): Promise<Response>;

  /**
   * Send a non-streaming chat request.
   * Returns the raw JSON payload from the provider.
   */
  chat(request: ChatRequest, signal?: AbortSignal): Promise<Record<string, unknown>>;
}
