import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Socket } from 'node:net';

const execFilePromise = promisify(execFile);

export class OllamaService {
  private static OLLAMA_HOST = '127.0.0.1';
  private static OLLAMA_PORT = 11434;
  private static LOCAL_OLLAMA_URL = `http://${this.OLLAMA_HOST}:${this.OLLAMA_PORT}`;

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

  static async getInstalledModels(): Promise<string[]> {
    try {
      const { stdout } = await execFilePromise('ollama', ['list']);
      const lines = stdout.split(/\r?\n/).filter(Boolean).slice(1);
      return lines.map((line) => line.split(/\s+/)[0]);
    } catch (err) {
      console.error('[OLLAMA] Failed to list models:', err);
      return [];
    }
  }

  static async getModelDetails(modelName: string): Promise<any> {
    try {
      const { stdout } = await execFilePromise('ollama', ['show', modelName, '--verbose']);
      const contextMatch = stdout.match(/context length\s+(\d+)/i);
      const parametersMatch = stdout.match(/parameters\s+([^\n]+)/i);
      const architectureMatch = stdout.match(/architecture\s+([^\n]+)/i);
      
      return {
        contextWindow: contextMatch ? Number(contextMatch[1]) : null,
        parameters: parametersMatch ? parametersMatch[1].trim() : null,
        architecture: architectureMatch ? architectureMatch[1].trim() : null,
      };
    } catch (err) {
      console.error(`[OLLAMA] Failed to get details for ${modelName}:`, err);
      return { contextWindow: null };
    }
  }

  static getBaseUrl(): string {
    return this.LOCAL_OLLAMA_URL;
  }
}
