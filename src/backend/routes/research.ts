import { Hono } from 'hono';
import { sanitizeError } from '../helpers/index.js';
import type { AppDependencies } from '../types.js';
import { ProviderRegistry } from '../services/providerRegistry.js';

interface ResearchRequest {
  query: string;
  model?: string;
  maxSources?: number;
  depth?: 'quick' | 'standard' | 'deep';
}

interface ResearchSource {
  title: string;
  url: string;
  summary: string;
  fetched: boolean;
}

/**
 * Deep Research endpoint:
 * 1. Search DuckDuckGo for the query
 * 2. For each result, fetch and extract page text
 * 3. Use LLM to synthesize a structured report with citations
 *
 * Streams progress events as NDJSON.
 */
export function researchRouter(dependencies: AppDependencies): Hono {
  const app = new Hono();

  app.post('/', async (context) => {
    let body: ResearchRequest;
    try {
      body = await context.req.json<ResearchRequest>();
    } catch {
      return context.json({ error: 'Invalid JSON in request body' }, 400);
    }
    const { query, model, maxSources = 5, depth = 'standard' } = body;

    if (!query?.trim()) {
      return context.json({ error: 'query required' }, 400);
    }

    const resolvedModel = model ?? '';
    const provider = dependencies.providerRegistry.getByModel(resolvedModel);
    const modelName = ProviderRegistry.stripPrefix(resolvedModel);

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        function emit(event: Record<string, unknown>) {
          controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
        }

        try {
          // Step 1: Search
          emit({ stage: 'searching', message: `Searching for: "${query}"` });
          const searchResult = await dependencies.executeTool('search_web', { query }, null);
          let searchResults: Array<{ title: string; url: string; description: string }> = [];

          try {
            searchResults = JSON.parse(searchResult) as typeof searchResults;
          } catch {
            emit({ stage: 'error', message: 'Search returned no parseable results' });
            controller.close();
            return;
          }

          const sourcesToRead = searchResults.slice(0, maxSources);
          emit({ stage: 'found', message: `Found ${sourcesToRead.length} sources`, sources: sourcesToRead.map(s => ({ title: s.title, url: s.url })) });

          // Step 2: Read pages
          const sources: ResearchSource[] = [];
          for (const [i, result] of sourcesToRead.entries()) {
            emit({ stage: 'reading', message: `Reading source ${i + 1}/${sourcesToRead.length}: ${result.title}`, url: result.url });

            const charsPerSource = depth === 'deep' ? 10000 : depth === 'quick' ? 3000 : 6000;
            const pageText = await dependencies.executeTool('read_url', { url: result.url, max_chars: charsPerSource }, null);
            const fetched = !pageText.startsWith('read_url failed') && !pageText.startsWith('HTTP ');

            sources.push({
              title: result.title,
              url: result.url,
              summary: fetched ? pageText.slice(0, 2000) : result.description,
              fetched,
            });
          }

          // Step 3: LLM synthesis
          emit({ stage: 'synthesizing', message: 'Synthesizing research report…' });

          const sourcesText = sources.map((s, i) =>
            `[Source ${i + 1}] ${s.title}\nURL: ${s.url}\n${s.summary}`
          ).join('\n\n---\n\n');

          const systemPrompt = `You are a research analyst. Your task is to synthesize information from multiple web sources into a clear, well-structured report.

Structure your report as:
1. **Executive Summary** (2-3 sentences)
2. **Key Findings** (bullet points with citations [1], [2], etc.)
3. **Detailed Analysis** (paragraphs with citations)
4. **Sources** (numbered list of URLs)

Always cite sources using [N] notation. Be factual and objective.`;

          const messages = [
            { role: 'system' as const, content: systemPrompt },
            {
              role: 'user' as const,
              content: `Research question: "${query}"\n\nSources:\n\n${sourcesText}\n\nWrite a comprehensive research report based on these sources.`,
            },
          ];

          const response = await provider.chatStream(
            { model: modelName, messages, stream: true },
            context.req.raw.signal,
          );

          if (!response.body) throw new Error('No stream body from LLM');

          emit({ stage: 'streaming', message: 'Generating report…' });

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed) continue;
              try {
                const chunk = JSON.parse(trimmed) as {
                  done?: boolean;
                  message?: { content?: string };
                };
                if (chunk.message?.content) {
                  emit({ stage: 'chunk', content: chunk.message.content });
                }
                if (chunk.done) {
                  emit({
                    stage: 'done',
                    message: 'Research complete',
                    sourceCount: sources.length,
                    sources: sources.map(s => ({ title: s.title, url: s.url, fetched: s.fetched })),
                  });
                  controller.close();
                  return;
                }
              } catch {
                // Skip malformed chunks
              }
            }
          }

          controller.close();
        } catch (error) {
          emit({ stage: 'error', message: sanitizeError(error, 'Research failed') });
          controller.close();
        }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'application/x-ndjson',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  });

  return app;
}
