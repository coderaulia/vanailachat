import { search, SafeSearchType } from 'duck-duck-scrape';

export class ToolService {
  static async searchWeb(query: string) {
    console.log(`[TOOL] Searching web for: ${query}`);
    try {
      const results = await search(query, { safeSearch: SafeSearchType.MODERATE });
      const searchResults = results.results || [];
      
      return JSON.stringify(searchResults.slice(0, 5).map(r => ({
        title: r.title,
        url: r.url,
        description: r.description
      })));
    } catch (err: any) {
      console.error(`[TOOL] Search error: ${err.message}`);
      return `Search failed: ${err.message}`;
    }
  }

  static async executeTool(name: string, args: any) {
    if (name === 'search_web') {
      return this.searchWeb(args.query);
    }
    return `Unknown tool: ${name}`;
  }
}
