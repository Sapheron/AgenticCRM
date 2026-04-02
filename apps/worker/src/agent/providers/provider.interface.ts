export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  toolName?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatResponse {
  content?: string;
  toolCalls?: ToolCall[];
  tokensUsed: number;
  latencyMs: number;
}

export interface AiProvider {
  readonly provider: string;
  readonly model: string;

  chat(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    opts?: { maxTokens?: number; temperature?: number; timeoutMs?: number },
  ): Promise<ChatResponse>;
}
