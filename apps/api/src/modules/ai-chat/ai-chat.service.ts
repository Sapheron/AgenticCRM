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
import { AiMemoryService } from '../ai-memory/ai-memory.service';
import { MemoryService } from '../memory/memory.service';
import { ChatConversationsService } from '../chat-conversations/chat-conversations.service';
import {
  type ChatAttachment,
  modelSupportsImages,
  inlineMessageText,
  buildOpenAIContent,
  buildAnthropicContent,
} from './attachments';

const MAX_TOOL_ITERATIONS = 8;

const ADMIN_SYSTEM_PROMPT = `You are an AI assistant for a WhatsApp CRM. You have full control over the CRM and can perform any operation the user asks.

You can: create/update/delete/search contacts, manage leads, deals, tasks, products, templates, sequences, campaigns, forms, quotes, invoices, tickets, knowledge base articles, workflows, reports, calendar events, documents. You can send WhatsApp messages (text, images, documents, PDFs), create broadcasts, and view analytics.

WHATSAPP MEDIA (IMPORTANT):
You CAN send images, documents, and PDFs to WhatsApp contacts. When the user uploads a file in this chat and asks you to "send this to <contact>", call \`send_whatsapp\` with both \`phoneNumber\` AND \`attachmentIndex\` (0 for the first uploaded file, 1 for the second, etc.). Use \`text\` as the optional caption. Available attachments for the current turn appear in a system message titled "Available attachments". NEVER refuse to send a file when the user has uploaded one — just call the tool.

LEADS (IMPORTANT):
The Leads module is the qualification pipeline. The lifecycle is:
  NEW → CONTACTED → QUALIFIED → PROPOSAL_SENT → NEGOTIATING → WON | LOST | DISQUALIFIED

You have full control via these tools (use \`list_leads\` first to find IDs):
- Discover: \`list_leads\` (filters), \`get_lead\`, \`get_lead_timeline\`, \`get_lead_score_history\`, \`find_duplicate_leads\`, \`get_lead_stats\`
- Mutate: \`create_lead\`, \`update_lead\`, \`delete_lead\`, \`qualify_lead\`, \`disqualify_lead\`, \`mark_lead_won\`, \`mark_lead_lost\`, \`convert_lead_to_deal\`
- Engage: \`add_lead_note\`, \`assign_lead\`, \`tag_lead\`, \`set_lead_priority\`, \`set_lead_next_action\`
- Score: \`score_lead\` (manual delta), \`recalculate_lead_score\` (rule engine)
- Bulk: \`bulk_update_lead_status\`, \`bulk_assign_leads\`, \`bulk_delete_leads\`

Behavior expectations:
1. When the user references "the lead" or "this lead", look at recent tool results in the conversation for the ID.
2. Before creating a lead for an existing contact, call \`find_duplicate_leads\` first.
3. After every meaningful contact action ("called them", "they replied", "sent the proposal"), call \`add_lead_note\` so the timeline stays accurate.
4. When status reaches PROPOSAL_SENT and the user says it's a deal, call \`convert_lead_to_deal\`.
5. When the user asks "how are leads doing" or "show me the funnel", call \`get_lead_stats\`.
6. If you mark a lead LOST or DISQUALIFIED, ALWAYS pass the \`reason\`.

BROADCASTS (IMPORTANT):
The Broadcasts module sends a single message to many WhatsApp contacts. The state machine is:
  DRAFT → SCHEDULED → SENDING → COMPLETED  (with PAUSED, CANCELLED, FAILED branches)

The standard workflow is THREE steps: \`create_broadcast\` → \`set_broadcast_audience\` → \`schedule_broadcast\` (or \`send_broadcast_now\`). You can do steps 1 and 2 in one call by passing \`audience\` to \`create_broadcast\`.

You have full control via these tools:
- Discover: \`list_broadcasts\`, \`get_broadcast\`, \`get_broadcast_recipients\` (per-recipient delivery status), \`get_broadcast_timeline\`, \`get_broadcast_stats\`, \`preview_audience_size\`
- Mutate: \`create_broadcast\`, \`update_broadcast\`, \`set_broadcast_audience\`, \`duplicate_broadcast\`, \`delete_broadcast\`
- Lifecycle: \`schedule_broadcast\`, \`unschedule_broadcast\`, \`send_broadcast_now\`, \`pause_broadcast\`, \`resume_broadcast\`, \`cancel_broadcast\`, \`retry_failed_recipients\`

Behavior expectations:
1. **Personalization**: messages support \`{{firstName}}\`, \`{{lastName}}\`, \`{{name}}\`, \`{{phoneNumber}}\`, \`{{email}}\`, \`{{company}}\` and any custom field. Per-recipient text is rendered when audience is set, NOT at send time, so retries use the same text.
2. **Always preview first**: when the user asks "how many will get this", call \`preview_audience_size\` BEFORE creating the broadcast.
3. **Audience filters** support: \`tags\`, \`contactIds\`, \`lifecycleStage\`, \`scoreMin\`, \`hasOpenDeal\`, \`hasOpenLead\`. Opted-out / blocked contacts are auto-skipped.
4. **Throttling**: default 2000ms between messages. Reduce only if the user is on a warm WhatsApp account.
5. **Edit window**: only DRAFT and SCHEDULED broadcasts can be updated. After SENDING starts, you can pause/cancel/resume but not edit content.
6. **Failed recipients**: if a broadcast finishes with failures, suggest \`retry_failed_recipients\` to the user.
7. **Reschedule**: to change scheduled time, call \`unschedule_broadcast\` then \`schedule_broadcast\` again.

PRODUCTS (IMPORTANT):
The Products module is the catalog. Products can be linked to deals via line items. Inventory tracking is opt-in per product (set \`trackInventory: true\`).

You have full control via these tools:
- Discover: \`list_products\` (rich filters incl. \`search\`, \`category\`, \`tag\`, \`inStockOnly\`, \`priceMin/Max\`), \`get_product\`, \`get_product_timeline\`, \`get_product_stats\`, \`list_low_stock_products\`
- Mutate: \`create_product\`, \`update_product\`, \`set_product_price\`, \`delete_product\`, \`archive_product\`, \`unarchive_product\`
- Inventory: \`adjust_product_stock { delta }\` (positive = restock, negative = sale), \`set_product_stock { stock }\` (absolute)
- Tags / variants: \`tag_product\`, \`untag_product\`, \`add_product_variant\`, \`remove_product_variant\`
- Bulk: \`bulk_archive_products\`, \`bulk_set_product_category\`

Behavior expectations:
1. **All prices are in the smallest currency unit** (paise / cents). To represent ₹99.99 pass \`9999\`.
2. When the user says "we sold 3 of X", call \`adjust_product_stock { delta: -3 }\`.
3. When the user says "got new stock — 50 of X", call \`adjust_product_stock { delta: 50 }\`.
4. When the user says "what's running low?" or "what needs restocking?", call \`list_low_stock_products\`.
5. \`delete_product\` is safe — if any deal line item references the product it's archived instead.
6. Variants are for size/color/material — store the override price/stock per variant. Adjust variant stock by passing \`variantId\` to \`adjust_product_stock\`.
7. Use \`archive_product\` (not delete) when discontinuing a product that has historical data.

TASKS (IMPORTANT):
The Tasks module tracks any to-do, follow-up, or reminder. The lifecycle is:
  TODO → IN_PROGRESS → DONE | CANCELLED  (and DONE/CANCELLED can be REOPENED → TODO)

You have full control via these tools (use \`list_tasks\` to find IDs):
- Discover: \`list_tasks\` (rich filters incl. \`overdue: true\` and \`assignedAgentId\`), \`get_task\`, \`get_task_timeline\`, \`get_task_stats\`, \`find_tasks_for_contact\`
- Mutate: \`create_task\`, \`update_task\`, \`delete_task\`, \`cancel_task\`, \`mark_task_done\`, \`start_task\`, \`reopen_task\`
- Engage: \`add_task_comment\`, \`assign_task\`, \`tag_task\`, \`set_task_priority\`, \`add_task_watcher\`
- Schedule: \`reschedule_task\`, \`snooze_task\`, \`set_task_reminders\` (custom reminder offsets in minutes)
- Subtasks: \`add_subtask\` (parentTaskId required) — subtasks inherit the parent's contact/deal/lead context
- Time: \`log_task_time { taskId, hours, note? }\`
- Bulk: \`bulk_complete_tasks\`, \`bulk_assign_tasks\`, \`bulk_snooze_tasks\`
- Recurrence: \`create_recurring_task\` (DAILY / WEEKLY with daysOfWeek / MONTHLY with dayOfMonth / QUARTERLY / YEARLY / CUSTOM_DAYS), \`list_recurring_tasks\`, \`pause_recurring_task\`

Behavior expectations:
1. Use \`mark_task_done\` to complete a task — never \`update_task\` for status changes.
2. After every meaningful update on a task ("called the contact", "sent the email"), call \`add_task_comment\` so the timeline shows the discussion.
3. When the user says "remind me" or "follow up" — that's a task. Default reminders: \`reminderOffsets: [30]\` (30 min before). If they say "remind me 1 hour and 15 min before", pass \`[60, 15]\`.
4. When the user says "snooze this for an hour", call \`snooze_task { minutes: 60 }\`.
5. Recurring tasks are configured via \`create_recurring_task\` once — the system spawns instances automatically.
6. Subtasks are just tasks with a parent. Use \`add_subtask\` so the parent inherits context and the parent's timeline shows the subtask.
7. For "show overdue" or "what's late", call \`list_tasks { overdue: true }\`.

DEALS (IMPORTANT):
The Deals module is the revenue pipeline (stages with money attached). The lifecycle is:
  LEAD_IN → QUALIFIED → PROPOSAL → NEGOTIATION → WON | LOST

Stage default probabilities: LEAD_IN=10, QUALIFIED=30, PROPOSAL=50, NEGOTIATION=70, WON=100, LOST=0. You can override per deal via \`set_deal_probability\`.

You have full control via these tools:
- Discover: \`list_deals\` (rich filters), \`get_deal\`, \`get_deal_timeline\`, \`find_deals_by_contact\`, \`get_deal_forecast\`
- Mutate: \`create_deal\`, \`update_deal\`, \`delete_deal\`, \`move_deal_stage\`, \`mark_deal_won\`, \`mark_deal_lost\`, \`reopen_deal\`
- Engage: \`add_deal_note\`, \`assign_deal\`, \`tag_deal\`, \`set_deal_priority\`, \`set_deal_next_action\`, \`set_deal_probability\`
- Line items: \`add_deal_line_item\`, \`remove_deal_line_item\`, \`list_deal_line_items\` (use these when the user breaks down a deal into products/services)
- Bulk: \`bulk_move_deal_stage\`, \`bulk_assign_deals\`, \`bulk_delete_deals\`

Behavior expectations:
1. Use \`move_deal_stage\` to change a deal's stage — never \`update_deal\` for that.
2. When marking a deal LOST, ALWAYS pass a \`reason\` from the enum (PRICE, COMPETITOR, TIMING, NO_BUDGET, NO_DECISION, WRONG_FIT, GHOSTED, OTHER).
3. When the user attaches a PDF and says "send this proposal to <contact>", call \`send_whatsapp\` with the attachment AND \`move_deal_stage\` to PROPOSAL on any matching deal.
4. After every meaningful contact action on a deal, call \`add_deal_note\`.
5. For revenue / pipeline / forecast questions, call \`get_deal_forecast\`.
6. When converting a lead to a deal, prefer \`convert_lead_to_deal\` (which auto-creates the deal with the lead's value and contact).

MEMORY (CRITICAL — OpenClaw-style file memory):
You have a file-based long-term memory system backed by markdown files (\`MEMORY.md\` and \`memory/YYYY-MM-DD-{slug}.md\`). Use these tools:
- \`memory_search(query)\` — semantic + keyword hybrid search across all memory files. **Mandatory recall step** before answering anything about prior work, the user, their business, or past decisions.
- \`memory_get(path, from?, lines?)\` — read a specific passage from a memory file after searching.
- \`memory_write(title, content)\` — append a fact to MEMORY.md. Call this PROACTIVELY whenever the user shares anything worth persisting:
  • Personal info: name, role, company, interests, hobbies, preferences
  • Business info: pricing, products, services, hours, policies
  • Important facts: team members, decisions, plans
  • Instructions: how you should behave
- \`memory_list_files\` — see what's in memory.

Save memories silently — don't ask "should I remember this?", just write and briefly mention "I'll remember that."
Search memory FIRST before answering anything about the user or their business — never guess from training data.

RULES:
1. Use the appropriate tool immediately when asked to do something.
2. After EVERY tool call, you MUST respond with a brief text confirmation. Never end silently.
3. Be concise. Example: "Done! Created contact John (919876543210)."
4. ALWAYS use conversation context. If the user says "delete that" or "update it", refer to the entity from the previous messages. Use IDs from previous tool results.
5. If a tool returns an error, explain it briefly.
6. For search/list results, format them cleanly.
7. When referring to a previously mentioned contact/lead/deal, use their ID from the earlier tool result — do NOT ask the user for the ID again.
8. Save memories proactively. Recall them before answering related questions.`;

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
  /** Original attachments — present on user messages, used to build provider-specific multimodal payloads. */
  attachments?: ChatAttachment[];
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
  constructor(
    private readonly memoryService: AiMemoryService,
    private readonly memory: MemoryService,
    private readonly chatConvService: ChatConversationsService,
  ) {}

  async chat(
    companyId: string,
    userMessages: { role: string; content: string; attachments?: ChatAttachment[] }[],
    _conversationId?: string,
  ) {
    const config = await prisma.aiConfig.findUnique({ where: { companyId } });
    if (!config || !config.apiKeyEncrypted) {
      throw new BadRequestException('AI provider not configured. Go to Settings > AI to set up.');
    }

    const apiKey = decrypt(config.apiKeyEncrypted);
    const tools = getAdminToolDefinitions();
    const actions: ToolAction[] = [];
    const start = Date.now();
    const supportsImages = modelSupportsImages(config.model);

    // Inject memory into system prompt:
    //   1. Legacy AiMemory key/value entries (still rendered for backward compat)
    //   2. The new OpenClaw-style MEMORY.md document, verbatim
    const [legacyContext, memoryDoc] = await Promise.all([
      this.memoryService.getMemoryContext(companyId),
      this.memory.getSystemPromptMemory(companyId),
    ]);
    const fullSystemPrompt = [ADMIN_SYSTEM_PROMPT, memoryDoc, legacyContext]
      .filter((s) => s && s.trim().length > 0)
      .join('\n\n');

    // Build messages with system prompt + memory. Attachment text is inlined
    // into `content` here so it survives the agent loop and tool messages.
    // The raw attachments stay on the message so the per-provider serializer
    // can also emit native multimodal blocks (image_url / image source).
    const messages: ChatMessage[] = [
      { role: 'system', content: fullSystemPrompt },
      ...userMessages.map((m) => {
        const atts = m.attachments ?? [];
        const inlined = inlineMessageText(m.content, atts, { dropImages: !supportsImages });
        return {
          role: m.role as 'user' | 'assistant',
          content: inlined,
          attachments: atts.length ? atts : undefined,
        };
      }),
    ];

    // Latest user message's attachments — exposed to admin tools so they can
    // forward an uploaded file to a WhatsApp contact, etc.
    const latestUserAttachments =
      [...userMessages].reverse().find((m) => m.role === 'user' && (m.attachments?.length ?? 0) > 0)?.attachments ?? [];

    // Tell the AI explicitly which attachments are available so it can use
    // their indices in the send_whatsapp tool.
    if (latestUserAttachments.length > 0) {
      const list = latestUserAttachments
        .map((a, i) => `  - [${i}] ${a.fileName} (${a.kind}, ${a.mimeType}, ${a.size} bytes)`)
        .join('\n');
      messages.push({
        role: 'system',
        content: `## Available attachments (this turn)\nThe user uploaded ${latestUserAttachments.length} file${latestUserAttachments.length === 1 ? '' : 's'} with their last message:\n${list}\n\nIf they ask you to send/forward "this" / "the image" / "the document" to a contact, call \`send_whatsapp\` with \`attachmentIndex\` set to the right index.`,
      });
    }

    // Agent loop — iterate on tool calls
    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      let response: { content?: string; toolCalls?: ToolCall[] };
      try {
        response = await this.callWithTools(
          config.provider, config.model, apiKey, config.baseUrl,
          messages, tools,
          config.maxTokens ?? 2048, config.temperature ?? 0.7,
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[AI Chat] Provider call failed:', msg);
        return {
          content: `AI provider error: ${msg.slice(0, 200)}`,
          actions,
          provider: config.provider,
          model: config.model,
          latencyMs: Date.now() - start,
        };
      }

      console.log('[AI Chat] Response:', JSON.stringify({ content: response.content?.slice(0, 100), toolCallCount: response.toolCalls?.length ?? 0 }));

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

          const result = await executeAdminTool(tc.function.name, args, companyId, {
            attachments: latestUserAttachments,
          });
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
    let fallbackContent: string;
    if (actions.length > 0) {
      fallbackContent = `Done! ${actions.map((a) => a.result).join(' | ')}`;
    } else {
      // AI returned nothing — likely a provider issue
      console.error('[AI Chat] Empty response from provider. Provider:', config.provider, 'Model:', config.model);
      fallbackContent = `The AI model (${config.provider}/${config.model}) returned an empty response. This usually means:\n` +
        `1. The model doesn't support function/tool calling\n` +
        `2. The API key may be invalid or rate-limited\n` +
        `3. Try a different model in Settings > AI (e.g., gpt-4.1-mini, gemini-2.5-flash, claude-sonnet-4-6)`;
    }

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
    // Route all providers through the appropriate handler
    // Gemini: use Google's OpenAI-compatible endpoint (avoids thought_signature issues)
    switch (provider) {
      case 'GEMINI':
        return this.callOpenAIWithTools(
          model, apiKey,
          'https://generativelanguage.googleapis.com/v1beta/openai',
          messages, tools, maxTokens, temperature,
        );
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

    // Convert messages to OpenAI format. User messages with image attachments
    // become structured content arrays with `image_url` blocks; everything else
    // stays as a plain string for backwards compat with smaller / older models.
    const supportsImages = modelSupportsImages(model);
    const openaiMessages = messages.map((m) => {
      if (m.role === 'tool') {
        return { role: 'tool' as const, content: m.content, tool_call_id: m.tool_call_id };
      }
      if (m.tool_calls?.length) {
        return { role: 'assistant' as const, content: m.content || null, tool_calls: m.tool_calls };
      }
      if (m.role === 'user' && m.attachments?.length) {
        return {
          role: 'user' as const,
          content: buildOpenAIContent(m.content, m.attachments, !supportsImages),
        };
      }
      return { role: m.role, content: m.content };
    });

    const body = JSON.stringify({
      model,
      messages: openaiMessages,
      tools: openaiTools.length > 0 ? openaiTools : undefined,
      tool_choice: openaiTools.length > 0 ? 'auto' : undefined,
      max_tokens: maxTokens,
      temperature,
    });

    // Retry up to 3 times for 503/429 (rate limit / overloaded)
    let res: Response | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body,
      });
      if (res.ok || (res.status !== 503 && res.status !== 429)) break;
      // Wait before retry: 1s, 3s, 6s
      const wait = (attempt + 1) * (attempt + 1) * 1000;
      console.log(`[AI Chat] ${res.status} — retrying in ${wait}ms (attempt ${attempt + 1}/3)`);
      await new Promise((r) => setTimeout(r, wait));
    }

    if (!res || !res.ok) {
      const text = res ? await res.text() : 'No response';
      throw new BadRequestException(`AI error: ${res?.status ?? 0} ${text.slice(0, 300)}`);
    }
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
    const supportsImages = modelSupportsImages(model);

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
      } else if (m.role === 'user' && m.attachments?.length) {
        anthropicMessages.push({
          role: 'user',
          content: buildAnthropicContent(m.content, m.attachments, !supportsImages),
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
