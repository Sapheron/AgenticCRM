/**
 * Core AI agent loop:
 * 1. Check circuit breaker
 * 2. Load AI config (with Redis cache via BullMQ)
 * 3. Build context (system prompt + CRM data + conversation history)
 * 4. Call AI provider through circuit breaker
 * 5. If tool call → execute → append result → repeat
 * 6. If text reply → send via WhatsApp → store → emit WS
 * 7. On failure → escalate to human
 */
import pino from 'pino';
import { prisma } from '@wacrm/database';
import { decrypt, transitionFsm } from '@wacrm/shared';
import { ProviderFactory } from './providers/provider.factory';
import { buildContext } from './context-builder';
import { getTools } from '../tools/tool-registry';
import { executeTool } from '../tools/tool-executor';
import { callWithBreaker, isCircuitOpen } from '../circuit-breaker/ai-breaker';
import type { ChatMessage } from './providers/provider.interface';
import Redis from 'ioredis';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });
const redis = new Redis(process.env.REDIS_URL!, { lazyConnect: true });

const AI_CONFIG_TTL = 600; // 10 min cache
const MAX_TOOL_ITERATIONS = 5;

interface AgentJobData {
  companyId: string;
  conversationId: string;
  messageId: string;
  contactId: string;
  accountId: string;
}

