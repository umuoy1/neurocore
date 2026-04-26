import type { ContentPart } from "@neurocore/protocol";
import type {
  IMPlatform,
  MessageContent,
  PersonalMediaAttachment,
  PersonalMediaKind,
  PersonalMediaSensitivity,
  UnifiedMessage
} from "../types.js";

export interface PersonalMediaAttachmentInput {
  kind?: PersonalMediaKind;
  type?: PersonalMediaKind;
  url?: string;
  filename?: string;
  mime_type?: string;
  size_bytes?: number;
  caption?: string;
  alt_text?: string;
  transcript?: string;
  text_excerpt?: string;
  duration_ms?: number;
  sensitivity?: PersonalMediaSensitivity;
  metadata?: Record<string, unknown>;
}

export interface MediaNormalizationContext {
  platform: IMPlatform;
  chat_id: string;
  message_id: string;
  sender_id?: string;
  received_at: string;
}

export interface PersonalMediaExtraction {
  attachment_id: string;
  kind: PersonalMediaKind;
  summary: string;
  text?: string;
  content_parts: ContentPart[];
  sensitivity: PersonalMediaSensitivity;
  provenance: PersonalMediaAttachment["provenance"];
  metadata: Record<string, unknown>;
}

export function normalizeMediaAttachments(
  content: MessageContent,
  attachments: PersonalMediaAttachmentInput[] | PersonalMediaAttachment[] | undefined,
  context: MediaNormalizationContext
): PersonalMediaAttachment[] {
  return [
    ...contentToAttachmentInputs(content),
    ...(attachments ?? [])
  ].map((attachment, index) => normalizeAttachment(attachment, context, index));
}

export function extractMediaForRuntime(message: UnifiedMessage): PersonalMediaExtraction[] {
  return (message.attachments ?? []).map((attachment) => {
    const summary = summarizeAttachment(attachment);
    const text = attachment.transcript ?? attachment.text_excerpt ?? attachment.caption ?? attachment.alt_text;
    return {
      attachment_id: attachment.attachment_id,
      kind: attachment.kind,
      summary,
      text,
      content_parts: toContentParts(attachment, summary),
      sensitivity: attachment.sensitivity,
      provenance: attachment.provenance,
      metadata: attachment.metadata
    };
  });
}

export function formatMediaPrompt(extractions: PersonalMediaExtraction[]): string | undefined {
  if (extractions.length === 0) {
    return undefined;
  }
  return [
    "Attached media:",
    ...extractions.map((item, index) => {
      const lines = [
        `${index + 1}. ${item.summary}`,
        `   sensitivity=${item.sensitivity}`,
        `   provenance=${item.provenance.platform}:${item.provenance.chat_id}:${item.provenance.message_id}:${item.attachment_id}`
      ];
      if (item.text) {
        lines.push(`   extracted_text=${item.text}`);
      }
      return lines.join("\n");
    })
  ].join("\n");
}

export function formatMediaDeliveryText(content: Extract<MessageContent, { type: "image" | "file" | "audio" | "voice" }>): string {
  switch (content.type) {
    case "image":
      return content.caption ? `${content.caption}\n${content.url}` : content.url;
    case "file":
      return [content.filename, content.url, content.text_excerpt].filter(Boolean).join("\n");
    case "audio":
      return [
        content.filename ?? "Audio",
        content.url,
        content.transcript ? `Transcript: ${content.transcript}` : undefined
      ].filter(Boolean).join("\n");
    case "voice":
      return [
        "Voice message",
        content.url,
        content.transcript ? `Transcript: ${content.transcript}` : undefined
      ].filter(Boolean).join("\n");
  }
}

