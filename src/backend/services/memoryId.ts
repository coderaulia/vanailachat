import { createHash } from 'node:crypto';

/**
 * Deterministic id for a memory, derived from its type and content.
 *
 * Memories were keyed by a random id, so storing the same text twice inserted
 * a second row. The chat route stores the last user message on every turn, so
 * re-asking a question — or regenerating an answer — piled up copies: one real
 * database had 19 rows of "how do i use the settings?".
 *
 * Hashing the content instead means an identical memory collides on the
 * primary key and updates in place, and the ON CONFLICT clause deliberately
 * leaves created_at alone so the original timestamp (and its recency decay)
 * survives.
 */
export function memoryContentId(type: string, content: string): string {
  const digest = createHash('sha256')
    .update(`${type}\n${content.trim()}`)
    .digest('hex')
    .slice(0, 32);

  return `mem_${digest}`;
}
