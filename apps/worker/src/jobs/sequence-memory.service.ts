/**
 * Sequence Memory Service — plain (non-NestJS) version for the worker.
 * Implements promoteSuccessfulSequences used by the memory-dreaming processor.
 * Writes patterns directly to MemoryFile/MemoryChunk (no embeddings — FTS works
 * immediately; the API's MemoryService fills embeddings on the next writeFile call).
 */
import { createHash, randomUUID } from 'crypto';
import { prisma } from '@wacrm/database';

const sha256hex = (s: string) => createHash('sha256').update(s).digest('hex');

async function writeMemoryFile(companyId: string, path: string, content: string, source: string) {
  const hash = sha256hex(content);
  const file = await prisma.memoryFile.upsert({
    where: { companyId_path: { companyId, path } },
    create: { companyId, path, source, content, hash, size: content.length },
    update: { content, hash, source, size: content.length },
  });

  // Re-chunk with embeddings=NULL; textSearch tsvector is GENERATED ALWAYS
  await prisma.memoryChunk.deleteMany({ where: { fileId: file.id } });
  const lines = content.split('\n');
  // Simple paragraph chunking (mirrors the API's chunkMarkdown for small files)
  const chunks: { text: string; startLine: number; endLine: number }[] = [];
  let buf: { lines: string[]; startLine: number } | null = null;
  lines.forEach((line, i) => {
    const lineNo = i + 1;
    if (line.trim() === '') {
      if (buf) {
        chunks.push({ text: buf.lines.join('\n'), startLine: buf.startLine, endLine: lineNo - 1 });
        buf = null;
      }
    } else if (!buf) {
      buf = { lines: [line], startLine: lineNo };
    } else {
      buf.lines.push(line);
    }
  });
  if (buf) chunks.push({ text: (buf as any).lines.join('\n'), startLine: (buf as any).startLine, endLine: lines.length });

  for (const c of chunks) {
    if (!c.text.trim()) continue;
    await prisma.$executeRawUnsafe(
      `INSERT INTO "MemoryChunk"
         ("id","companyId","fileId","path","source","startLine","endLine","hash","text","model","embedding","createdAt","updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NULL,NOW(),NOW())`,
      randomUUID(), companyId, file.id, path, source,
      c.startLine, c.endLine, sha256hex(c.text), c.text, 'none',
    );
  }
}

export class SequenceMemoryService {
  async promoteSuccessfulSequences(companyId: string): Promise<void> {
    const sequences = await prisma.sequence.findMany({
      where: { companyId, useCount: { gte: 10 }, status: 'ACTIVE' },
      include: { steps: true },
    });

    const successful = sequences.filter((seq) => {
      const rate = seq.useCount > 0 ? seq.completionCount / seq.useCount : 0;
      return rate >= 0.8;
    });

    for (const seq of successful) {
      const completionRate = seq.useCount > 0 ? seq.completionCount / seq.useCount : 0;
      const pattern = `# Successful Sequence Pattern: ${seq.name}

**Purpose**: ${seq.description || 'No description'}
**Completion Rate**: ${Math.round(completionRate * 100)}%
**Total Enrollments**: ${seq.useCount}
**Tags**: ${seq.tags.join(', ') || 'None'}

## Step Pattern:
${seq.steps.map((step, i) => {
  let desc = `${i + 1}. **${step.action}** after ${step.delayHours}h`;
  if (step.message) desc += `\n   - Message: "${step.message.slice(0, 100)}${step.message.length > 100 ? '...' : ''}"`;
  if (step.templateId) desc += `\n   - Uses template: ${step.templateId}`;
  if (step.tagName) desc += `\n   - Tag: ${step.tagName}`;
  return desc;
}).join('\n')}

_learned from sequence ${seq.id} on ${new Date().toISOString().split('T')[0]}_
`;
      await writeMemoryFile(
        companyId,
        `patterns/${seq.name}-${seq.id}.md`,
        pattern,
        'sequence-pattern',
      );
    }
  }
}
