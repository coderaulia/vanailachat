import { search, SafeSearchType } from 'duck-duck-scrape';
import fs from 'fs/promises';
import path from 'path';

interface Tool {
  name: string;
  description: string;
  parameters: any;
  execute: (args: any) => Promise<string>;
}

export class ToolService {
  private static tools: Record<string, Tool> = {
    search_web: {
      name: 'search_web',
      description: 'Search the web for real-time information using DuckDuckGo',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search query' }
        },
        required: ['query']
      },
      execute: async (args: { query: string }) => {
        console.log(`[TOOL] Searching web for: ${args.query}`);
        try {
          const results = await search(args.query, { safeSearch: SafeSearchType.MODERATE });
          return JSON.stringify((results.results || []).slice(0, 5).map(r => ({
            title: r.title,
            url: r.url,
            description: r.description
          })));
        } catch (err: any) {
          return `Search failed: ${err.message}`;
        }
      }
    },
    read_file: {
      name: 'read_file',
      description: 'Read the contents of a local file in the current project',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path to the file' }
        },
        required: ['path']
      },
      execute: async (args: { path: string }) => {
        console.log(`[TOOL] Reading file: ${args.path}`);
        try {
          const safePath = path.resolve(process.cwd(), args.path);
          if (!safePath.startsWith(process.cwd())) {
            throw new Error("Access denied: path outside project directory");
          }
          const content = await fs.readFile(safePath, 'utf-8');
          return content;
        } catch (err: any) {
          return `Failed to read file: ${err.message}`;
        }
      }
    }
  };

  static getToolDefinitions() {
    return Object.values(this.tools).map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters
      }
    }));
  }

  static async executeTool(name: string, args: any) {
    const tool = this.tools[name];
    if (tool) {
      return tool.execute(args);
    }
    return `Unknown tool: ${name}`;
  }
}
