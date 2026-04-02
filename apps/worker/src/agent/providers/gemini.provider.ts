import { GoogleGenerativeAI, type Content } from '@google/generative-ai';
import type { AiProvider, ChatMessage, ToolDefinition, ChatResponse } from './provider.interface';

export class GeminiProvider implements AiProvider {
  readonly provider = 'GEMINI';
  readonly model: string;
  private readonly client: GoogleGenerativeAI;

  constructor(apiKey: string, model = 'gemini-2.5-flash') {
    this.client = new GoogleGenerativeAI(apiKey);
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

    const genModel = this.client.getGenerativeModel({
      model: this.model,
      systemInstruction: systemMsg?.content,
      generationConfig: {
        maxOutputTokens: opts.maxTokens ?? 1024,
        temperature: opts.temperature ?? 0.7,
      },
      tools: tools.length > 0
        ? [{ functionDeclarations: tools.map((t) => ({
            name: t.name,
            description: t.description,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            parameters: t.parameters as any,
          })) }]
        : undefined,
    });

    const history: Content[] = conversationMsgs.slice(0, -1).map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const lastMsg = conversationMsgs[conversationMsgs.length - 1];
    const chat = genModel.startChat({ history });
    const result = await chat.sendMessage(lastMsg?.content ?? '');
    const response = result.response;

    const toolCalls = response.functionCalls()?.map((fc) => ({
      id: fc.name,
      name: fc.name,
      arguments: fc.args as Record<string, unknown>,
    }));

    const usage = response.usageMetadata;
    const tokensUsed = (usage?.promptTokenCount ?? 0) + (usage?.candidatesTokenCount ?? 0);

    return {
      content: response.text() || undefined,
      toolCalls: toolCalls?.length ? toolCalls : undefined,
      tokensUsed,
      latencyMs: Date.now() - start,
    };
  }
}
