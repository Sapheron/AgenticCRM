/**
 * Sequence Memory Service — integrates sequences with OpenClaw memory system.
 *
 * Features:
 * - Index sequences in memory for semantic search
 * - Suggest similar sequences based on context
 * - Learn from successful sequences
 * - Promote best patterns to long-term memory
 */
import { Injectable } from '@nestjs/common';
import { prisma } from '@wacrm/database';
import { MemoryService } from '../memory/memory.service';

@Injectable()
export class SequenceMemoryService {
  private readonly memoryService = new MemoryService();

  /**
   * Index a sequence in memory for semantic search
   */
  async indexSequence(sequenceId: string): Promise<void> {
    const sequence = await prisma.sequence.findUnique({
      where: { id: sequenceId },
      include: { steps: true },
    });

    if (!sequence) return;

    // Build description from steps
    const stepDescriptions = sequence.steps.map(
      (step, i) => `Step ${i + 1}: ${step.action} after ${step.delayHours}h`,
    );

    const content = `# ${sequence.name}\n\n${sequence.description || ''}\n\n## Steps:\n${stepDescriptions.join('\n')}\n\n## Tags:\n${sequence.tags.join(', ') || 'None'}`;

    // Store in memory
    await this.memoryService.writeFile(
      sequence.companyId,
      `sequences/${sequence.name}.md`,
      content,
      'sequence',
    );
  }

  /**
   * Suggest similar sequences based on context
   */
  async suggestSequenceForContext(
    companyId: string,
    context: string,
    _tags?: string[],
  ): Promise<Array<{ sequence: any; score: number; reason: string }>> {
    // Search memory for similar sequences
    const hits = await this.memoryService.search(companyId, context, {
      source: 'sequence',
      maxResults: 5,
    });

    if (!hits.length) {
      return [];
    }

    // Parse sequence IDs from paths - they should be in format "sequences/{sequenceId}-{name}.md" or similar
    // We need to look up sequences by name since the path doesn't contain the ID
    const sequenceNames = hits
      .map((h) => {
        // Extract name from path like "sequences/Welcome sequence.md"
        const match = h.path.match(/^sequences\/(.+)\.md$/);
        return match ? match[1] : null;
      })
      .filter((name): name is string => name !== null);

    if (!sequenceNames.length) {
      return [];
    }

    const sequences = await prisma.sequence.findMany({
      where: {
        companyId,
        name: { in: sequenceNames },
        status: 'ACTIVE',
      },
      include: { steps: true },
    });

    // Score by similarity + completion rate
    return sequences
      .map((seq) => {
        const hit = hits.find((h) => h.path.includes(seq.name));
        const completionRate = seq.useCount > 0 ? seq.completionCount / seq.useCount : 0;
        const score = (hit?.score || 0) * 0.7 + completionRate * 0.3;

        return {
          sequence: seq,
          score,
          reason: `${Math.round(score * 100)}% match - ${seq.completionCount}/${seq.useCount} completed (${Math.round(completionRate * 100)}% rate)`,
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
  }

  /**
   * Learn from successful sequence - store pattern in memory
   */
  async learnFromSequence(sequenceId: string): Promise<void> {
    const sequence = await prisma.sequence.findUnique({
      where: { id: sequenceId },
      include: { steps: true },
    });

    if (!sequence) return;

    const completionRate = sequence.useCount > 0 ? sequence.completionCount / sequence.useCount : 0;

    // Only learn from high-performing sequences (80%+ completion)
    if (completionRate < 0.8) return;

    const pattern = `
# Successful Sequence Pattern: ${sequence.name}

**Purpose**: ${sequence.description || 'No description'}
**Completion Rate**: ${Math.round(completionRate * 100)}%
**Total Enrollments**: ${sequence.useCount}
**Tags**: ${sequence.tags.join(', ') || 'None'}

## Step Pattern:
${sequence.steps.map((step, i) => {
  let stepDesc = `${i + 1}. **${step.action}** after ${step.delayHours}h`;
  if (step.message) stepDesc += `\n   - Message: "${step.message.slice(0, 100)}${step.message.length > 100 ? '...' : ''}"`;
  if (step.templateId) stepDesc += `\n   - Uses template: ${step.templateId}`;
  if (step.tagName) stepDesc += `\n   - Tag: ${step.tagName}`;
  return stepDesc;
}).join('\n')}

_learned from sequence ${sequence.id} on ${new Date().toISOString().split('T')[0]}_
`;

    // Store as a proven pattern
    await this.memoryService.writeFile(
      sequence.companyId,
      `patterns/${sequence.name}-${sequence.id}.md`,
      pattern,
      'sequence-pattern',
    );
  }

  /**
   * Promote successful sequences to long-term memory (called by dreaming)
   */
  async promoteSuccessfulSequences(companyId: string): Promise<void> {
    const sequences = await prisma.sequence.findMany({
      where: {
        companyId,
        useCount: { gte: 10 }, // Minimum enrollments
        status: 'ACTIVE',
      },
      include: { steps: true },
    });

    const successful = sequences.filter((seq) => {
      const rate = seq.useCount > 0 ? seq.completionCount / seq.useCount : 0;
      return rate >= 0.8; // 80%+ completion
    });

    for (const seq of successful) {
      await this.learnFromSequence(seq.id);
    }
  }

  /**
   * Record sequence recall for learning
   */
  async recordSequenceRecall(sequenceId: string): Promise<void> {
    // This is handled implicitly by the memory search system
    // The MemoryService tracks recalls automatically
    const sequence = await prisma.sequence.findUnique({
      where: { id: sequenceId },
    });

    if (sequence) {
      // Ensure sequence is indexed in memory
      await this.indexSequence(sequenceId);
    }
  }
}
