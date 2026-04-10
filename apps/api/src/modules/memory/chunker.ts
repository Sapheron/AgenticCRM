/**
 * Markdown chunker — splits a markdown document into ~500 char chunks aligned
 * to paragraph boundaries. Each chunk records its 1-based startLine/endLine
 * range so we can later return the original passage when the AI calls
 * memory_get(path, from, lines).
 *
 * Mirrors OpenClaw's chunking strategy: prefer paragraph boundaries, fall back
 * to line boundaries for very long paragraphs, never split mid-line.
 */

export interface RawChunk {
  text: string;
  startLine: number; // inclusive, 1-based
  endLine: number;   // inclusive, 1-based
}

const TARGET_SIZE = 500;
const MAX_SIZE = 900;

export function chunkMarkdown(content: string): RawChunk[] {
  if (!content.trim()) return [];

  const lines = content.split('\n');
  // Split into paragraphs (groups separated by blank lines), keeping line numbers.
  const paragraphs: { text: string; startLine: number; endLine: number }[] = [];
  let current: { text: string[]; startLine: number; endLine: number } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;
    if (line.trim() === '') {
      if (current) {
        paragraphs.push({
          text: current.text.join('\n'),
          startLine: current.startLine,
          endLine: current.endLine,
        });
        current = null;
      }
    } else {
      if (!current) {
        current = { text: [line], startLine: lineNo, endLine: lineNo };
      } else {
        current.text.push(line);
        current.endLine = lineNo;
      }
    }
  }
  if (current) {
    paragraphs.push({
      text: current.text.join('\n'),
      startLine: current.startLine,
      endLine: current.endLine,
    });
  }

  const chunks: RawChunk[] = [];
  let buf: { text: string; startLine: number; endLine: number } | null = null;

  for (const p of paragraphs) {
    // Oversized paragraph — split by line.
    if (p.text.length > MAX_SIZE) {
      if (buf) {
        chunks.push(buf);
        buf = null;
      }
      const pLines = p.text.split('\n');
      let lineBuf: string[] = [];
      let lineStart = p.startLine;
      let lineCursor = p.startLine - 1;
      for (const l of pLines) {
        lineCursor++;
        if (lineBuf.join('\n').length + l.length + 1 > MAX_SIZE && lineBuf.length > 0) {
          chunks.push({
            text: lineBuf.join('\n'),
            startLine: lineStart,
            endLine: lineCursor - 1,
          });
          lineBuf = [];
          lineStart = lineCursor;
        }
        lineBuf.push(l);
      }
      if (lineBuf.length > 0) {
        chunks.push({
          text: lineBuf.join('\n'),
          startLine: lineStart,
          endLine: p.endLine,
        });
      }
      continue;
    }

    if (!buf) {
      buf = { text: p.text, startLine: p.startLine, endLine: p.endLine };
      continue;
    }

    if (buf.text.length + p.text.length + 2 <= TARGET_SIZE) {
      buf.text += '\n\n' + p.text;
      buf.endLine = p.endLine;
    } else {
      chunks.push(buf);
      buf = { text: p.text, startLine: p.startLine, endLine: p.endLine };
    }
  }
  if (buf) chunks.push(buf);

  return chunks;
}

/**
 * SHA-256 of a string, returned as a 64-char hex digest. Used for content
 * change detection so we can skip re-embedding unchanged chunks.
 */
export async function sha256(text: string): Promise<string> {
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
