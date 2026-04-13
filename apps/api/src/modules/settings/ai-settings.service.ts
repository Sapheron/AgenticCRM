import { Injectable } from '@nestjs/common';
import { prisma } from '@wacrm/database';
import type { AiProvider } from '@wacrm/database';
import { encrypt, decrypt } from '@wacrm/shared';

export interface FallbackModelEntry {
  provider: string;
  model: string;
  apiKey?: string;          // plain text — encrypted before storing
  apiKeyEncrypted?: string; // stored form
  baseUrl?: string;
}

export interface UpsertAiConfigDto {
  provider: AiProvider;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  systemPrompt?: string;
  tone?: string;
  maxTokens?: number;
  temperature?: number;
  autoReplyEnabled?: boolean;
  toolCallingEnabled?: boolean;
}

// Base URLs for OpenAI-compatible providers
export const PROVIDER_BASE_URLS: Partial<Record<AiProvider, string>> = {
  GROQ: 'https://api.groq.com/openai/v1',
  DEEPSEEK: 'https://api.deepseek.com/v1',
  XAI: 'https://api.x.ai/v1',
  MISTRAL: 'https://api.mistral.ai/v1',
  TOGETHER: 'https://api.together.xyz/v1',
  MOONSHOT: 'https://api.moonshot.ai/v1',
  GLM: 'https://open.bigmodel.cn/api/paas/v4',
  QWEN: 'https://dashscope-intl.aliyuncs.com/v1',
  STEPFUN: 'https://api.stepfun.com/v1',
  OPENROUTER: 'https://openrouter.ai/api/v1',
};

// Models available per provider — synced with OpenClaw + verified against live APIs
export const PROVIDER_MODELS: Record<AiProvider, string[]> = {
  GEMINI: [
    // Stable (production-ready)
    'gemini-2.5-pro',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    // Preview (newer, may change)
    'gemini-3.1-pro-preview',
    'gemini-3.1-flash-preview',
    'gemini-3.1-flash-lite-preview',
    'gemini-3-pro-preview',
    'gemini-3-flash-preview',
  ],
  OPENAI: [
    // Stable
    'gpt-4.1',
    'gpt-4.1-mini',
    'gpt-4.1-nano',
    'gpt-4o',
    'gpt-4o-mini',
    'o4-mini',
    'o3',
    // Latest (may require access)
    'gpt-5.4',
    'gpt-5.4-mini',
    'gpt-5.4-nano',
    'gpt-5.4-pro',
  ],
  ANTHROPIC: [
    'claude-opus-4-6',
    'claude-sonnet-4-6',
    'claude-sonnet-4-5',
    'claude-haiku-4-5-20251001',
  ],
  GROQ: [
    'llama-3.3-70b-versatile',
    'deepseek-r1-distill-llama-70b',
    'qwen-qwq-32b',
    'llama-3.1-8b-instant',
    'mixtral-8x7b-32768',
    'gemma2-9b-it',
  ],
  DEEPSEEK: [
    'deepseek-chat',
    'deepseek-reasoner',
  ],
  XAI: [
    'grok-4',
    'grok-4-fast',
    'grok-4-1-fast',
    'grok-3',
    'grok-3-mini',
    'grok-3-fast',
  ],
  MISTRAL: [
    'mistral-large-latest',
    'mistral-medium-latest',
    'mistral-small-latest',
    'codestral-latest',
  ],
  TOGETHER: [
    'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    'meta-llama/Llama-4-Scout-17B-16E-Instruct',
    'meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8',
    'deepseek-ai/DeepSeek-V3.1',
    'deepseek-ai/DeepSeek-R1',
    'moonshotai/Kimi-K2.5',
  ],
  MOONSHOT: [
    'kimi-k2.5',
    'kimi-k2-thinking',
    'kimi-k2-thinking-turbo',
    'kimi-k2-turbo',
  ],
  GLM: [
    'glm-5.1',
    'glm-5',
    'glm-5-turbo',
    'glm-4.7',
    'glm-4.7-flash',
    'glm-4.6',
    'glm-4.5',
    'glm-4.5-flash',
  ],
  QWEN: [
    'qwen-max',
    'qwen-plus',
    'qwen3.5',
    'qwen-2.5-vl-72b-instruct',
  ],
  STEPFUN: [
    'step-2-16k',
    'step-1-200k',
    'step-1-32k',
  ],
  OLLAMA: ['llama3.3', 'llama3.1', 'mistral', 'phi4', 'gemma3', 'deepseek-r1', 'qwen2.5'],
  OPENROUTER: [
    'auto',
    'openrouter/hunter-alpha',
    'openrouter/healer-alpha',
    'google/gemini-3.1-pro',
    'openai/gpt-5.4',
    'anthropic/claude-sonnet-4-6',
    'deepseek/deepseek-r1',
    'meta-llama/llama-3.3-70b-instruct',
  ],
  CUSTOM: ['custom'],
};

