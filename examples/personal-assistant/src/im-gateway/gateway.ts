import type { AgentBuilder, AgentSessionHandle } from "@neurocore/sdk-core";
import type { ApprovalRequest, NeuroCoreEvent, RuntimeOutput, RuntimeStatus } from "@neurocore/protocol";
import { createUserInput } from "./input/input-factory.js";
import { normalizePersonalIngressMessage } from "./ingress.js";
import type { ApprovalBindingStore } from "./approval/approval-binding-store.js";
import type { IMAdapter } from "./adapter/im-adapter.js";
import type { CommandHandler } from "./command/command-handler.js";
import type { PairingManager } from "./conversation/pairing.js";
import type { ConversationRouting } from "./conversation/conversation-router.js";
import { extractMediaForRuntime, formatMediaPrompt, type PersonalMediaExtraction } from "./media/media-attachments.js";
import type { NotificationDispatcher } from "./notification/notification-dispatcher.js";
import type { PersonalMemoryRecord, PersonalMemoryStore } from "../memory/personal-memory-store.js";
import type { AddSessionSearchEntryInput, SessionSearchStore } from "../memory/session-search-store.js";
import type { IMAdapterConfig, IMPlatform, MessageContent, PushNotificationOptions, UnifiedMessage } from "./types.js";

interface RegisteredAdapter {
  adapter: IMAdapter;
  config: IMAdapterConfig;
}

interface ProgressStreamHandle {
  dispose(): void;
  hasOutput: boolean;
  chain: Promise<void>;
}

interface OutputForwardState {
  messageId?: string;
  lastText?: string;
}

export interface IMGatewayOptions {
  builder: AgentBuilder;
  router: ConversationRouting;
  dispatcher: NotificationDispatcher;
  approvalBindingStore: ApprovalBindingStore;
  commandHandler?: CommandHandler;
  pairingManager?: PairingManager;
  memoryStore?: PersonalMemoryStore;
  sessionSearchStore?: SessionSearchStore;
  resolveUserId?: (message: UnifiedMessage) => string;
}

export class IMGateway {
  private readonly adapters = new Map<IMPlatform, RegisteredAdapter>();

  public constructor(private readonly options: IMGatewayOptions) {}

  public registerAdapter(adapter: IMAdapter, config: IMAdapterConfig): void {
    this.adapters.set(adapter.platform, { adapter, config });
  }

  public async start(): Promise<void> {
    for (const { adapter, config } of this.adapters.values()) {
      adapter.onMessage((msg) => this.handleMessage(msg));
      await adapter.start(config);
    }
  }

  public async stop(): Promise<void> {
    for (const { adapter } of this.adapters.values()) {
      await adapter.stop();
    }
  }

  public async pushNotification(
    userId: string,
    content: MessageContent,
    options?: PushNotificationOptions
  ): Promise<void> {
    await this.options.dispatcher.pushToUser(userId, content, options);
  }

