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

/**
 * Per-model max output token limits — verified against official API docs (April 2025).
 * Same as ai-chat.service.ts. Provider APIs clamp if we overshoot, so be generous.
 * Unknown models default to 16384.
 */
const MODEL_MAX_TOKENS: Record<string, number> = {
  // OpenAI
  'gpt-4.1': 32768, 'gpt-4.1-mini': 32768, 'gpt-4.1-nano': 32768,
  'gpt-4o': 16384, 'gpt-4o-mini': 16384,
  'o3': 100000, 'o3-mini': 100000, 'o4-mini': 100000,
  // Anthropic
  'claude-opus-4-6': 128000, 'claude-sonnet-4-6': 64000, 'claude-sonnet-4-5': 64000,
  'claude-haiku-4-5-20251001': 64000,
  // Gemini
  'gemini-2.5-pro': 65536, 'gemini-2.5-flash': 65536, 'gemini-2.5-flash-lite': 65536,
  'gemini-2.0-flash': 8192, 'gemini-2.0-flash-lite': 8192,
  // DeepSeek
  'deepseek-chat': 8192, 'deepseek-reasoner': 65536,
  // Groq
  'llama-3.3-70b-versatile': 32768, 'qwen-qwq-32b': 32768,
  // xAI (no separate output cap — use full context)
  'grok-4': 131072, 'grok-3': 131072, 'grok-3-mini': 131072,
  // Mistral
  'mistral-large-latest': 32768, 'codestral-latest': 32768,
  // Moonshot
  'kimi-k2.5': 65535, 'kimi-k2-thinking': 65535,
  // Qwen
  'qwen-max': 8192, 'qwen-plus': 8192,
};

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });
const redis = new Redis(process.env.REDIS_URL!);

// Retry config for transient AI errors (503, 429, timeouts)
const AI_RETRY_ATTEMPTS = 2;
const AI_RETRY_DELAY_MS = 3000;
const RETRYABLE_STATUS = /503|429|529|overloaded|rate.?limit|too many|high demand|temporarily/i;

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

  // 4. Build provider + fallback chain
  const apiKey = decrypt(aiConfig.apiKeyEncrypted);
  const provider = ProviderFactory.create({
    provider: aiConfig.provider,
    model: aiConfig.model,
    apiKey,
    baseUrl: aiConfig.baseUrl ?? undefined,
  });

  // Load fallback providers from the configured chain
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fallbackModels = ((aiConfig as any).fallbackModels ?? []) as Array<{
    provider: string; model: string; apiKeyEncrypted: string; baseUrl?: string;
  }>;
  const fallbackProviders = fallbackModels
    .filter((fb) => fb.apiKeyEncrypted)
    .map((fb) => {
      try {
        return ProviderFactory.create({
          provider: fb.provider,
          model: fb.model,
          apiKey: decrypt(fb.apiKeyEncrypted),
          baseUrl: fb.baseUrl ?? undefined,
        });
      } catch { return null; }
    })
    .filter(Boolean);

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

  const contactPhone = contact?.phoneNumber ?? '';

  // Show "typing…" on WhatsApp and notify dashboard
  await redis.publish('wa:typing', JSON.stringify({
    accountId,
    toPhone: contactPhone,
    action: 'composing',
  })).catch(() => null);
  await redis.publish(`company:${companyId}:events`, JSON.stringify({
    event: 'ai.typing',
    data: { conversationId },
  })).catch(() => null);

  // 6. Agent loop (tool call iterations)
  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    // Try primary provider with retries, then fallbacks
    let response;
    const allProviders = [provider, ...fallbackProviders];
    let succeeded = false;

    for (let pIdx = 0; pIdx < allProviders.length && !succeeded; pIdx++) {
      const currentProvider = allProviders[pIdx]!;
      const isFallback = pIdx > 0;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const currentModel = isFallback ? (fallbackModels[pIdx - 1]?.model ?? 'fallback') : aiConfig.model;

      for (let attempt = 0; attempt <= AI_RETRY_ATTEMPTS; attempt++) {
        try {
          response = await callWithBreaker(companyId, currentProvider, iterationMessages, tools, {
            maxTokens: MODEL_MAX_TOKENS[currentModel] ?? 16384,
            temperature: aiConfig.temperature,
          });
          succeeded = true;
          if (isFallback) {
            logger.info({ ...logCtx, fallbackModel: currentModel, attempt }, 'Succeeded with fallback provider');
          }
          break;
        } catch (err: unknown) {
          const errMsg = String((err as Error)?.message ?? err);
          const isRetryable = RETRYABLE_STATUS.test(errMsg);

          if (isRetryable && attempt < AI_RETRY_ATTEMPTS) {
            const delay = AI_RETRY_DELAY_MS * (attempt + 1);
            logger.warn({ ...logCtx, attempt: attempt + 1, delay, model: currentModel }, 'AI call failed (retryable) — retrying');
            await new Promise((r) => setTimeout(r, delay));
            continue;
          }

          if (pIdx < allProviders.length - 1) {
            logger.warn({ ...logCtx, model: currentModel, err: errMsg }, 'Provider failed, trying fallback');
            break; // try next provider
          }

          // All providers exhausted
          logger.error({ ...logCtx, err }, 'All AI providers failed');
          await redis.publish('wa:typing', JSON.stringify({ accountId, toPhone: contactPhone, action: 'paused' })).catch(() => null);
          await escalateToHuman(conversationId, `AI provider error: ${errMsg.slice(0, 200)}`);
          return;
        }
      }
    }

    if (!response) break; // should not happen — providers return or throw
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

      // Clear WhatsApp typing indicator and send the reply
      await redis.publish('wa:typing', JSON.stringify({
        accountId,
        toPhone: contactPhone,
        action: 'paused',
      })).catch(() => null);

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
