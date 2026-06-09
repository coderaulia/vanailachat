import { DatabaseService } from './database.js';
import { OllamaService } from './ollama.js';

/**
 * Embedding service using Ollama's /api/embed endpoint.
 * Generates vector embeddings for semantic search.
 *
 * Uses nomic-embed-text by default (must be installed: ollama pull nomic-embed-text).
 */
export class EmbeddingService {
  private static EMBEDDING_MODEL = 'nomic-embed-text';
  private static EMBEDDING_DIM = 768;

  /**
   * Generate an embedding vector for a text string.
   * Returns the embedding as a Float32Array.
   */
  static async embed(text: string): Promise<Float32Array> {
    const baseUrl = OllamaService.getBaseUrl();
    const response = await fetch(`${baseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.EMBEDDING_MODEL, input: text }),
    });

    if (!response.ok) {
      throw new Error(`Embedding failed: ${response.status} ${response.statusText}`);
    }

    const payload = (await response.json()) as { embeddings?: number[][] };
    const embedding = payload.embeddings?.[0];
    if (!embedding || embedding.length === 0) {
      throw new Error('Empty embedding returned');
    }

    return new Float32Array(embedding);
  }

  /**
   * Compute cosine similarity between two vectors.
   */
  static cosineSimilarity(a: Float32Array, b: Float32Array): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    const len = Math.min(a.length, b.length);

    for (let i = 0; i < len; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    if (denominator === 0) return 0;
    return dotProduct / denominator;
  }

  /**
   * Find the most similar entries to a pre-computed query vector.
   * Synchronous — caller is responsible for generating the vector via embed().
   */
  static searchWithVector(
    queryVec: Float32Array,
    topK: number = 5,
    threshold: number = 0.3,
  ): Array<{ id: string; content: string; score: number; metadata: string | null }> {
    // Cap at 1000 most recent entries to keep search O(1000) not O(∞)
    const entries = DatabaseService.getAllMemoryEntries(1000);

    const scored = entries
      .map((entry) => {
        let score = 0;
        try {
          // embedding is base64-encoded Float32Array bytes
          const buf = Buffer.from(entry.embedding, 'base64');
          const vec = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
          score = this.cosineSimilarity(queryVec, vec);
        } catch {
          // Invalid embedding stored
        }
        return { entry, score };
      })
      .filter((e) => e.score >= threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    return scored.map(({ entry, score }) => ({
      id: entry.id,
      content: entry.content,
      score: Math.round(score * 100) / 100,
      metadata: entry.metadata,
    }));
  }

  /**
   * Find the most similar entries to a query text.
   * Uses brute-force cosine similarity (fine for <10k entries).
   */
  static async search(
    queryText: string,
    topK: number = 5,
    threshold: number = 0.3,
  ): Promise<Array<{ id: string; content: string; score: number; metadata: string | null }>> {
    const queryVec = await this.embed(queryText);
    return this.searchWithVector(queryVec, topK, threshold);
  }
}
