/**
 * Chat attachment helpers — modeled on OpenClaw's `parseMessageWithAttachments`.
 *
 * Two supported attachment kinds:
 *   - `image`  — passed natively to vision-capable models as multimodal blocks
 *                (OpenAI-compatible `image_url`, Anthropic `image` source).
 *   - `text`   — text/code/markdown/JSON/CSV files. We read the bytes as UTF-8
 *                and inline them into the user message as fenced code blocks
 *                so EVERY model (vision or not) can reason about them.
 *
 * Anything else is rejected at the controller boundary.
 *
 * Vision-model gating: if a user attaches an image but the configured model
 * doesn't support vision, we drop the image and append a short notice to the
 * text content so the user knows what happened.
 */

export type AttachmentKind = 'image' | 'text';

export interface ChatAttachment {
  kind: AttachmentKind;
  mimeType: string;
  fileName: string;
  size: number;
  /** base64-encoded payload (no `data:...;base64,` prefix). Always present for images. */
  dataBase64?: string;
  /** Decoded UTF-8 contents — present for text attachments. */
  text?: string;
}

export interface NormalizeOptions {
  /** Per-attachment cap (bytes). Default 5 MB. */
  maxBytes?: number;
  /** Max number of attachments per message. Default 8. */
  maxCount?: number;
}

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_COUNT = 8;

const TEXT_EXT_WHITELIST = new Set([
  'txt', 'md', 'markdown', 'json', 'jsonl', 'yaml', 'yml', 'toml', 'ini',
  'csv', 'tsv', 'log', 'env',
  'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs',
  'py', 'rb', 'go', 'rs', 'java', 'kt', 'cs', 'cpp', 'c', 'h', 'hpp',
  'php', 'swift', 'scala', 'sh', 'bash', 'zsh', 'fish', 'ps1',
  'sql', 'graphql', 'gql', 'proto',
  'html', 'htm', 'css', 'scss', 'sass', 'less',
  'xml', 'svg',
  'dockerfile', 'gitignore', 'editorconfig',
]);

function classifyMime(mimeType: string, fileName: string): AttachmentKind | null {
  const mime = (mimeType || '').toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (
    mime.startsWith('text/') ||
    mime === 'application/json' ||
    mime === 'application/xml' ||
    mime === 'application/javascript' ||
    mime === 'application/typescript' ||
    mime === 'application/x-yaml' ||
    mime === 'application/x-sh' ||
    mime === 'application/csv'
  ) {
    return 'text';
  }
  // Fall back to extension sniffing for octet-stream uploads.
  const ext = (fileName.split('.').pop() ?? '').toLowerCase();
  if (TEXT_EXT_WHITELIST.has(ext)) return 'text';
  return null;
}

/**
 * Validate + normalize a raw attachment from the wire (still base64-only).
 * Throws on size/format violations so the controller can 400.
 */
export function normalizeAttachment(
  raw: { mimeType?: string; fileName?: string; dataBase64?: string },
  opts: NormalizeOptions = {},
): ChatAttachment {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  if (!raw.dataBase64 || typeof raw.dataBase64 !== 'string') {
    throw new Error('Attachment is missing dataBase64');
  }
  // Strip optional `data:...;base64,` prefix if present.
  const b64 = raw.dataBase64.replace(/^data:[^;]+;base64,/, '');
  let buffer: Buffer;
  try {
    buffer = Buffer.from(b64, 'base64');
  } catch {
    throw new Error('Attachment dataBase64 is not valid base64');
  }
  if (buffer.length === 0) throw new Error('Attachment is empty');
  if (buffer.length > maxBytes) {
    throw new Error(`Attachment "${raw.fileName ?? 'file'}" is ${buffer.length} bytes, exceeds max ${maxBytes}`);
  }
  const mimeType = raw.mimeType?.trim() || 'application/octet-stream';
  const fileName = raw.fileName?.trim() || 'attachment';
  const kind = classifyMime(mimeType, fileName);
  if (!kind) {
    throw new Error(`Unsupported attachment type "${mimeType}" (${fileName}). Supported: images and text/code files.`);
  }

  if (kind === 'text') {
    return {
      kind: 'text',
      mimeType,
      fileName,
      size: buffer.length,
      text: buffer.toString('utf-8'),
    };
  }

  return {
    kind: 'image',
    mimeType,
    fileName,
    size: buffer.length,
    dataBase64: b64,
  };
}

