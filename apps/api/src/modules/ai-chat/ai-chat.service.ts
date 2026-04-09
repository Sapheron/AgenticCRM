/**
 * AI Chat Service — Admin can chat with AI and control the entire CRM via tools.
 * Implements the same iterative agent loop pattern as the worker's agent-loop.ts:
 * 1. Send messages + tool definitions to AI
 * 2. If AI returns tool_calls → execute them → feed results back → repeat
 * 3. If AI returns text → return to user
 * Max 8 iterations to prevent infinite loops.
 */
import { Injectable, BadRequestException } from '@nestjs/common';
import { prisma } from '@wacrm/database';
import { decrypt } from '@wacrm/shared';
import { PROVIDER_BASE_URLS } from '../settings/ai-settings.service';
import { getAdminToolDefinitions, executeAdminTool } from './admin-tools';

const MAX_TOOL_ITERATIONS = 8;

const ADMIN_SYSTEM_PROMPT = `You are an AI assistant for a WhatsApp CRM. You have full control over the CRM and can perform any operation the user asks.

You can: create/update/delete/search contacts, manage leads, deals, tasks, products, templates, sequences, campaigns, forms, quotes, invoices, tickets, knowledge base articles, workflows, reports, calendar events, documents. You can send WhatsApp messages, create broadcasts, and view analytics.

IMPORTANT RULES:
1. When the user asks you to do something, use the appropriate tool immediately.
2. After EVERY tool call, you MUST respond with a text message confirming what you did. Never end your turn without a text response.
3. Be concise. Example: "Done! Created contact John (919876543210)."
4. If a tool returns an error, explain it briefly and suggest what to do.
5. For listing data, format the results in a clean readable way.`;

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface ToolAction {
  tool: string;
  args: Record<string, unknown>;
  result: string;
}

@Injectable()
export class AiChatService {
  async chat(companyId: string, userMessages: { role: string; content: string }[]) {
    const config = await prisma.aiConfig.findUnique({ where: { companyId } });
    if (!config || !config.apiKeyEncrypted) {
      throw new BadRequestException('AI provider not configured. Go to Settings > AI to set up.');
    }

    const apiKey = decrypt(config.apiKeyEncrypted);
    const tools = getAdminToolDefinitions();
    const actions: ToolAction[] = [];
    const start = Date.now();

    // Build messages with system prompt
    const messages: ChatMessage[] = [
      { role: 'system', content: ADMIN_SYSTEM_PROMPT },
      ...userMessages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    ];

    // Agent loop — iterate on tool calls
    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const response = await this.callWithTools(
        config.provider, config.model, apiKey, config.baseUrl,
        messages, tools,
        config.maxTokens ?? 2048, config.temperature ?? 0.7,
      );

      // Tool call path
      if (response.toolCalls?.length) {
        // Add assistant message with tool calls to context
        messages.push({
          role: 'assistant',
          content: '',
          tool_calls: response.toolCalls,
        });

        // Execute each tool and add results
        for (const tc of response.toolCalls) {
          let args: Record<string, unknown> = {};
          try { args = JSON.parse(tc.function.arguments); } catch { /* empty */ }

          const result = await executeAdminTool(tc.function.name, args, companyId);
          actions.push({ tool: tc.function.name, args, result });

          messages.push({
            role: 'tool',
            content: result,
            tool_call_id: tc.id,
          });
        }
        continue; // Loop again with tool results
      }

      // Text response path — done
      if (response.content) {
        return {
          content: response.content,
          actions,
          provider: config.provider,
          model: config.model,
          latencyMs: Date.now() - start,
        };
      }

      break; // No content and no tool calls — done
    }

    // If tools executed but AI didn't provide a text summary, build one
    const fallbackContent = actions.length > 0
      ? `Done! ${actions.map((a) => a.result).join(' | ')}`
      : 'I couldn\'t generate a response. Please try rephrasing your request.';

