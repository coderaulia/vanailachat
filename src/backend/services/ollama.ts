import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Socket } from 'node:net';

const execFilePromise = promisify(execFile);

export interface ModelDetails {
  architecture: string | null;
  contextWindow: number | null;
  parameters: string | null;
  capabilities: string[] | null;
  family: string | null;
  families: string[] | null;
  format: string | null;
  parameterSize: string | null;
  quantizationLevel: string | null;
}

export interface InstalledModelMetadata extends ModelDetails {
  name: string;
  model: string;
  modifiedAt: string | null;
  size: number | null;
  digest: string | null;
}

interface OllamaModelDetails {
  format?: unknown;
  family?: unknown;
  families?: unknown;
  parameter_size?: unknown;
  quantization_level?: unknown;
}

interface OllamaTagModel {
  name?: unknown;
  model?: unknown;
  modified_at?: unknown;
  size?: unknown;
  digest?: unknown;
  details?: OllamaModelDetails;
}

interface OllamaTagsResponse {
  models?: unknown;
}

interface OllamaShowResponse {
  details?: OllamaModelDetails;
  model_info?: unknown;
  capabilities?: unknown;
}

export class OllamaService {
  private static OLLAMA_HOST = '127.0.0.1';
  private static OLLAMA_PORT = 11434;
  private static LOCAL_OLLAMA_URL = `http://${this.OLLAMA_HOST}:${this.OLLAMA_PORT}`;

  private static emptyModelDetails(): ModelDetails {
    return {
      architecture: null,
      contextWindow: null,
      parameters: null,
      capabilities: null,
      family: null,
      families: null,
      format: null,
      parameterSize: null,
      quantizationLevel: null,
    };
  }

  private static stringOrNull(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private static stringArrayOrNull(value: unknown): string[] | null {
    if (!Array.isArray(value)) return null;
    const strings = value
      .map((item) => this.stringOrNull(item))
      .filter((item): item is string => item !== null);
    return strings.length > 0 ? strings : null;
  }

  private static numberOrNull(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  private static isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private static getContextWindow(modelInfo: Record<string, unknown>): number | null {
    for (const [key, value] of Object.entries(modelInfo)) {
      if (key === 'context_length' || key.endsWith('.context_length')) {
        return this.numberOrNull(value);
      }
    }
    return null;
  }

  private static detailsFromOllamaDetails(details?: OllamaModelDetails): ModelDetails {
    const family = this.stringOrNull(details?.family);
    const parameterSize = this.stringOrNull(details?.parameter_size);

    return {
      ...this.emptyModelDetails(),
      architecture: family,
      parameters: parameterSize,
      family,
      families: this.stringArrayOrNull(details?.families),
      format: this.stringOrNull(details?.format),
      parameterSize,
      quantizationLevel: this.stringOrNull(details?.quantization_level),
    };
  }

  private static mergeModelDetails(base: ModelDetails, override: ModelDetails): ModelDetails {
    return {
      architecture: override.architecture ?? base.architecture,
      contextWindow: override.contextWindow ?? base.contextWindow,
      parameters: override.parameters ?? base.parameters,
      capabilities: override.capabilities ?? base.capabilities,
      family: override.family ?? base.family,
      families: override.families ?? base.families,
      format: override.format ?? base.format,
      parameterSize: override.parameterSize ?? base.parameterSize,
      quantizationLevel: override.quantizationLevel ?? base.quantizationLevel,
    };
  }

  private static createInstalledModelMetadata(
    name: string,
    details: ModelDetails = this.emptyModelDetails()
  ): InstalledModelMetadata {
    return {
      ...details,
      name,
      model: name,
      modifiedAt: null,
      size: null,
      digest: null,
    };
  }

  static async isPortOpen(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new Socket();
      socket.setTimeout(500);
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('timeout', () => {
        socket.destroy();
        resolve(false);
      });
      socket.once('error', () => {
        socket.destroy();
        resolve(false);
      });
      socket.connect(port, this.OLLAMA_HOST);
    });
  }

