/**
 * Opossum circuit breaker wrapping AI provider calls.
 * Per-company breaker: if a company's AI provider fails 5 times,
 * the breaker opens and conversations are escalated to human agents.
 */
import CircuitBreaker from 'opossum';
import pino from 'pino';
import type { AiProvider, ChatMessage, ToolDefinition, ChatResponse } from '../agent/providers/provider.interface';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

// One breaker per companyId
const breakers = new Map<string, CircuitBreaker<[AiProvider, ChatMessage[], ToolDefinition[], Record<string, unknown>], ChatResponse>>();

const BREAKER_OPTIONS: CircuitBreaker.Options = {
  timeout: 35000,       // 35s — AI calls can be slow
  errorThresholdPercentage: 50,
  volumeThreshold: 5,   // minimum calls before tripping
  resetTimeout: 60000,  // 1 minute cool-down
};

function getBreaker(companyId: string) {
  if (!breakers.has(companyId)) {
    const fn = async (
      provider: AiProvider,
      messages: ChatMessage[],
      tools: ToolDefinition[],
      opts: Record<string, unknown>,
    ): Promise<ChatResponse> => {
      return provider.chat(messages, tools, opts as { maxTokens?: number; temperature?: number });
    };

    const breaker = new CircuitBreaker(fn, BREAKER_OPTIONS);

    breaker.on('open', () => logger.warn({ companyId }, 'AI circuit breaker OPEN'));
    breaker.on('halfOpen', () => logger.info({ companyId }, 'AI circuit breaker HALF-OPEN'));
    breaker.on('close', () => logger.info({ companyId }, 'AI circuit breaker CLOSED'));

    breakers.set(companyId, breaker);
  }
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return breakers.get(companyId)!;
}

export function isCircuitOpen(companyId: string): boolean {
  return breakers.get(companyId)?.opened ?? false;
}

export async function callWithBreaker(
  companyId: string,
  provider: AiProvider,
  messages: ChatMessage[],
  tools: ToolDefinition[],
  opts: { maxTokens?: number; temperature?: number } = {},
): Promise<ChatResponse> {
  const breaker = getBreaker(companyId);
  return breaker.fire(provider, messages, tools, opts as Record<string, unknown>);
}