    return {
      content: fallbackContent,
      actions,
      provider: config.provider,
      model: config.model,
      latencyMs: Date.now() - start,
    };
  }

  // ── Provider calls with tool support ────────────────────────────────────

  private async callWithTools(
    provider: string, model: string, apiKey: string, baseUrl: string | null | undefined,
    messages: ChatMessage[], tools: { name: string; description: string; parameters: Record<string, unknown> }[],
    maxTokens: number, temperature: number,
  ): Promise<{ content?: string; toolCalls?: ToolCall[] }> {
    switch (provider) {
      case 'GEMINI':
        return this.callGeminiWithTools(model, apiKey, messages, tools, maxTokens, temperature);
      case 'ANTHROPIC':
        return this.callAnthropicWithTools(model, apiKey, messages, tools, maxTokens, temperature);
      case 'OLLAMA':
        return this.callOpenAIWithTools(model, apiKey, baseUrl ?? 'http://localhost:11434/v1', messages, tools, maxTokens, temperature);
      case 'CUSTOM':
        if (!baseUrl) throw new BadRequestException('baseUrl required for CUSTOM');
        return this.callOpenAIWithTools(model, apiKey, baseUrl, messages, tools, maxTokens, temperature);
      default: {
        const url = provider === 'OPENAI' ? 'https://api.openai.com/v1' : (PROVIDER_BASE_URLS as Record<string, string | undefined>)[provider];
        if (!url) throw new BadRequestException(`Unknown provider: ${provider}`);
        return this.callOpenAIWithTools(model, apiKey, url, messages, tools, maxTokens, temperature);
      }
    }
  }

  private async callOpenAIWithTools(
    model: string, apiKey: string, baseUrl: string,
    messages: ChatMessage[], tools: { name: string; description: string; parameters: Record<string, unknown> }[],
    maxTokens: number, temperature: number,
  ): Promise<{ content?: string; toolCalls?: ToolCall[] }> {
    const openaiTools = tools.map((t) => ({
      type: 'function' as const,
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));

    // Convert messages to OpenAI format
    const openaiMessages = messages.map((m) => {
      if (m.role === 'tool') {
        return { role: 'tool' as const, content: m.content, tool_call_id: m.tool_call_id };
      }
      if (m.tool_calls?.length) {
        return { role: 'assistant' as const, content: m.content || null, tool_calls: m.tool_calls };
      }
      return { role: m.role, content: m.content };
    });

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: openaiMessages,
        tools: openaiTools.length > 0 ? openaiTools : undefined,
        tool_choice: openaiTools.length > 0 ? 'auto' : undefined,
        max_tokens: maxTokens,
        temperature,
      }),
    });

    if (!res.ok) throw new BadRequestException(`AI error: ${res.status} ${await res.text()}`);
    const json = await res.json() as {
      choices?: Array<{
        message?: {
          content?: string;
          tool_calls?: ToolCall[];
        };
      }>;
    };

    const choice = json.choices?.[0]?.message;
    return {
      content: choice?.content ?? undefined,
      toolCalls: choice?.tool_calls?.length ? choice.tool_calls : undefined,
    };
  }

  private async callAnthropicWithTools(
    model: string, apiKey: string,
    messages: ChatMessage[], tools: { name: string; description: string; parameters: Record<string, unknown> }[],
    maxTokens: number, temperature: number,
  ): Promise<{ content?: string; toolCalls?: ToolCall[] }> {
    const system = messages.find((m) => m.role === 'system')?.content;

    // Convert messages to Anthropic format
    const anthropicMessages: Array<Record<string, unknown>> = [];
    for (const m of messages) {
      if (m.role === 'system') continue;
      if (m.role === 'tool') {
        anthropicMessages.push({
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: m.tool_call_id, content: m.content }],
        });
      } else if (m.tool_calls?.length) {
        anthropicMessages.push({
          role: 'assistant',
          content: m.tool_calls.map((tc) => ({
            type: 'tool_use',
            id: tc.id,
            name: tc.function.name,
            input: JSON.parse(tc.function.arguments),
          })),
        });
      } else {
        anthropicMessages.push({ role: m.role, content: m.content });
      }
    }

    const anthropicTools = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }));

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
        messages: anthropicMessages,
        tools: anthropicTools.length > 0 ? anthropicTools : undefined,
      }),
    });

    if (!res.ok) throw new BadRequestException(`Anthropic error: ${res.status} ${await res.text()}`);
    const json = await res.json() as {
      content?: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>;
    };

    const textBlock = json.content?.find((b) => b.type === 'text');
    const toolBlocks = json.content?.filter((b) => b.type === 'tool_use') ?? [];

    if (toolBlocks.length > 0) {
      return {
        content: textBlock?.text,
        toolCalls: toolBlocks.map((tb) => ({
          id: tb.id!,
          type: 'function' as const,
          function: { name: tb.name!, arguments: JSON.stringify(tb.input) },
        })),
      };
    }

    return { content: textBlock?.text };
  }

  private async callGeminiWithTools(
    model: string, apiKey: string,
    messages: ChatMessage[], tools: { name: string; description: string; parameters: Record<string, unknown> }[],
    maxTokens: number, temperature: number,
  ): Promise<{ content?: string; toolCalls?: ToolCall[] }> {
    const systemInstruction = messages.find((m) => m.role === 'system');
    const contents: Array<Record<string, unknown>> = [];

    for (const m of messages) {
      if (m.role === 'system') continue;
      if (m.role === 'tool') {
        contents.push({
          role: 'function',
          parts: [{ functionResponse: { name: 'tool', response: { result: m.content } } }],
        });
      } else if (m.tool_calls?.length) {
        contents.push({
          role: 'model',
          parts: m.tool_calls.map((tc) => ({
            functionCall: { name: tc.function.name, args: JSON.parse(tc.function.arguments) },
          })),
        });
      } else {
        contents.push({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        });
      }
    }

    const geminiTools = tools.length > 0 ? [{
      functionDeclarations: tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      })),
    }] : undefined;

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents,
          ...(systemInstruction ? { systemInstruction: { parts: [{ text: systemInstruction.content }] } } : {}),
          ...(geminiTools ? { tools: geminiTools } : {}),
          generationConfig: { maxOutputTokens: maxTokens, temperature },
        }),
      },
    );

    if (!res.ok) throw new BadRequestException(`Gemini error: ${res.status} ${await res.text()}`);
    const json = await res.json() as {
      candidates?: Array<{
        content?: {
          parts?: Array<{ text?: string; functionCall?: { name: string; args: Record<string, unknown> } }>;
        };
      }>;
    };

    const parts = json.candidates?.[0]?.content?.parts ?? [];
    const functionCalls = parts.filter((p) => p.functionCall);
    const textParts = parts.filter((p) => p.text);

    if (functionCalls.length > 0) {
      return {
        toolCalls: functionCalls.map((fc, i) => ({
          id: `gemini_${i}_${Date.now()}`,
          type: 'function' as const,
          function: { name: fc.functionCall!.name, arguments: JSON.stringify(fc.functionCall!.args) },
        })),
      };
    }

    return { content: textParts.map((p) => p.text).join('') };
  }
}
