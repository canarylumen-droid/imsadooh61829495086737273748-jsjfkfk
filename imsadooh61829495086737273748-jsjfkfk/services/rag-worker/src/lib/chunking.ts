/**
 * Split text into overlapping chunks for precise retrieval.
 */
const CHUNK_SIZE_CHARS = 1800; // ~450 tokens at ~4 chars/token
const CHUNK_OVERLAP_CHARS = 200;

export function chunkText(text: string): string[] {
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + CHUNK_SIZE_CHARS, text.length);
    const chunk = text.slice(start, end).trim();
    if (chunk.length > 50) { // Skip tiny chunks
      chunks.push(chunk);
    }
    start += CHUNK_SIZE_CHARS - CHUNK_OVERLAP_CHARS;
  }

  return chunks;
}
