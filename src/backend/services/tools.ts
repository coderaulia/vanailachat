import fs from 'node:fs/promises';
import path from 'node:path';
import { SafeSearchType, search } from 'duck-duck-scrape';

type ToolSchema = {
  type: 'object';
  properties: Record<string, { type: string; description: string }>;
  required: string[];
};

interface Tool {
  description: string;
  execute: (args: unknown) => Promise<string>;
  name: string;
  parameters: ToolSchema;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

function parseStringField(args: unknown, key: string): string | null {
  if (typeof args !== 'object' || args === null) {
    return null;
  }

  const value = (args as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : null;
}

export class ToolService {
  private static tools: Record<string, Tool> = {
    search_web: {
      name: 'search_web',
      description: 'Search the web for real-time information using DuckDuckGo',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search query' },
        },
        required: ['query'],
      },
      execute: async (args: unknown) => {
        const query = parseStringField(args, 'query');
        if (!query) {
          return 'Search failed: missing query';
        }

        console.log(`[TOOL] Searching web for: ${query}`);

        try {
          const results = await search(query, { safeSearch: SafeSearchType.MODERATE });
          return JSON.stringify(
            (results.results || []).slice(0, 5).map((result) => ({
              title: result.title,
              url: result.url,
              description: result.description,
            }))
          );
        } catch (error) {
          return `Search failed: ${getErrorMessage(error)}`;
        }
      },
    },
    read_file: {
      name: 'read_file',
      description: 'Read the contents of a local file in the current project',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path to the file' },
        },
        required: ['path'],
      },
      execute: async (args: unknown) => {
        const requestedPath = parseStringField(args, 'path');
        if (!requestedPath) {
          return 'Failed to read file: missing path';
        }

        console.log(`[TOOL] Reading file: ${requestedPath}`);

        try {
          const safePath = path.resolve(process.cwd(), requestedPath);
          if (!safePath.startsWith(process.cwd())) {
            throw new Error('Access denied: path outside project directory');
          }

          return await fs.readFile(safePath, 'utf-8');
        } catch (error) {
          return `Failed to read file: ${getErrorMessage(error)}`;
        }
      },
    },
  };

  static getToolDefinitions() {
    return Object.values(this.tools).map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }

  static async executeTool(name: string, args: unknown): Promise<string> {
    const tool = this.tools[name];
    if (tool) {
      return tool.execute(args);
    }
    return `Unknown tool: ${name}`;
  }
}
