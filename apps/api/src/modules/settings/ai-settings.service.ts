import { Injectable } from '@nestjs/common';
import { prisma } from '@wacrm/database';
import type { AiProvider } from '@wacrm/database';
import { encrypt, decrypt } from '@wacrm/shared';

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

// Models available per provider — updated April 2026
export const PROVIDER_MODELS: Record<AiProvider, string[]> = {
  GEMINI: [
    'gemini-2.5-pro',
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-2.0-flash-lite',
  ],
  OPENAI: [
    'gpt-4.1',
    'gpt-4.1-mini',
    'gpt-4.1-nano',
    'gpt-4o',
    'gpt-4o-mini',
    'o4-mini',
    'o3',
  ],
  ANTHROPIC: [
    'claude-opus-4-6',
    'claude-sonnet-4-6',
    'claude-haiku-4-5-20251001',
  ],
  GROQ: [
    'llama-3.3-70b-versatile',
    'deepseek-r1-distill-llama-70b',
    'qwen-qwq-32b',
    'llama-3.1-70b-versatile',
    'llama-3.1-8b-instant',
    'mixtral-8x7b-32768',
    'gemma2-9b-it',
  ],
  OLLAMA: ['llama3.3', 'llama3.1', 'mistral', 'phi4', 'gemma3', 'deepseek-r1', 'qwen2.5'],
  OPENROUTER: [
    'google/gemini-2.5-pro',
    'openai/gpt-4.1',
    'anthropic/claude-sonnet-4-6',
    'deepseek/deepseek-r1',
    'meta-llama/llama-3.3-70b-instruct',
    'auto',
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
        return this.pingGemini(model, apiKey);
      case 'OPENAI':
        return this.pingOpenAI(model, apiKey);
      case 'ANTHROPIC':
        return this.pingAnthropic(model, apiKey);
      case 'GROQ':
        return this.pingOpenAI(model, apiKey, 'https://api.groq.com/openai/v1');
      case 'OLLAMA':
        return this.pingOpenAI(model, apiKey, baseUrl ?? 'http://localhost:11434/v1');
      case 'OPENROUTER':
        return this.pingOpenAI(model, apiKey, 'https://openrouter.ai/api/v1');
      case 'CUSTOM':
        if (!baseUrl) throw new Error('baseUrl is required for CUSTOM provider');
        return this.pingOpenAI(model, apiKey, baseUrl);
      default:
        throw new Error(`Unknown provider: ${provider}`);
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
}