@Injectable()
export class AiSettingsService {
  async get(companyId: string) {
    const config = await prisma.aiConfig.findUnique({ where: { companyId } });
    if (!config) return null;
    return {
      ...config,
      // Never return the raw encrypted key — just indicate if it's set
      apiKeySet: !!config.apiKeyEncrypted,
      apiKeyEncrypted: undefined,
    };
  }

  async upsert(companyId: string, dto: UpsertAiConfigDto) {
    const data: Record<string, unknown> = {
      provider: dto.provider,
      model: dto.model,
      systemPrompt: dto.systemPrompt,
      tone: dto.tone,
      maxTokens: dto.maxTokens,
      temperature: dto.temperature,
      autoReplyEnabled: dto.autoReplyEnabled,
      toolCallingEnabled: dto.toolCallingEnabled,
      baseUrl: dto.baseUrl ?? null,
    };

    // Only update apiKey if a new one was provided
    if (dto.apiKey && dto.apiKey.trim().length > 0) {
      data.apiKeyEncrypted = encrypt(dto.apiKey.trim());
    }

    return prisma.aiConfig.upsert({
      where: { companyId },
      create: { companyId, ...data },
      update: data,
    });
  }

  async test(companyId: string) {
    const config = await prisma.aiConfig.findUnique({ where: { companyId } });
    if (!config || !config.apiKeyEncrypted) {
      return { ok: false, error: 'AI provider is not configured. Please save your settings before testing.' };
    }

    const apiKey = decrypt(config.apiKeyEncrypted);
    const start = Date.now();

    try {
      const reply = await this.pingProvider(config.provider, config.model, apiKey, config.baseUrl);
      const latencyMs = Date.now() - start;

      await prisma.aiConfig.update({
        where: { companyId },
        data: { testStatus: 'ok', testError: null },
      });

      return { ok: true, reply, latencyMs };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      await prisma.aiConfig.update({
        where: { companyId },
        data: { testStatus: 'error', testError: message },
      });
      return { ok: false, error: message };
    }
  }

  getProviderModels(provider: AiProvider): string[] {
    return PROVIDER_MODELS[provider] ?? [];
  }

  // ── Private: quick ping per provider ────────────────────────────────────────

  private async pingProvider(
    provider: AiProvider,
    model: string,
    apiKey: string,
    baseUrl?: string | null,
  ): Promise<string> {
    switch (provider) {
      case 'GEMINI':
        // Use OpenAI-compatible endpoint for Gemini (avoids thought_signature issues)
        return this.pingOpenAI(model, apiKey, 'https://generativelanguage.googleapis.com/v1beta/openai');
      case 'OPENAI':
        return this.pingOpenAI(model, apiKey);
      case 'ANTHROPIC':
        return this.pingAnthropic(model, apiKey);
      case 'OLLAMA':
        return this.pingOpenAI(model, apiKey, baseUrl ?? 'http://localhost:11434/v1');
      case 'CUSTOM':
        if (!baseUrl) throw new Error('baseUrl is required for CUSTOM provider');
        return this.pingOpenAI(model, apiKey, baseUrl);
      default: {
        // All other providers (GROQ, DEEPSEEK, XAI, MISTRAL, TOGETHER, MOONSHOT, OPENROUTER)
        // use OpenAI-compatible APIs with their specific base URL
        const providerUrl = PROVIDER_BASE_URLS[provider];
        if (!providerUrl) throw new Error(`Unknown provider: ${provider}`);
        return this.pingOpenAI(model, apiKey, providerUrl);
      }
    }
  }

