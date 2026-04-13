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
import { PROVIDER_BASE_URLS, AiSettingsService } from '../settings/ai-settings.service';
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

/**
 * Classify an error into a failover reason — mirrors OpenClaw's FailoverReason type.
 *
 * | reason           | action              |
 * |------------------|---------------------|
 * | rate_limit       | try next candidate  |
 * | overloaded       | try next candidate  |
 * | timeout          | try next candidate  |
 * | auth             | try next candidate  |
 * | billing          | try next candidate  |
 * | model_not_found  | try next candidate  |
 * | unknown          | STOP — propagate    |
 */
type FailoverReason =
  | 'rate_limit'
  | 'overloaded'
  | 'timeout'
  | 'auth'
  | 'billing'
  | 'model_not_found'
  | 'unknown';

function classifyError(msg: string): FailoverReason {
  const m = msg.toLowerCase();

  // Rate limit (429)
  if (
    m.includes('429') ||
    m.includes('rate limit') ||
    m.includes('rate_limit') ||
    m.includes('too many requests') ||
    m.includes('quota exceeded') ||
    m.includes('resource_exhausted')
  ) return 'rate_limit';

  // Overloaded / high demand (503, 529)
  if (
    m.includes('503') ||
    m.includes('529') ||
    m.includes('overload') ||
    m.includes('high demand') ||
    m.includes('currently experiencing') ||
    m.includes('service unavailable') ||
    m.includes('temporarily unavailable') ||
    m.includes('capacity')
  ) return 'overloaded';

  // Timeout / network (408, 500, 502, 504)
  if (
    m.includes('408') ||
    m.includes('502') ||
    m.includes('504') ||
    m.includes('timeout') ||
    m.includes('timed out') ||
    m.includes('connection error') ||
    m.includes('network error') ||
    m.includes('econnreset') ||
    m.includes('econnrefused')
  ) return 'timeout';

  // Auth failure (401, 403)
  if (
    m.includes('401') ||
    m.includes('403') ||
    m.includes('invalid api key') ||
    m.includes('unauthorized') ||
    m.includes('forbidden') ||
    m.includes('authentication') ||
    m.includes('invalid_api_key')
  ) return 'auth';

  // Billing (402)
  if (
    m.includes('402') ||
    m.includes('payment required') ||
    m.includes('insufficient credits') ||
    m.includes('billing') ||
    m.includes('subscription')
  ) return 'billing';

  // Model not found / deactivated
  if (
    m.includes('model not found') ||
    m.includes('model_not_found') ||
    m.includes('model_deactivated') ||
    m.includes('no such model') ||
    m.includes('does not exist')
  ) return 'model_not_found';

  return 'unknown';
}

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

