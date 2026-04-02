import Anthropic from '@anthropic-ai/sdk';
import type { AiProvider, ChatMessage, ToolDefinition, ChatResponse } from './provider.interface';

export class AnthropicProvider implements AiProvider {
  readonly provider = 'ANTHROPIC';
  readonly model: string;
  private readonly client: Anthropic;

  constructor(apiKey: string, model = 'claude-sonnet-4-6') {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async chat(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    opts: { maxTokens?: number; temperature?: number; timeoutMs?: number } = {},
  ): Promise<ChatResponse> {
    const start = Date.now();

    const systemMsg = messages.find((m) => m.role === 'system');
    const conversationMsgs = messages.filter((m) => m.role !== 'system');

    const anthropicMessages: Anthropic.MessageParam[] = conversationMsgs.map((m) => {
      if (m.role === 'tool') {
        return {
          role: 'user' as const,
          content: [{
            type: 'tool_result' as const,
            tool_use_id: m.toolCallId ?? '',
            content: m.content,
          }],
        };
      }
      return {
        role: m.role as 'user' | 'assistant',
        content: m.content,
      };
    });

    const anthropicTools: Anthropic.Tool[] = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters as Anthropic.Tool['input_schema'],
    }));

    const response = await this.client.messages.create(
      {
        model: this.model,
        system: systemMsg?.content,
        messages: anthropicMessages,
        tools: anthropicTools.length > 0 ? anthropicTools : undefined,
        max_tokens: opts.maxTokens ?? 1024,
        temperature: opts.temperature ?? 0.7,
      },
      { timeout: opts.timeoutMs ?? 30000 },
    );

    const textBlock = response.content.find((b) => b.type === 'text');
    const toolUseBlocks = response.content.filter((b) => b.type === 'tool_use') as Anthropic.ToolUseBlock[];

    const toolCalls = toolUseBlocks.map((b) => ({
      id: b.id,
      name: b.name,
      arguments: b.input as Record<string, unknown>,
    }));

    const tokensUsed = response.usage.input_tokens + response.usage.output_tokens;

    return {
      content: textBlock?.type === 'text' ? textBlock.text : undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      tokensUsed,
      latencyMs: Date.now() - start,
    };
  }
}