  private async pingGemini(model: string, apiKey: string): Promise<string> {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: 'Say "pong" in one word.' }] }] }),
      },
    );
    if (!res.ok) throw new Error(`Gemini error: ${res.status} ${await res.text()}`);
    const json = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    return json.candidates?.[0]?.content?.parts?.[0]?.text ?? 'ok';
  }

  private async pingOpenAI(model: string, apiKey: string, baseUrl = 'https://api.openai.com/v1'): Promise<string> {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Say "pong" in one word.' }],
        max_tokens: 10,
      }),
    });
    if (!res.ok) throw new Error(`API error: ${res.status} ${await res.text()}`);
    const json = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    return json.choices?.[0]?.message?.content ?? 'ok';
  }

  private async pingAnthropic(model: string, apiKey: string): Promise<string> {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Say "pong" in one word.' }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic error: ${res.status} ${await res.text()}`);
    const json = await res.json() as { content?: Array<{ text?: string }> };
    return json.content?.[0]?.text ?? 'ok';
  }

  // ── Fallback model chain ────────────────────────────────────────────────────

  /** Return the fallback chain (API keys masked). */
  async getFallbacks(companyId: string): Promise<Array<{
    provider: string; model: string; baseUrl?: string; apiKeySet: boolean;
  }>> {
    const config = await prisma.aiConfig.findUnique({ where: { companyId } });
    const raw = (config?.fallbackModels ?? []) as unknown as FallbackModelEntry[];
    return raw.map(({ provider, model, baseUrl, apiKeyEncrypted }) => ({
      provider,
      model,
      baseUrl,
      apiKeySet: !!apiKeyEncrypted,
    }));
  }

  /** Append a fallback model entry. Max 5 fallbacks. */
  async addFallback(companyId: string, entry: FallbackModelEntry): Promise<void> {
    const config = await prisma.aiConfig.findUnique({ where: { companyId } });
    const existing = (config?.fallbackModels ?? []) as unknown as FallbackModelEntry[];
    if (existing.length >= 5) throw new Error('Maximum 5 fallback models allowed');

    const stored: FallbackModelEntry = {
      provider: entry.provider,
      model: entry.model,
      baseUrl: entry.baseUrl,
      apiKeyEncrypted: entry.apiKey?.trim() ? encrypt(entry.apiKey.trim()) : undefined,
    };
    await prisma.aiConfig.update({
      where: { companyId },
      data: { fallbackModels: JSON.parse(JSON.stringify([...existing, stored])) },
    });
  }

  /** Remove a fallback by index. */
  async removeFallback(companyId: string, index: number): Promise<void> {
    const config = await prisma.aiConfig.findUnique({ where: { companyId } });
    const existing = (config?.fallbackModels ?? []) as unknown as FallbackModelEntry[];
    existing.splice(index, 1);
    await prisma.aiConfig.update({ where: { companyId }, data: { fallbackModels: JSON.parse(JSON.stringify(existing)) } });
  }

  /**
   * Resolve the full fallback chain for use in ai-chat.service.ts.
   * Returns decrypted keys — never expose this outside the API backend.
   */
  async getResolvedFallbacks(companyId: string): Promise<Array<{
    provider: string; model: string; apiKey: string; baseUrl?: string | null;
  }>> {
    const config = await prisma.aiConfig.findUnique({ where: { companyId } });
    if (!config) return [];
    const primaryKey = config.apiKeyEncrypted ? decrypt(config.apiKeyEncrypted) : '';
    const raw = (config.fallbackModels ?? []) as unknown as FallbackModelEntry[];
    return raw.map((f) => ({
      provider: f.provider,
      model: f.model,
      baseUrl: f.baseUrl,
      // Reuse the primary key if no separate key was configured for this fallback
      apiKey: f.apiKeyEncrypted ? decrypt(f.apiKeyEncrypted) : primaryKey,
    }));
  }
}