export async function runAgentLoop(data: AgentJobData): Promise<void> {
  const { companyId, conversationId, messageId, contactId, accountId } = data;
  const logCtx = { companyId, conversationId, messageId };

  // 1. Circuit breaker check
  if (isCircuitOpen(companyId)) {
    logger.warn(logCtx, 'Circuit breaker open, escalating to human');
    await escalateToHuman(conversationId, 'AI circuit breaker open');
    return;
  }

  // 2. Load AI config with Redis cache
  const cacheKey = `ai-config:${companyId}`;
  let aiConfig: Awaited<ReturnType<typeof prisma.aiConfig.findUnique>>;

  const cached = await redis.get(cacheKey).catch(() => null);
  if (cached) {
    aiConfig = JSON.parse(cached) as typeof aiConfig;
  } else {
    aiConfig = await prisma.aiConfig.findUnique({ where: { companyId } });
    if (aiConfig) {
      await redis.setex(cacheKey, AI_CONFIG_TTL, JSON.stringify(aiConfig)).catch(() => null);
    }
  }

  if (!aiConfig?.autoReplyEnabled) {
    logger.info(logCtx, 'AI auto-reply disabled for this company');
    return;
  }

  if (!aiConfig.apiKeyEncrypted) {
    logger.warn(logCtx, 'No AI API key configured');
    return;
  }

  // Check contact hasn't opted out
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { optedOut: true, isBlocked: true, phoneNumber: true },
  });
  if (contact?.optedOut || contact?.isBlocked) {
    logger.info({ contactId }, 'Contact opted out or blocked, skipping AI');
    return;
  }

  // 3. Transition FSM to AI_HANDLING
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { status: true, aiEnabled: true },
  });
  if (!conversation?.aiEnabled) return;

  const nextStatus = transitionFsm(conversation.status, 'message_received');
  if (nextStatus) {
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { status: nextStatus },
    });
  }

  // 4. Build provider
  const apiKey = decrypt(aiConfig.apiKeyEncrypted);
  const provider = ProviderFactory.create({
    provider: aiConfig.provider,
    model: aiConfig.model,
    apiKey,
    baseUrl: aiConfig.baseUrl ?? undefined,
  });

  // 5. Build context
  const messages = await buildContext(
    companyId,
    conversationId,
    contactId,
    aiConfig.systemPrompt,
  );

  const tools = getTools(aiConfig.toolCallingEnabled);
  const iterationMessages: ChatMessage[] = [...messages];
  let totalTokens = 0;
  let escalated = false;

  // Emit "AI is typing" via Redis → WS gateway picks it up
  await redis.publish(`company:${companyId}:events`, JSON.stringify({
    event: 'ai.typing',
    data: { conversationId },
  })).catch(() => null);

  // 6. Agent loop (tool call iterations)
  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    let response;
    try {
      response = await callWithBreaker(companyId, provider, iterationMessages, tools, {
        maxTokens: aiConfig.maxTokens,
        temperature: aiConfig.temperature,
      });
    } catch (err: unknown) {
      logger.error({ ...logCtx, err }, 'AI call failed');
      await escalateToHuman(conversationId, 'AI provider error');
      return;
    }

    totalTokens += response.tokensUsed;

    // Tool call path
    if (response.toolCalls?.length) {
      for (const toolCall of response.toolCalls) {
        logger.info({ ...logCtx, tool: toolCall.name }, 'Executing tool call');

        // Log to audit
        await prisma.auditLog.create({
          data: {
            companyId,
            action: 'AI_TOOL_CALL',
            entityType: 'conversation',
            entityId: conversationId,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            newValue: { tool: toolCall.name, args: toolCall.arguments } as any,
          },
        });

        const { result, escalate } = await executeTool(toolCall, {
          companyId,
          contactId,
          conversationId,
          accountId,
        });

        if (escalate) {
          escalated = true;
        }

        // Append assistant + tool result to context
        iterationMessages.push({
          role: 'assistant',
          content: `[Tool call: ${toolCall.name}]`,
        });
        iterationMessages.push({
          role: 'tool',
          content: result,
          toolCallId: toolCall.id,
          toolName: toolCall.name,
        });
      }

      if (escalated) break;
      continue; // loop again with tool results
    }

    // Text reply path
    if (response.content) {
      const replyText = response.content.trim();
      if (!replyText) break;

      // Store AI message
      const storedMessage = await prisma.message.create({
        data: {
          companyId,
          conversationId,
          whatsappAccountId: accountId,
          direction: 'OUTBOUND',
          type: 'TEXT',
          status: 'PENDING',
          body: replyText,
          isAiGenerated: true,
          aiProvider: aiConfig.provider,
          aiModel: aiConfig.model,
          aiTokensUsed: totalTokens,
          aiLatencyMs: response.latencyMs,
        },
      });

      // Publish to WS gateway
      await redis.publish(`company:${companyId}:events`, JSON.stringify({
        event: 'message.new',
        data: { conversationId, message: storedMessage },
      })).catch(() => null);

      // Update conversation preview
      await prisma.conversation.update({
        where: { id: conversationId },
        data: {
          lastMessageAt: new Date(),
          lastMessageText: replyText.slice(0, 200),
        },
      });

      // Audit log
      await prisma.auditLog.create({
        data: {
          companyId,
          action: 'AI_REPLY',
          entityType: 'message',
          entityId: storedMessage.id,
          newValue: { tokensUsed: totalTokens, latencyMs: response.latencyMs },
        },
      });

      logger.info({ ...logCtx, storedMessageId: storedMessage.id, tokens: totalTokens }, 'AI reply stored');

      // Signal to WhatsApp sender (via BullMQ outbound queue)
      await redis.publish('wa:outbound', JSON.stringify({
        accountId,
        contactId,
        messageId: storedMessage.id,
        text: replyText,
      })).catch(() => null);

      break;
    }

    break; // no content, no tools — done
  }

  // Transition FSM back
  if (!escalated) {
    const freshConv = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { status: true },
    });
    const afterReply = transitionFsm(freshConv?.status ?? 'AI_HANDLING', 'ai_replied');
    if (afterReply) {
      await prisma.conversation.update({ where: { id: conversationId }, data: { status: afterReply } });
    }
  }
}

async function escalateToHuman(conversationId: string, reason: string) {
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { status: 'WAITING_HUMAN' },
  });
  logger.info({ conversationId, reason }, 'Escalated to human');
}