TEMPLATES (IMPORTANT):
The Templates module stores reusable message templates with variable substitution (\`{{name}}\`, \`{{company}}\`, etc.). The lifecycle is: DRAFT → ACTIVE → ARCHIVED.

You have full control via these tools:
- Discover: \`list_templates\` (filters: status, category, type, search), \`get_template\` (details + variables), \`get_template_stats\` (usage analytics)
- Mutate: \`create_template\` (always starts as DRAFT), \`update_template\` (only DRAFT/ARCHIVED), \`activate_template\` (DRAFT → ACTIVE), \`archive_template\`, \`duplicate_template\`, \`delete_template\`
- Use: \`send_template\` (send via WhatsApp with variable substitution), \`preview_template\` (render without sending)

Template categories: greeting, follow_up, promotion, payment_reminder, order_update, support, feedback, review, appointment, general
Template types: TEXT, IMAGE, DOCUMENT, VIDEO, LOCATION, CONTACTS

Behavior expectations:
1. **Variables**: Use double curly braces \`{{firstName}}\`, \`{{company}}\`, \`{{amount}}\`, etc. Variables are extracted from the body automatically on activation.
2. **Always create as DRAFT**: \`create_template\` creates a draft. Use \`activate_template\` when the user confirms it's ready.
3. **Preview first**: Before sending, use \`preview_template\` to show the rendered output with sample variables.
4. **Track usage**: Templates track useCount, sentCount, and conversionCount. Use \`get_template_stats\` to see which templates perform best.
5. **Templates vs Broadcasts**: Templates are for single sends with personalization. Broadcasts are for bulk sends. Use templates for quick replies, broadcasts for campaigns.
6. **Edit restriction**: Only DRAFT and ARCHIVED templates can be edited. To edit an ACTIVE template, archive it first or duplicate.

SEQUENCES (IMPORTANT):
Sequences are automated drip campaigns that send messages over time. The lifecycle is: DRAFT → ACTIVE → PAUSED → ARCHIVED. Enrollments: ACTIVE → PAUSED → COMPLETED | STOPPED | CANCELLED.

A sequence has multiple steps with delays between them. Each step can:
- Send WhatsApp message (with template)
- Send email (placeholder - not implemented)
- Wait (delay)
- Add/remove tags from contact
- Trigger webhook
- Execute AI task (placeholder - not implemented)

You have full control via these tools:
- Discover: \`list_sequences\` (filters: status, search, tags, sort), \`get_sequence\` (with steps), \`get_sequence_timeline\`, \`get_sequence_stats\`, \`get_sequence_performance\` (detailed metrics)
- Mutate: \`create_sequence\` (starts as DRAFT), \`update_sequence\`, \`activate_sequence\` (DRAFT → ACTIVE), \`pause_sequence\` (ACTIVE → PAUSED), \`archive_sequence\`, \`duplicate_sequence\`, \`delete_sequence\` (DRAFT/ARCHIVED only)
- Steps: \`add_sequence_step\`, \`update_sequence_step\`, \`remove_sequence_step\`, \`reorder_sequence_steps\`
- Enrollments: \`list_enrollments\`, \`get_enrollment_timeline\`, \`enroll_contact_in_sequence\`, \`unenroll_contact_from_sequence\`, \`pause_enrollment\`, \`resume_enrollment\`, \`stop_enrollment\`
- Bulk: \`bulk_enroll_contacts\`, \`bulk_unenroll_contacts\`, \`bulk_pause_enrollments\`
- Smart features: \`suggest_sequence { context } (search memory for similar sequences), \`learn_from_sequence\` (store successful patterns)

Behavior expectations:
1. **Standard workflow**: Use \`create_sequence\` to build a DRAFT, \`add_sequence_step\` to add steps with delays and actions, \`activate_sequence\` to make it live, \`enroll_contact_in_sequence\` to add contacts.
2. **Automatic execution**: The worker processes enrollments every minute. You don't manually send messages — the system runs steps based on \`nextRunAt\`.
3. **Step actions**: send_message, send_email, wait, add_tag, remove_tag, webhook, ai_task. Delays are in hours from the previous step.
4. **Templates in sequences**: Steps can reference templates by \`templateId\`. Template variables are rendered with contact data. Use \`{{firstName}}\`, \`{{company}}\`, etc. for personalization.
5. **Smart suggestions**: When a user asks for automated follow-ups, first use \`suggest_sequence { context: "follow up after demo" }\` to find existing patterns. Offer to create if no good match.
6. **Learning**: High-performing sequences (80%+ completion) are automatically promoted to long-term memory via the dreaming process.
7. **Enrollment states**: ACTIVE (progressing), PAUSED (temporarily stopped), COMPLETED (all steps done), STOPPED (terminated), CANCELLED (removed).
8. **Bulk operations**: Use \`bulk_enroll_contacts\` to add multiple contacts at once. \`bulk_pause_enrollments\` to pause multiple.
9. **Analytics**: Use \`get_sequence_performance\` to see drop-off analysis per step. This helps optimize step order and timing.
10. **When to use sequences**: For any automated drip campaign, nurture sequence, onboarding flow, or follow-up cadence. Don't use for one-off sends.

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

KNOWLEDGE BASE (help articles + customer self-service):
You manage KB articles that serve two purposes: (1) internal reference for the team, and (2) public customer self-service at \`/public/kb/:slug\`.

Lifecycle: DRAFT → PUBLISHED → ARCHIVED. Only PUBLISHED + isPublic articles are visible on the public reader.

Typical flow:
1. \`create_kb_article\` with title + content (markdown supported) + category.
2. \`update_kb_article\` to refine content.
3. \`publish_kb_article\` to make it live.
4. \`get_kb_public_url\` to share the reader link.

**Key tool**: \`search_knowledge_base\` — before answering customer questions about products, processes, or policies, ALWAYS search the KB first. If a published article covers the topic, cite it or link to it instead of guessing from training data. This is how the team's documented knowledge gets surfaced through the AI.

Rules:
1. \`publish_kb_article\` only works on DRAFT articles. You cannot publish directly from ARCHIVED.
2. Content supports markdown. The public reader renders it as HTML.
3. Set \`isPublic: false\` for internal-only articles (team reference, not customer-facing).
4. Categories are free-text strings, not an enum — use whatever the user says ("billing", "setup", "troubleshooting", etc.).

TICKETS (customer support with SLA tracking):
You manage support tickets end-to-end. Each ticket has a status FSM (OPEN → IN_PROGRESS → WAITING → ESCALATED → RESOLVED → CLOSED), a priority (LOW/MEDIUM/HIGH/CRITICAL), comments (public + internal), and optional SLA tracking. Tickets can be assigned to agents, escalated, merged, or reopened.

Lifecycle: OPEN → IN_PROGRESS / WAITING / ESCALATED → RESOLVED → CLOSED. Reopening goes from RESOLVED/CLOSED back to OPEN (clears resolvedAt/closedAt).

Typical flow:
1. \`create_ticket\` — pass title + description + priority + category + contactId + optionally assignedToId.
2. \`assign_ticket\` — assigns to an agent. Also stamps \`firstResponseAt\` if it's the first assignment.
3. \`add_ticket_comment\` — public reply visible to the customer. Use \`isInternal: true\` for team-only notes.
4. \`change_ticket_status\` — move through the FSM. "Resolve" sets RESOLVED; "Close" sets CLOSED.
5. If unresolvable at the current level: \`escalate_ticket\` with a reason.

Rules:
1. Always use \`change_ticket_status\` for status changes, NOT \`update_ticket\`. \`update_ticket\` is for field patches (title, description, priority, category, tags).
2. \`escalate_ticket\` ALWAYS takes a reason.
3. \`add_ticket_comment\` with \`isInternal: false\` is what the customer sees. \`isInternal: true\` is team-only.
4. When the user says "merge these two tickets", call \`merge_tickets\` — comments from the source move to the target, source is closed.
5. When the user asks "what's my SLA performance" or "any breached tickets", call \`get_ticket_stats\` or \`list_tickets\` with \`slaBreached: true\`.
6. Only CLOSED tickets can be deleted.

PAYMENTS (gateway links + manual recording + refunds):
You track every payment that flows through the CRM — gateway payments (Razorpay, Stripe, Cashfree, PhonePe, PayU) and manual payments (cash, bank transfer, cheque, UPI recorded by the admin). Each payment links optionally to a Contact, Deal, and/or Invoice. When a payment with \`invoiceId\` is PAID or REFUNDED, the invoice auto-updates its amountPaid so you never have to manually reconcile.

**Money is in minor units** (paise/cents). 50000 = ₹500.00. Same rule as Quotes / Invoices.

Lifecycle: PENDING → PAID / FAILED / EXPIRED / REFUNDED. Refunds may be full or partial. Only PAID payments can be refunded. Only PENDING payments can be cancelled (cancellation flips status to EXPIRED).

Two main flows:

**Gateway flow** (for online payments):
1. \`create_payment_link\` — pass contactId + amount + description + optional invoiceId. Returns a hosted URL from Razorpay/Stripe/etc.
2. Send the URL to the customer via \`send_whatsapp\`.
3. When the customer pays, the gateway webhook auto-flips the payment to PAID and reconciles the linked invoice.

**Manual flow** (for cash/bank transfers):
1. \`record_manual_payment\` — admin records a cash/bank-transfer/cheque payment with the amount + method + optional invoiceId. Creates a Payment with provider=NONE and status=PAID immediately.
2. Linked invoice auto-updates in the same call.

Rules:
1. Always use minor units for \`amount\`. "₹30,000 payment" = \`30000\` * 100 = \`3000000\` (NO — that's wrong). ₹30,000 = 3,000,000 paise = \`{ amount: 3000000 }\`. Double-check: ₹N × 100 = N-in-minor-units.
2. **Prefer linking to an invoice** — when a payment is for an invoice, always pass \`invoiceId\` so the reconciliation is automatic. If you don't know the invoiceId, \`list_invoices\` with a contactId filter first.
3. For manual payments: \`record_manual_payment\` (not \`create_payment_link\`) — the gateway shouldn't be involved.
4. \`refund_payment\` always takes an optional reason. Defaults to a full refund when \`amount\` is omitted. For Cashfree/PhonePe/PayU, API refunds aren't wired — the tool returns an error telling the user to refund via the provider dashboard.
5. When the user asks "did X pay yet?", call \`list_payments_for_contact\` or \`list_payments_for_invoice\`.
6. When the user asks "how much revenue this month?", call \`get_payment_stats\` — it returns received/pending/refunded totals and a success rate.
7. Don't delete PAID or REFUNDED payments — they're part of the financial record. Use \`refund_payment\` to reverse a PAID payment instead.

INVOICES (billable documents with payment tracking):
You manage invoices end-to-end — the already-agreed pricing that bills a customer after a deal or quote is closed. Invoices track partial payments, auto-transition to PAID when fully received, and can be converted directly from an ACCEPTED Quote via \`create_invoice_from_quote\`.

**Money is in minor units** (paise/cents). 50000 = ₹500.00. Tax is bps (1800 = 18%). Same rules as Quotes — never pass floats.

Lifecycle: DRAFT → SENT → VIEWED → PARTIALLY_PAID → PAID / OVERDUE / CANCELLED / VOID. Only DRAFT or SENT invoices can be edited. VOID is terminal and stronger than CANCELLED (used for billing errors and legal corrections).

Typical flow when the user asks for a new invoice:
1. \`create_invoice\` with contactId (+ optional dealId), currency, taxBps, dueDate, and initial line items OR empty.
2. \`add_invoice_line_item\` once per item. Totals auto-recompute.
3. \`send_invoice\` — DRAFT → SENT, stamps sentAt, makes the public URL live.
4. \`get_invoice_public_url\` — returns the shareable customer link.
5. When payment arrives, call \`record_invoice_payment\` with the exact amount (supports partial). When \`amountPaid >= total\`, status auto-flips to PAID.

**Quote → Invoice shortcut**: when the user says "create an invoice from this quote" and the quote is ACCEPTED, call \`create_invoice_from_quote\` with just the quoteId. Everything — line items, totals, contact, deal, terms — is copied automatically and the new invoice links back via fromQuoteId.

Rules:
1. Always use minor units for amounts. "Payment of ₹30,000" = \`{ amount: 3000000 }\`.
2. Use \`record_invoice_payment\` (not \`mark_invoice_paid\`) when the user knows the exact amount — it supports partial payments. \`mark_invoice_paid\` is a shortcut for "mark fully paid" without specifying an amount.
3. \`cancel_invoice\` and \`void_invoice\` ALWAYS take a \`reason\`. Void is irreversible — reserve it for billing errors.
4. Invoices aren't negotiable — if the user is still discussing price, they want a Quote, not an Invoice.
5. When the user asks "who hasn't paid me" or "what's outstanding", call \`list_invoices\` with \`status=SENT,VIEWED,PARTIALLY_PAID,OVERDUE\` or just \`get_invoice_stats\` for totals.
6. To share via WhatsApp: chain \`send_invoice\` + \`get_invoice_public_url\` + \`send_whatsapp\` with the URL in the body.

QUOTES (sales proposals with customer accept/reject flow):
You manage sales quotes end-to-end. A quote bundles line items (products/services with quantity × unit price) + tax + discount + validity + terms, and has a shareable public URL so the customer can view it and click Accept or Reject.

**Money is in minor units** (paise/cents). 50000 = ₹500.00. Never pass floats.
**Tax is in basis points** (bps). 1800 = 18.00%.

Lifecycle: DRAFT → SENT → VIEWED → ACCEPTED / REJECTED / EXPIRED / REVOKED. Only DRAFT or SENT quotes can be edited. Line items auto-recompute totals via a pure calculator so you never have to compute subtotal/tax/total yourself — just add/remove items and the service does the math.

Typical flow when the user asks for a new quote:
1. \`create_quote\` with contactId (+ optional dealId), currency, taxBps, and an initial \`lineItems\` array OR empty if you'll add them one at a time.
2. \`add_quote_line_item\` once per line item. Totals are recomputed automatically after each add.
3. (Optional) \`update_quote\` to set validUntil, terms, autoMoveDealOnAccept.
4. \`send_quote\` — flips to SENT and makes the public URL live.
5. \`get_quote_public_url\` — returns the shareable link for the customer.

Rules:
1. Always use minor units for \`unitPrice\` and \`discount\`. If the user says "₹500", send 50000.
2. Always use bps for tax. "18% GST" = 1800.
3. \`send_quote\` fails if there are zero line items. Always add at least one first.
4. \`reject_quote\` and \`revoke_quote\` ALWAYS take a \`reason\` — record it so the timeline explains why.
5. When the user says "convert this quote to a done deal" and the quote has a linked Deal, the customer accepting with \`autoMoveDealOnAccept=true\` handles that automatically. Otherwise use \`accept_quote\` which moves the deal too when the flag is on.
6. If the user asks "what's my quote pipeline value", call \`get_quote_stats\`.
7. To share a quote with a customer via WhatsApp: first \`send_quote\`, then \`get_quote_public_url\`, then \`send_whatsapp\` with the URL in the text body.

FORMS (lead capture + custom intake):
You manage web forms end-to-end. A form is a collection of typed fields (text, email, phone, number, textarea, select, radio, checkbox, date, url) with optional auto-actions that fire on every submission (auto-create lead, enrol in sequence, tag contact, assign user, forward to external webhook).

Lifecycle: DRAFT → ACTIVE → PAUSED → ARCHIVED. Only DRAFT/PAUSED forms can be published; only DRAFT/ARCHIVED forms can be deleted.

Typical flow when the user asks for a new form:
1. \`create_form\` in DRAFT with just a name.
2. \`add_form_field\` once per field — always pick a sensible \`key\` (e.g. \`email\`, \`phone\`, \`full_name\`, \`message\`).
3. \`set_form_auto_actions\` — when the form collects contact info, turn on \`autoCreateLead\` with an appropriate \`autoLeadSource\` (usually FORM or WEBSITE).
4. Optionally call \`update_form\` with \`isPublic: true\` to expose the hosted URL.
5. \`publish_form\` — fails if there are zero fields, so only call after step 2.
6. \`get_form_public_url\` to share the hosted link.

Rules:
1. \`add_form_field\` requires \`formId\`, \`key\`, \`type\`, \`label\`. For \`select\` and \`radio\`, pass \`options\` as \`[{value, label}]\`.
2. \`publish_form\` requires at least one field. Always call \`add_form_field\` first.
3. When the user says "make the form live", check both: status must go to ACTIVE (\`publish_form\`) AND \`isPublic\` must be true (\`update_form\`).
4. To diagnose why form submissions aren't appearing as leads, call \`list_form_submissions\` with \`status=RECEIVED,SPAM\` — RECEIVED but not CONVERTED usually means autoCreateLead is off or the form has no email/phone field.
5. Always \`add_form_note\` after any manual status change or when the user explains something worth preserving about the form's purpose.
6. Never guess slugs — always return the slug or id from the service response.

CAMPAIGNS (marketing orchestration):
You control marketing campaigns end-to-end. A campaign bundles an audience filter + a channel + a send mode + (optionally) a template or sequence, then launches in one of three ways:
- \`DIRECT\` — campaign owns its own rate-limited sender, uses a Template to render per-recipient bodies. Requires \`templateId\`.
- \`BROADCAST\` — dispatches a one-shot Broadcast on launch. No template needed (Broadcast has its own body).
- \`SEQUENCE\` — enrolls the resolved audience into an existing Sequence. Requires \`sequenceId\`.

Lifecycle: DRAFT → SCHEDULED → SENDING → PAUSED / COMPLETED / CANCELLED / FAILED. Only DRAFT and SCHEDULED campaigns can be edited.

Typical flow when the user asks for a new campaign:
1. \`create_campaign\` in DRAFT with name + channel + sendMode + templateId/sequenceId.
2. \`set_campaign_audience\` with tags and/or contactIds (AND semantics on tags).
3. \`preview_campaign_audience\` to validate the filter — report the match count to the user.
4. \`schedule_campaign\` for future-time launches, or \`launch_campaign\` to start now.
5. \`add_campaign_note\` after any manual status change.

Rules:
1. Never launch a campaign before calling \`set_campaign_audience\` — an empty audience errors out.
2. \`cancel_campaign\` ALWAYS takes a \`reason\`. The reason goes into the activity log.
3. When the user says "show me campaign performance", call \`get_campaign_stats\` (aggregate) or \`get_campaign\` (per-campaign).
4. To diagnose under-delivery, call \`list_campaign_recipients\` with \`status=FAILED,SKIPPED,OPTED_OUT\`.
5. Use \`attach_campaign_to_sequence\` / \`attach_campaign_to_broadcast\` when the user wants to switch a DRAFT campaign's send mode.

ANALYTICS (business intelligence):
You have 15 analytics tools covering every dimension of the business. Use them proactively.

Key tools:
- \`get_crm_summary\` — one-shot health check. Call this when the user asks "how is the business doing", "how are sales", "give me an overview", or any vague performance question.
- \`get_revenue_trends\` — revenue over time (day/week/month). Pass \`groupBy: "month"\` for monthly view.
- \`get_conversion_funnel\` — lead-to-win rates at each stage.
- \`get_agent_performance\` — per-agent: conversations resolved, deals won, tickets resolved.
- \`compare_analytics_periods\` — current vs prior period delta for all key KPIs.
- \`get_analytics_dashboard\` — full KPI set: contacts, leads, pipeline, revenue, tickets.

Rules:
1. Revenue and deal values are in minor units (paise/cents). Always divide by 100 to display: ₹(value/100).
2. When user asks "last 7 days", pass \`days: 7\`. "This month" ≈ 30. "Last quarter" ≈ 90.
3. After calling \`get_crm_summary\`, highlight the 2-3 most notable facts (biggest win, biggest risk, best performer).
4. For drill-downs ("which agents?", "what sources?"), follow up with the specific tool, don't ask the user to call it.
5. Format large numbers: 1,000,000 → 10L or 1M. Revenue → ₹X.XX.

MEMORY (CRITICAL — OpenClaw-style file memory):
You have a file-based long-term memory system backed by markdown files (\`MEMORY.md\` and \`memory/YYYY-MM-DD-{slug}.md\`). Use these tools:
- \`memory_search(query)\` — hybrid keyword + vector search across every indexed memory file. Run this first before answering anything about prior work, the user, their business, or past decisions.
- \`memory_get(path, from?, lines?)\` — read a passage from a memory file. **If \`memory_search\` returns no hits but you suspect the fact may live in MEMORY.md, call \`memory_get\` with path="MEMORY.md" before saying you don't know.** Search results come from chunked indexes which can miss edge cases — \`memory_get\` reads the raw file.
- \`memory_write(title, content)\` — append a fact to MEMORY.md. Call this PROACTIVELY whenever the user shares anything worth persisting:
  • Personal info: name, role, company, interests, hobbies, preferences
  • Business info: pricing, products, services, hours, policies
  • Important facts: team members, decisions, plans
  • Instructions: how you should behave
- \`memory_list_files\` — see what's in memory.

Save memories silently — don't ask "should I remember this?", just write and briefly mention "I'll remember that."
If a search returns "MEMORY_SEARCH_UNAVAILABLE", tell the user the search is broken — do NOT assert the requested fact does not exist.

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
    private readonly aiSettings: AiSettingsService,
  ) {}

  async chat(
    companyId: string,
    userMessages: { role: string; content: string; attachments?: ChatAttachment[] }[],
    _conversationId?: string,
    userPermissions: string[] = [],
    userRole: string = 'AGENT',
  ) {
    const config = await prisma.aiConfig.findUnique({ where: { companyId } });
    if (!config || !config.apiKeyEncrypted) {
      throw new BadRequestException('AI provider not configured. Go to Settings > AI to set up.');
    }

    const apiKey = decrypt(config.apiKeyEncrypted);
    const tools = getAdminToolDefinitions(userPermissions, userRole);
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

    // Build the provider chain: primary + fallbacks
    const fallbacks = await this.aiSettings.getResolvedFallbacks(companyId);
    const providerChain = [
      { provider: config.provider as string, model: config.model, apiKey, baseUrl: config.baseUrl },
      ...fallbacks,
    ];
    // Track which provider actually responded
    let activeProvider = config.provider as string;
    let activeModel = config.model;

    // Agent loop — iterate on tool calls
    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      let response: { content?: string; toolCalls?: ToolCall[] } | undefined;
      try {
        // Try each provider in the chain — stop at the first success
        let lastErr: Error | null = null;
        let succeeded = false;
        for (const candidate of providerChain) {
          try {
            response = await this.callWithTools(
              candidate.provider, candidate.model, candidate.apiKey, candidate.baseUrl,
              messages, tools,
              config.maxTokens ?? 2048, config.temperature ?? 0.7,
            );
            activeProvider = candidate.provider;
            activeModel = candidate.model;
            succeeded = true;
            if (candidate !== providerChain[0]) {
              console.log(`[AI Chat] Fallback succeeded: ${candidate.provider}/${candidate.model}`);
            }
            break;
          } catch (err: unknown) {
            lastErr = err instanceof Error ? err : new Error(String(err));
            const reason = classifyError(lastErr.message);
            if (reason === 'unknown') throw lastErr; // unknown error → stop chain, propagate immediately
            console.warn(`[AI Chat] ${candidate.provider}/${candidate.model} [${reason}] — trying next: ${lastErr.message.slice(0, 120)}`);
          }
        }
        if (!succeeded) throw lastErr ?? new Error('All providers failed');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[AI Chat] All providers failed:', msg);
        return {
          content: `AI provider error: ${msg.slice(0, 200)}`,
          actions,
          provider: activeProvider,
          model: activeModel,
          latencyMs: Date.now() - start,
        };
      }

      // catch always returns, so response is guaranteed set here
      const res = response!;

      console.log('[AI Chat] Response:', JSON.stringify({ content: res.content?.slice(0, 100), toolCallCount: res.toolCalls?.length ?? 0 }));

      // Tool call path
      if (res.toolCalls?.length) {
        // Add assistant message with tool calls to context
        messages.push({
          role: 'assistant',
          content: '',
          tool_calls: res.toolCalls,
        });

        // Execute each tool and add results
        for (const tc of res.toolCalls) {
          let args: Record<string, unknown> = {};
          try { args = JSON.parse(tc.function.arguments); } catch { /* empty */ }

          const result = await executeAdminTool(tc.function.name, args, companyId, {
            attachments: latestUserAttachments,
            userPermissions,
            userRole,
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
      if (res.content) {
        return {
          content: res.content,
          actions,
          provider: activeProvider,
          model: activeModel,
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