  public async pushApprovalRequest(
    userId: string,
    sessionId: string,
    approval: ApprovalRequest,
    options?: PushNotificationOptions
  ): Promise<void> {
    const sent = await this.options.dispatcher.pushToUser(
      userId,
      buildApprovalMessage(approval),
      options
    );
    this.options.approvalBindingStore.upsertBinding({
      platform: sent.platform,
      platform_message_id: sent.message_id,
      session_id: sessionId,
      approval_id: approval.approval_id,
      chat_id: sent.chat_id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
  }

  public getAdapter(platform: IMPlatform): IMAdapter | undefined {
    return this.adapters.get(platform)?.adapter;
  }

  private async handleMessage(rawMessage: UnifiedMessage): Promise<void> {
    const message = normalizePersonalIngressMessage(rawMessage);

    if (this.options.pairingManager?.shouldBlock(message)) {
      if (
        this.options.commandHandler &&
        this.options.pairingManager.isPairCommand(message) &&
        await this.options.commandHandler.tryHandle(message)
      ) {
        return;
      }
      await this.options.pairingManager.sendPairingPrompt(this.options.dispatcher, message);
      return;
    }

    if (await this.handleActionMessage(message)) {
      return;
    }

    if (this.options.commandHandler && await this.options.commandHandler.tryHandle(message)) {
      return;
    }

    const mediaExtractions = extractMediaForRuntime(message);
    const prompt = messageToPrompt(message, mediaExtractions);
    if (!prompt) {
      await this.options.dispatcher.sendToChat(message.platform, message.chat_id, {
        type: "text",
        text: "Only text, markdown, image, file, audio and voice inputs are supported in the current example."
      });
      return;
    }

    const userId = this.resolveUserId(message);
    const personalMemories = this.options.memoryStore?.listActive(userId, 12) ?? [];
    const channel = {
      platform: message.platform,
      kind: message.channel?.kind,
      chat_id: message.chat_id,
      route_key: message.channel?.route_key,
      capabilities: message.channel?.capabilities,
      thread_id: message.channel?.thread_id,
      metadata: message.channel?.metadata ?? {}
    };
    const identity = {
      sender_id: message.sender_id,
      canonical_user_id: userId,
      display_name: message.identity?.display_name,
      trust_level: message.identity?.trust_level ?? "unknown",
      metadata: message.identity?.metadata ?? {}
    };
    const mediaContentParts = mediaExtractions.flatMap((item) => item.content_parts);
    const input = createUserInput(prompt, {
      platform: message.platform,
      chat_id: message.chat_id,
      sender_id: message.sender_id,
      message_id: message.message_id,
      reply_to: message.reply_to,
      canonical_user_id: userId,
      channel_kind: message.channel?.kind,
      channel_capabilities: message.channel?.capabilities,
      channel,
      identity,
      source_metadata: message.metadata,
      media_attachments: (message.attachments ?? []).map((attachment) => ({
        attachment_id: attachment.attachment_id,
        kind: attachment.kind,
        filename: attachment.filename,
        mime_type: attachment.mime_type,
        size_bytes: attachment.size_bytes,
        sensitivity: attachment.sensitivity,
        provenance: attachment.provenance
      })),
      media_extractions: mediaExtractions.map((item) => ({
        attachment_id: item.attachment_id,
        kind: item.kind,
        summary: item.summary,
        text: item.text,
        sensitivity: item.sensitivity,
        provenance: item.provenance
      })),
      personal_memory: personalMemories.length > 0
        ? {
            user_id: userId,
            memories: personalMemories.map(toMemoryMetadata)
          }
        : undefined
    }, mediaContentParts);

    const resolved = this.options.router.resolveOrCreate(message, input);
    const tenantId = resolved.handle.getSession()?.tenant_id ?? "default";
    this.recordSessionSearchEntry({
      tenant_id: tenantId,
      user_id: userId,
      session_id: resolved.session_id,
      role: "user",
      content: prompt,
      created_at: message.timestamp,
      source_platform: message.platform,
      source_chat_id: message.chat_id,
      source_message_id: message.message_id,
      metadata: {
        reply_to: message.reply_to,
        sender_id: message.sender_id,
        channel_kind: message.channel?.kind,
        source_metadata: message.metadata
      }
    });
    const progress = shouldForwardProgress(message.platform)
      ? this.attachProgressStream(message, resolved.session_id, resolved.handle)
      : undefined;

    try {
      if (shouldForwardProgress(message.platform)) {
        await this.options.dispatcher.sendToChat(message.platform, message.chat_id, {
          type: "status",
          text: resolved.is_new
            ? resolved.handoff
              ? "Started a new assistant session with previous chat context."
              : "Started a new assistant session."
            : "Reusing the existing assistant session.",
          phase: "session",
          state: "started",
          session_id: resolved.session_id
        });
      }

      await this.getAdapter(message.platform)?.typingIndicator?.(message.chat_id);
    } catch {}

    try {
      const result = resolved.is_new
        ? await resolved.handle.run()
        : await resolved.handle.runText(prompt, resolved.runtime_input?.metadata ?? input.metadata);
      await progress?.chain;

      const lastStep = result.steps.at(-1);
      if (lastStep?.approval) {
        const sent = await this.options.dispatcher.sendToChat(
          message.platform,
          message.chat_id,
          buildApprovalMessage(lastStep.approval)
        );

        this.options.approvalBindingStore.upsertBinding({
          platform: message.platform,
          platform_message_id: sent.message_id,
          session_id: resolved.session_id,
          approval_id: lastStep.approval.approval_id,
          chat_id: message.chat_id,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
        return;
      }

      const output = result.outputText ?? "The assistant completed without emitting a textual response.";
      if (!shouldStreamAssistantOutput(message.platform) || !progress?.hasOutput) {
        const sent = await this.options.dispatcher.sendToChat(message.platform, message.chat_id, {
          type: "text",
          text: output
        });
        this.recordSessionSearchEntry({
          tenant_id: tenantId,
          user_id: userId,
          session_id: resolved.session_id,
          cycle_id: result.steps.at(-1)?.cycleId,
          trace_id: result.steps.at(-1)?.trace.trace_id,
          role: "assistant",
          content: output,
          source_platform: message.platform,
          source_chat_id: message.chat_id,
          source_message_id: sent.message_id,
          metadata: {
            reply_to_user_message_id: message.message_id
          }
        });
      } else {
        this.recordSessionSearchEntry({
          tenant_id: tenantId,
          user_id: userId,
          session_id: resolved.session_id,
          cycle_id: result.steps.at(-1)?.cycleId,
          trace_id: result.steps.at(-1)?.trace.trace_id,
          role: "assistant",
          content: output,
          source_platform: message.platform,
          source_chat_id: message.chat_id,
          metadata: {
            reply_to_user_message_id: message.message_id
          }
        });
      }
    } finally {
      await progress?.chain;
      progress?.dispose();
    }
  }

  private async handleActionMessage(message: UnifiedMessage): Promise<boolean> {
    if (message.content.type !== "action") {
      return false;
    }

    const decision = normalizeDecision(message.content.action);
    if (!decision) {
      return false;
    }

    const approvalId = asString(message.content.params?.approval_id);
    const binding = approvalId
      ? this.options.approvalBindingStore.getBindingByApprovalId(approvalId)
      : message.reply_to
        ? this.options.approvalBindingStore.getBinding(message.platform, message.reply_to)
        : undefined;

    if (!binding) {
      await this.options.dispatcher.sendToChat(message.platform, message.chat_id, {
        type: "text",
        text: "Approval binding was not found for this action."
      });
      return true;
    }

    try {
      const handle = this.options.router.connect(binding.session_id);
      const result = decision === "approved"
        ? await handle.approve({
            approval_id: binding.approval_id,
            approver_id: message.sender_id
          })
        : await handle.reject({
            approval_id: binding.approval_id,
            approver_id: message.sender_id
          });

      this.options.approvalBindingStore.deleteByApprovalId(binding.approval_id);
      const text = result.run?.outputText
        ?? (decision === "approved" ? "Approval granted." : "Approval rejected.");

      await this.options.dispatcher.sendToChat(message.platform, message.chat_id, {
        type: "text",
        text
      });
    } catch (error) {
      await this.options.dispatcher.sendToChat(message.platform, message.chat_id, {
        type: "text",
        text: error instanceof Error ? error.message : String(error)
      });
    }
    return true;
  }

  private resolveUserId(message: UnifiedMessage): string {
    return this.options.resolveUserId?.(message) ?? message.sender_id;
  }

  private recordSessionSearchEntry(input: AddSessionSearchEntryInput): void {
    try {
      this.options.sessionSearchStore?.addEntry(input);
    } catch {}
  }

  private attachProgressStream(
    message: UnifiedMessage,
    sessionId: string,
    handle: AgentSessionHandle
  ): ProgressStreamHandle {
    const outputState: OutputForwardState = {};
    const progress: ProgressStreamHandle = {
      hasOutput: false,
      chain: Promise.resolve(),
      dispose() {
        unsubscribe();
      }
    };

    const unsubscribe = handle.subscribeToEvents((event) => {
      progress.chain = progress.chain
        .then(() => this.forwardRuntimeEvent(message, sessionId, event, progress, outputState))
        .catch(() => {});
    });

    return progress;
  }

  private async forwardRuntimeEvent(
    message: UnifiedMessage,
    sessionId: string,
    event: NeuroCoreEvent,
    progress: ProgressStreamHandle,
    outputState: OutputForwardState
  ): Promise<void> {
    if (!shouldForwardProgress(message.platform)) {
      return;
    }

    if (event.event_type === "runtime.output") {
      const payload = event.payload as RuntimeOutput;
      progress.hasOutput = true;
      if (payload.text === outputState.lastText) {
        return;
      }
      if (!outputState.messageId) {
        try {
          const sent = await this.options.dispatcher.sendToChat(message.platform, message.chat_id, {
            type: "text",
            text: payload.text
          });
          outputState.messageId = sent.message_id;
          outputState.lastText = payload.text;
        } catch {}
        return;
      }

      try {
        await this.options.dispatcher.editChat(message.platform, message.chat_id, outputState.messageId, {
          type: "text",
          text: payload.text
        });
        outputState.lastText = payload.text;
      } catch {}
      return;
    }

    if (event.event_type === "runtime.status") {
      const payload = event.payload as RuntimeStatus;
      try {
        await this.options.dispatcher.sendToChat(message.platform, message.chat_id, {
          type: "status",
          text: payload.summary,
          phase: payload.phase,
          state: payload.state,
          detail: payload.detail,
          session_id: sessionId,
          cycle_id: payload.cycle_id,
          data: payload.data
        });
      } catch {}
      return;
    }

    if (event.event_type === "session.state_changed") {
      const payload = event.payload as { state?: string };
      try {
        await this.options.dispatcher.sendToChat(message.platform, message.chat_id, {
          type: "status",
          text: `Session state: ${payload.state ?? "unknown"}`,
          phase: "session",
          state: payload.state === "failed" ? "failed" : payload.state === "completed" ? "completed" : "in_progress",
          session_id: sessionId,
          cycle_id: event.cycle_id
        });
      } catch {}
    }
  }
}

function toMemoryMetadata(memory: PersonalMemoryRecord): Record<string, unknown> {
  return {
    memory_id: memory.memory_id,
    content: memory.content,
    updated_at: memory.updated_at,
    correction_of: memory.correction_of
  };
}

function shouldForwardProgress(platform: IMPlatform): boolean {
  return platform === "web" || platform === "feishu" || platform === "cli";
}

function shouldStreamAssistantOutput(platform: IMPlatform): boolean {
  return platform === "web" || platform === "feishu" || platform === "cli";
}

function messageToPrompt(message: UnifiedMessage, mediaExtractions: PersonalMediaExtraction[] = []): string | undefined {
  const mediaPrompt = formatMediaPrompt(mediaExtractions);
  if (message.content.type === "text" || message.content.type === "markdown") {
    return [message.content.text, mediaPrompt].filter(Boolean).join("\n\n");
  }
  if (message.content.type === "image") {
    return [message.content.caption, mediaPrompt].filter(Boolean).join("\n\n") || mediaPrompt;
  }
  if (message.content.type === "file") {
    return [message.content.text_excerpt, mediaPrompt].filter(Boolean).join("\n\n") || mediaPrompt;
  }
  if (message.content.type === "audio" || message.content.type === "voice") {
    return [message.content.transcript, mediaPrompt].filter(Boolean).join("\n\n") || mediaPrompt;
  }
  return mediaPrompt;
}

function buildApprovalMessage(approval: ApprovalRequest): MessageContent {
  return {
    type: "approval_request",
    text: approval.review_reason ?? approval.action.description ?? approval.action.title,
    approval_id: approval.approval_id,
    approve_label: "Approve",
    reject_label: "Reject"
  };
}

function normalizeDecision(action: string): "approved" | "rejected" | undefined {
  if (action === "approve" || action === "approved") {
    return "approved";
  }
  if (action === "reject" || action === "rejected") {
    return "rejected";
  }
  return undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