function normalizeAttachment(
  input: PersonalMediaAttachmentInput | PersonalMediaAttachment,
  context: MediaNormalizationContext,
  index: number
): PersonalMediaAttachment {
  const kind = input.kind ?? input.type;
  if (!kind) {
    throw new Error("Media attachment kind is required.");
  }
  const attachmentId = "attachment_id" in input && input.attachment_id
    ? input.attachment_id
    : `att_${context.message_id}_${index + 1}`;
  const mimeType = input.mime_type ?? inferMimeType(kind, input.filename, input.url);
  const sensitivity = input.sensitivity ?? inferSensitivity(kind, mimeType);
  return {
    attachment_id: attachmentId,
    kind,
    url: input.url,
    filename: input.filename,
    mime_type: mimeType,
    size_bytes: input.size_bytes,
    caption: input.caption,
    alt_text: input.alt_text,
    transcript: input.transcript,
    text_excerpt: input.text_excerpt,
    duration_ms: input.duration_ms,
    sensitivity,
    provenance: "provenance" in input
      ? input.provenance
      : {
          platform: context.platform,
          chat_id: context.chat_id,
          message_id: context.message_id,
          sender_id: context.sender_id,
          attachment_id: attachmentId,
          received_at: context.received_at,
          source_url: input.url,
          filename: input.filename,
          mime_type: mimeType
        },
    metadata: isRecord(input.metadata) ? input.metadata : {}
  };
}

function contentToAttachmentInputs(content: MessageContent): PersonalMediaAttachmentInput[] {
  switch (content.type) {
    case "image":
      return [{
        kind: "image",
        url: content.url,
        caption: content.caption,
        mime_type: inferMimeType("image", undefined, content.url)
      }];
    case "file":
      return [{
        kind: "file",
        url: content.url,
        filename: content.filename,
        mime_type: content.mime_type,
        text_excerpt: content.text_excerpt
      }];
    case "audio":
      return [{
        kind: "audio",
        url: content.url,
        filename: content.filename,
        mime_type: content.mime_type,
        transcript: content.transcript,
        duration_ms: content.duration_ms
      }];
    case "voice":
      return [{
        kind: "voice",
        url: content.url,
        mime_type: content.mime_type,
        transcript: content.transcript,
        duration_ms: content.duration_ms
      }];
    default:
      return [];
  }
}

function summarizeAttachment(attachment: PersonalMediaAttachment): string {
  const label = attachment.filename ?? attachment.caption ?? attachment.url ?? attachment.attachment_id;
  const mime = attachment.mime_type ? ` mime=${attachment.mime_type}` : "";
  const size = typeof attachment.size_bytes === "number" ? ` size=${attachment.size_bytes}` : "";
  const duration = typeof attachment.duration_ms === "number" ? ` duration_ms=${attachment.duration_ms}` : "";
  return `${attachment.kind} attachment ${label}${mime}${size}${duration}`;
}

function toContentParts(attachment: PersonalMediaAttachment, summary: string): ContentPart[] {
  const parts: ContentPart[] = [];
  const text = attachment.transcript ?? attachment.text_excerpt ?? attachment.caption ?? attachment.alt_text;
  if (text) {
    parts.push({
      type: "text",
      text
    });
  }
  if (attachment.kind === "image") {
    parts.push({
      type: "image",
      mime_type: attachment.mime_type ?? "image/*",
      url: attachment.url,
      file_name: attachment.filename,
      alt_text: attachment.alt_text ?? attachment.caption ?? summary
    });
    return parts;
  }
  parts.push({
    type: "file",
    mime_type: attachment.mime_type ?? defaultMimeType(attachment.kind),
    file_name: attachment.filename ?? `${attachment.kind}-${attachment.attachment_id}`,
    url: attachment.url,
    text_excerpt: text ?? summary
  });
  return parts;
}

function inferMimeType(kind: PersonalMediaKind, filename: string | undefined, url: string | undefined): string {
  const source = `${filename ?? ""} ${url ?? ""}`.toLowerCase();
  if (source.endsWith(".png")) {
    return "image/png";
  }
  if (source.endsWith(".jpg") || source.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (source.endsWith(".pdf")) {
    return "application/pdf";
  }
  if (source.endsWith(".mp3")) {
    return "audio/mpeg";
  }
  if (source.endsWith(".wav")) {
    return "audio/wav";
  }
  if (source.endsWith(".ogg") || kind === "voice") {
    return "audio/ogg";
  }
  return defaultMimeType(kind);
}

function defaultMimeType(kind: PersonalMediaKind): string {
  switch (kind) {
    case "image":
      return "image/*";
    case "audio":
    case "voice":
      return "audio/*";
    case "file":
      return "application/octet-stream";
  }
}

function inferSensitivity(kind: PersonalMediaKind, mimeType: string): PersonalMediaSensitivity {
  if (kind === "voice" || kind === "audio") {
    return "private";
  }
  if (mimeType === "application/pdf") {
    return "private";
  }
  return "unknown";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