export function normalizeAttachments(
  raws: Array<{ mimeType?: string; fileName?: string; dataBase64?: string }>,
  opts: NormalizeOptions = {},
): ChatAttachment[] {
  if (!Array.isArray(raws)) return [];
  const maxCount = opts.maxCount ?? DEFAULT_MAX_COUNT;
  if (raws.length > maxCount) {
    throw new Error(`Too many attachments: ${raws.length} > ${maxCount}`);
  }
  return raws.map((r) => normalizeAttachment(r, opts));
}

// ── Vision-model detection ──────────────────────────────────────────────────

const VISION_MODEL_KEYWORDS = [
  // OpenAI
  'gpt-4o', 'gpt-4.1', 'gpt-5', 'o3', 'o4', '-vision',
  // Anthropic — every Claude 3+ supports vision
  'claude-3', 'claude-4', 'claude-opus-4', 'claude-sonnet-4', 'claude-haiku-4',
  // Google
  'gemini-1.5', 'gemini-2', 'gemini-3', 'gemini-pro-vision',
  // xAI
  'grok-2-vision', 'grok-4',
  // Llama 3.2 multimodal
  'llama-3.2', 'llama-4',
  // Qwen vision
  'qwen-vl', 'qwen-2.5-vl',
];

export function modelSupportsImages(model: string): boolean {
  if (!model) return false;
  const m = model.toLowerCase();
  return VISION_MODEL_KEYWORDS.some((k) => m.includes(k));
}

// ── Provider-format adapters ────────────────────────────────────────────────

/**
 * Build the inline-text representation of a user message that has attachments.
 *
 *   - Text attachments are appended as fenced code blocks (works on all models).
 *   - Image attachments are mentioned by filename so the model knows context,
 *     but the actual image bytes are added separately as multimodal blocks.
 *   - If `dropImages` is true (model has no vision), we add a note saying so.
 */
export function inlineMessageText(
  baseContent: string,
  attachments: ChatAttachment[],
  opts: { dropImages: boolean },
): string {
  if (attachments.length === 0) return baseContent;

  const parts: string[] = [];
  if (baseContent.trim()) parts.push(baseContent);

  for (const att of attachments) {
    if (att.kind === 'text' && att.text !== undefined) {
      const lang = (att.fileName.split('.').pop() ?? '').toLowerCase();
      parts.push(`\n📎 **${att.fileName}** (${att.size} bytes)\n\`\`\`${lang}\n${att.text}\n\`\`\``);
    }
  }

  const imageCount = attachments.filter((a) => a.kind === 'image').length;
  if (imageCount > 0) {
    if (opts.dropImages) {
      parts.push(
        `\n_(${imageCount} image attachment${imageCount === 1 ? '' : 's'} were ignored — the configured model does not support vision. Switch to a vision model in Settings → AI to use images.)_`,
      );
    } else {
      const names = attachments.filter((a) => a.kind === 'image').map((a) => a.fileName).join(', ');
      parts.push(`\n_(attached image${imageCount === 1 ? '' : 's'}: ${names})_`);
    }
  }

  return parts.join('\n').trim();
}

/**
 * Build the OpenAI-compatible content blocks for a user message with images.
 * Returns either a plain string (no images) or an array of `image_url` + `text` parts.
 *
 * `dropImages` causes images to be omitted from the structured payload entirely.
 */
export function buildOpenAIContent(
  textContent: string,
  attachments: ChatAttachment[],
  dropImages: boolean,
): string | Array<Record<string, unknown>> {
  const images = dropImages ? [] : attachments.filter((a) => a.kind === 'image' && a.dataBase64);
  if (images.length === 0) return textContent;

  const blocks: Array<Record<string, unknown>> = [{ type: 'text', text: textContent }];
  for (const img of images) {
    blocks.push({
      type: 'image_url',
      image_url: { url: `data:${img.mimeType};base64,${img.dataBase64}` },
    });
  }
  return blocks;
}

/**
 * Build the Anthropic content blocks for a user message with images.
 * Anthropic uses a different schema: `{type:"image", source:{type:"base64", media_type, data}}`.
 */
export function buildAnthropicContent(
  textContent: string,
  attachments: ChatAttachment[],
  dropImages: boolean,
): string | Array<Record<string, unknown>> {
  const images = dropImages ? [] : attachments.filter((a) => a.kind === 'image' && a.dataBase64);
  if (images.length === 0) return textContent;

  const blocks: Array<Record<string, unknown>> = [];
  for (const img of images) {
    blocks.push({
      type: 'image',
      source: { type: 'base64', media_type: img.mimeType, data: img.dataBase64 },
    });
  }
  blocks.push({ type: 'text', text: textContent });
  return blocks;
}
