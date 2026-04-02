/**
 * OpenAI provider — also used for Groq, Ollama, and OpenRouter
 * since all are OpenAI-compatible APIs.
 */
import OpenAI from 'openai';
import type { AiProvider, ChatMessage, ToolDefinition, ChatResponse } from './provider.interface';

export class OpenAiProvider implements AiProvider {
  readonly provider: string;
  readonly model: string;
  private readonly client: OpenAI;

  constructor(
    apiKey: string,
    model = 'gpt-4o-mini',
    providerName = 'OPENAI',
    baseUrl?: string,
  ) {
    this.provider = providerName;
    this.model = model;
    this.client = new OpenAI({ apiKey, baseURL: baseUrl });
  }

  async chat(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    opts: { maxTokens?: number; temperature?: number; timeoutMs?: number } = {},
  ): Promise<ChatResponse> {
    const start = Date.now();

    const openaiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = messages.map((m) => {
      if (m.role === 'tool') {
        return { role: 'tool', content: m.content, tool_call_id: m.toolCallId ?? '' };
      }
      return { role: m.role as 'system' | 'user' | 'assistant', content: m.content };
    });

    const openaiTools: OpenAI.Chat.ChatCompletionTool[] = tools.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));

    const response = await this.client.chat.completions.create(
      {
        model: this.model,
        messages: openaiMessages,
        tools: openaiTools.length > 0 ? openaiTools : undefined,
        tool_choice: openaiTools.length > 0 ? 'auto' : undefined,
        max_tokens: opts.maxTokens ?? 1024,
        temperature: opts.temperature ?? 0.7,
      },
      { timeout: opts.timeoutMs ?? 30000 },
    );

    const choice = response.choices[0];
    const toolCalls = choice?.message.tool_calls?.map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments) as Record<string, unknown>,
    }));

    return {
      content: choice?.message.content ?? undefined,
      toolCalls: toolCalls?.length ? toolCalls : undefined,
      tokensUsed: response.usage?.total_tokens ?? 0,
      latencyMs: Date.now() - start,
    };
  }
}