  static async startServer(): Promise<void> {
    const alreadyRunning = await this.isPortOpen(this.OLLAMA_PORT);
    if (alreadyRunning) {
      console.log(`[OLLAMA] Detected server already running on ${this.LOCAL_OLLAMA_URL}`);
      return;
    }

    console.log('[OLLAMA] Starting local server...');
    const ollamaChild = spawn('ollama', ['serve'], {
      stdio: 'inherit',
      env: { ...process.env, OLLAMA_HOST: `${this.OLLAMA_HOST}:${this.OLLAMA_PORT}` },
    });

    ollamaChild.on('error', (err) => {
      console.error('[OLLAMA] Failed to launch:', err.message);
    });

    const start = Date.now();
    const maxMs = 20000;
    while (Date.now() - start < maxMs) {
      if (await this.isPortOpen(this.OLLAMA_PORT)) {
        console.log(`[OLLAMA] Server available at ${this.LOCAL_OLLAMA_URL}`);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    throw new Error('Ollama did not start within 20 seconds.');
  }

  private static async getInstalledModelMetadataFromApi(): Promise<InstalledModelMetadata[]> {
    const response = await fetch(`${this.LOCAL_OLLAMA_URL}/api/tags`);
    if (!response.ok) {
      throw new Error(`Ollama tags request failed with status ${response.status}`);
    }

    const payload = (await response.json()) as OllamaTagsResponse;
    if (!Array.isArray(payload.models)) return [];

    return payload.models.flatMap((entry): InstalledModelMetadata[] => {
      if (!this.isRecord(entry)) return [];
      const model = entry as OllamaTagModel;
      const name = this.stringOrNull(model.name) ?? this.stringOrNull(model.model);
      if (!name) return [];

      return [
        {
          ...this.detailsFromOllamaDetails(model.details),
          name,
          model: this.stringOrNull(model.model) ?? name,
          modifiedAt: this.stringOrNull(model.modified_at),
          size: this.numberOrNull(model.size),
          digest: this.stringOrNull(model.digest),
        },
      ];
    });
  }

  private static async getInstalledModelNamesFromCli(): Promise<string[]> {
    try {
      const { stdout } = await execFilePromise('ollama', ['list']);
      const lines = stdout.split(/\r?\n/).filter(Boolean).slice(1);
      return lines.map((line) => line.split(/\s+/)[0]);
    } catch (err) {
      console.error('[OLLAMA] Failed to list models:', err);
      return [];
    }
  }

  static async getInstalledModels(): Promise<string[]> {
    try {
      const metadata = await this.getInstalledModelMetadataFromApi();
      return metadata.map((model) => model.name);
    } catch {
      return this.getInstalledModelNamesFromCli();
    }
  }

  static async getInstalledModelMetadata(): Promise<InstalledModelMetadata[]> {
    let models: InstalledModelMetadata[];
    try {
      models = await this.getInstalledModelMetadataFromApi();
    } catch {
      const names = await this.getInstalledModelNamesFromCli();
      models = names.map((name) => this.createInstalledModelMetadata(name));
    }

    return Promise.all(
      models.map(async (model) => {
        const details = await this.getModelDetails(model.name);
        return {
          ...model,
          ...this.mergeModelDetails(model, details),
        };
      })
    );
  }

  private static async getModelDetailsFromApi(modelName: string): Promise<ModelDetails> {
    const response = await fetch(`${this.LOCAL_OLLAMA_URL}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelName }),
    });

    if (!response.ok) {
      throw new Error(`Ollama show request failed with status ${response.status}`);
    }

    const payload = (await response.json()) as OllamaShowResponse;
    const baseDetails = this.detailsFromOllamaDetails(payload.details);
    const modelInfo = this.isRecord(payload.model_info) ? payload.model_info : {};
    const architecture = this.stringOrNull(modelInfo['general.architecture']) ?? baseDetails.architecture;
    const contextWindow = this.getContextWindow(modelInfo);

    return this.mergeModelDetails(baseDetails, {
      ...this.emptyModelDetails(),
      architecture,
      contextWindow,
      capabilities: this.stringArrayOrNull(payload.capabilities),
    });
  }

  private static async getModelDetailsFromCli(modelName: string): Promise<ModelDetails> {
    try {
      const { stdout } = await execFilePromise('ollama', ['show', modelName, '--verbose']);
      const contextMatch = stdout.match(/context length\s+(\d+)/i);
      const parametersMatch = stdout.match(/parameters\s+([^\n]+)/i);
      const architectureMatch = stdout.match(/architecture\s+([^\n]+)/i);
      const capabilitiesMatch = stdout.match(/Capabilities\s+([\s\S]*?)(?=\n\n|\n[A-Z]|$)/i);
      const capabilities = capabilitiesMatch
        ? capabilitiesMatch[1]
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean)
        : null;
      const parameters = parametersMatch ? parametersMatch[1].trim() : null;
      const architecture = architectureMatch ? architectureMatch[1].trim() : null;

      return {
        ...this.emptyModelDetails(),
        contextWindow: contextMatch ? Number(contextMatch[1]) : null,
        parameters,
        parameterSize: parameters,
        architecture,
        family: architecture,
        capabilities,
      };
    } catch (err) {
      console.error(`[OLLAMA] Failed to get details for ${modelName}:`, err);
      return this.emptyModelDetails();
    }
  }

  static async getModelDetails(modelName: string): Promise<ModelDetails> {
    try {
      return await this.getModelDetailsFromApi(modelName);
    } catch {
      return this.getModelDetailsFromCli(modelName);
    }
  }

  static getBaseUrl(): string {
    return this.LOCAL_OLLAMA_URL;
  }
}
