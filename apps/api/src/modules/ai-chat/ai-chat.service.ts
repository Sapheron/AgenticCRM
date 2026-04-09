import { Injectable, BadRequestException } from '@nestjs/common';
import { prisma } from '@wacrm/database';
import { decrypt } from '@wacrm/shared';
import { PROVIDER_BASE_URLS } from '../settings/ai-settings.service';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

@Injectable()
export class AiChatService {
  async chat(companyId: string, messages: ChatMessage[]) {
    const config = await prisma.aiConfig.findUnique({ where: { companyId } });
    if (!config || !config.apiKeyEncrypted) {
      throw new BadRequestException('AI provider not configured. Go to Settings > AI to set up.');
    }

    const apiKey = decrypt(config.apiKeyEncrypted);
    const start = Date.now();

    const content = await this.callProvider(
      config.provider,
      config.model,
      apiKey,
      config.baseUrl,
      messages,
      config.maxTokens ?? 1024,
      config.temperature ?? 0.7,
    );

    return {
      content,
      provider: config.provider,
      model: config.model,
      latencyMs: Date.now() - start,
    };
  }

  private async callProvider(
    provider: string,
    model: string,
    apiKey: string,
    baseUrl: string | null | undefined,
    messages: ChatMessage[],
    maxTokens: number,
    temperature: number,
  ): Promise<string> {
    switch (provider) {
      case 'GEMINI':
        return this.callGemini(model, apiKey, messages, maxTokens, temperature);
      case 'ANTHROPIC':
        return this.callAnthropic(model, apiKey, messages, maxTokens, temperature);
      case 'OLLAMA':
        return this.callOpenAICompat(model, apiKey, baseUrl ?? 'http://localhost:11434/v1', messages, maxTokens, temperature);
      case 'CUSTOM':
        if (!baseUrl) throw new BadRequestException('baseUrl required for CUSTOM provider');
        return this.callOpenAICompat(model, apiKey, baseUrl, messages, maxTokens, temperature);
      default: {
        // OPENAI, GROQ, DEEPSEEK, XAI, MISTRAL, TOGETHER, MOONSHOT, OPENROUTER
        const url = provider === 'OPENAI'
          ? 'https://api.openai.com/v1'
          : (PROVIDER_BASE_URLS as Record<string, string | undefined>)[provider];
        if (!url) throw new BadRequestException(`Unknown provider: ${provider}`);
        return this.callOpenAICompat(model, apiKey, url, messages, maxTokens, temperature);
      }
    }
  }

  private async callOpenAICompat(
    model: string, apiKey: string, baseUrl: string,
    messages: ChatMessage[], maxTokens: number, temperature: number,
  ): Promise<string> {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature }),
    });
    if (!res.ok) throw new BadRequestException(`AI error: ${res.status} ${await res.text()}`);
    const json = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    return json.choices?.[0]?.message?.content ?? '';
  }

  private async callGemini(
    model: string, apiKey: string,
    messages: ChatMessage[], maxTokens: number, temperature: number,
  ): Promise<string> {
    const contents = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
    const systemInstruction = messages.find((m) => m.role === 'system');

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents,
          ...(systemInstruction ? { systemInstruction: { parts: [{ text: systemInstruction.content }] } } : {}),
          generationConfig: { maxOutputTokens: maxTokens, temperature },
        }),
      },
    );
    if (!res.ok) throw new BadRequestException(`Gemini error: ${res.status} ${await res.text()}`);
    const json = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    return json.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  }

  private async callAnthropic(
    model: string, apiKey: string,
    messages: ChatMessage[], maxTokens: number, temperature: number,
  ): Promise<string> {
    const system = messages.find((m) => m.role === 'system')?.content;
    const chatMessages = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role, content: m.content }));

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature,
        ...(system ? { system } : {}),
        messages: chatMessages,
      }),
    });
    if (!res.ok) throw new BadRequestException(`Anthropic error: ${res.status} ${await res.text()}`);
    const json = await res.json() as { content?: Array<{ text?: string }> };
    return json.content?.[0]?.text ?? '';
  }
}
