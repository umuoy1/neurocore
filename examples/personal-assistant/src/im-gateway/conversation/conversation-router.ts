import type { AgentSessionHandle, AgentBuilder } from "@neurocore/sdk-core";
import type { CycleTraceRecord, UserInput, SessionState } from "@neurocore/protocol";
import type {
  ConversationHandoff,
  ConversationHandoffMessage,
  ConversationHandoffTurn,
  ConversationShortReferenceContext,
  SessionRoute,
  UnifiedMessage
} from "../types.js";
import type { SessionMappingStore } from "./session-mapping-store.js";
import type { PlatformUserLinkStore } from "./platform-user-link-store.js";

export interface ConversationRouterOptions {
  builder: AgentBuilder;
  tenantId: string;
  mappingStore: SessionMappingStore;
  userLinkStore?: PlatformUserLinkStore;
  idleTimeoutMs?: number;
}

export interface ResolvedConversation {
  session_id: string;
  handle: AgentSessionHandle;
  is_new: boolean;
  resumed_from_checkpoint: boolean;
  canonical_user_id: string;
  handoff?: ConversationHandoff;
}

export class ConversationRouter {
  private readonly idleTimeoutMs: number;

  public constructor(private readonly options: ConversationRouterOptions) {
    this.idleTimeoutMs = options.idleTimeoutMs ?? 30 * 60 * 1000;
  }

  public resolveOrCreate(message: UnifiedMessage, input: UserInput): ResolvedConversation {
    const canonicalUserId = this.resolveCanonicalUserId(message);
    const route = this.options.mappingStore.getRoute(message.platform, message.chat_id);
    let handoff: ConversationHandoff | undefined;

    if (route) {
      const handle = this.connectExisting(route.session_id);
      const session = handle.getSession();
      if (session && !isTerminalState(session.state) && !isIdle(session.state, session.last_active_at, this.idleTimeoutMs)) {
        this.options.mappingStore.upsertRoute({
          ...route,
          sender_id: message.sender_id,
          canonical_user_id: canonicalUserId,
          updated_at: input.created_at,
          last_active_at: input.created_at
        });

        return {
          session_id: route.session_id,
          handle,
          is_new: false,
          resumed_from_checkpoint: false,
          canonical_user_id: canonicalUserId
        };
      }

      if (session) {
        handoff = buildConversationHandoff(
          handle,
          route.session_id,
          isTerminalState(session.state) ? "terminal" : "idle",
          input.created_at
        );
      }

      if (session && !isTerminalState(session.state)) {
        try {
          handle.checkpoint();
        } catch {}
      }
    }

    const initialInput = handoff ? attachConversationHandoff(input, handoff) : input;

    const handle = this.options.builder.createSession({
      agent_id: this.options.builder.getProfile().agent_id,
      tenant_id: this.options.tenantId,
      user_id: canonicalUserId,
      session_mode: "sync",
      initial_input: initialInput
    });

    const newRoute: SessionRoute = {
      platform: message.platform,
      chat_id: message.chat_id,
      session_id: handle.id,
      sender_id: message.sender_id,
      canonical_user_id: canonicalUserId,
      created_at: input.created_at,
      updated_at: input.created_at,
      last_active_at: input.created_at
    };
    this.options.mappingStore.upsertRoute(newRoute);

    if (this.options.userLinkStore) {
      this.options.userLinkStore.upsertLink({
        platform: message.platform,
        sender_id: message.sender_id,
        canonical_user_id: canonicalUserId,
        created_at: input.created_at,
        updated_at: input.created_at
      });
    }

    return {
      session_id: handle.id,
      handle,
      is_new: true,
      resumed_from_checkpoint: false,
      canonical_user_id: canonicalUserId,
      handoff
    };
  }

  public clearRoute(message: Pick<UnifiedMessage, "platform" | "chat_id">): void {
    this.options.mappingStore.deleteRoute(message.platform, message.chat_id);
  }

  public listRoutesForUser(userId: string): SessionRoute[] {
    return this.options.mappingStore.listRoutesForUser(userId);
  }

  public connect(sessionId: string): AgentSessionHandle {
    return this.connectExisting(sessionId);
  }

  private resolveCanonicalUserId(message: UnifiedMessage): string {
    return (
      this.options.userLinkStore?.resolveCanonicalUserId(message.platform, message.sender_id) ??
      message.sender_id
    );
  }

  private connectExisting(sessionId: string): AgentSessionHandle {
    return this.options.builder.connectSession(sessionId);
  }
}

function isTerminalState(state: SessionState): boolean {
  return state === "completed" || state === "failed" || state === "aborted";
}

function isIdle(state: SessionState, lastActiveAt: string | undefined, idleTimeoutMs: number): boolean {
  if (state === "suspended" || state === "hydrated") {
    return false;
  }
  if (!lastActiveAt) {
    return false;
  }
  return Date.now() - Date.parse(lastActiveAt) > idleTimeoutMs;
}

function attachConversationHandoff(input: UserInput, handoff: ConversationHandoff): UserInput {
  return {
    ...input,
    metadata: {
      ...(input.metadata ?? {}),
      conversation_handoff: handoff,
      previous_conversation_summary: handoff.summary,
      short_reference_context: handoff.short_reference_context
    }
  };
}

function buildConversationHandoff(
  handle: AgentSessionHandle,
  previousSessionId: string,
  reason: ConversationHandoff["reason"],
  createdAt: string
): ConversationHandoff | undefined {
  const messages = flattenTraceMessages(handle.getTraceRecords()).slice(-12);
  if (messages.length === 0) {
    return undefined;
  }
  const recentTurns = buildRecentTurns(messages).slice(-6);
  const lastUserMessage = findLastMessage(messages, "user");
  const lastAssistantMessage = findLastMessage(messages, "assistant");
  const shortReferenceContext = buildShortReferenceContext(messages, lastUserMessage, lastAssistantMessage);

  return {
    previous_session_id: previousSessionId,
    reason,
    summary: summarizeMessages(previousSessionId, messages),
    recent_messages: messages,
    recent_turns: recentTurns,
    last_user_message: lastUserMessage,
    last_assistant_message: lastAssistantMessage,
    short_reference_context: shortReferenceContext,
    created_at: createdAt
  };
}

function flattenTraceMessages(records: CycleTraceRecord[]): ConversationHandoffMessage[] {
  const messages: ConversationHandoffMessage[] = [];

  for (const record of records) {
    for (const input of record.inputs) {
      if (input.content.trim().length === 0) {
        continue;
      }
      messages.push({
        role: "user",
        content: trimContent(input.content, 800),
        created_at: input.created_at,
        cycle_id: record.trace.cycle_id,
        source_id: input.input_id
      });
    }

    if (
      record.selected_action &&
      (record.selected_action.action_type === "respond" || record.selected_action.action_type === "ask_user") &&
      record.observation?.source_type === "runtime" &&
      typeof record.observation.summary === "string" &&
      record.observation.summary.trim().length > 0
    ) {
      messages.push({
        role: "assistant",
        content: trimContent(record.observation.summary, 800),
        created_at: record.observation.created_at,
        cycle_id: record.trace.cycle_id,
        source_id: record.observation.observation_id
      });
    }
  }

  return messages;
}

function summarizeMessages(previousSessionId: string, messages: ConversationHandoffMessage[]): string {
  const body = messages
    .map((message) => `${message.role}: ${message.content.trim().replace(/\s+/g, " ")}`)
    .join(" | ");
  return trimContent(`Previous same-chat session ${previousSessionId}: ${body}`, 1600);
}

function buildRecentTurns(messages: ConversationHandoffMessage[]): ConversationHandoffTurn[] {
  const turns: ConversationHandoffTurn[] = [];
  for (const message of messages) {
    const last = turns.at(-1);
    if (message.role === "user") {
      turns.push({
        cycle_id: message.cycle_id,
        user: message
      });
      continue;
    }

    if (last && !last.assistant) {
      last.assistant = message;
      last.cycle_id = last.cycle_id ?? message.cycle_id;
      continue;
    }

    turns.push({
      cycle_id: message.cycle_id,
      assistant: message
    });
  }
  return turns;
}

function findLastMessage(
  messages: ConversationHandoffMessage[],
  role: ConversationHandoffMessage["role"]
): ConversationHandoffMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === role) {
      return messages[index];
    }
  }
  return undefined;
}

function buildShortReferenceContext(
  messages: ConversationHandoffMessage[],
  lastUserMessage: ConversationHandoffMessage | undefined,
  lastAssistantMessage: ConversationHandoffMessage | undefined
): ConversationShortReferenceContext {
  return {
    instruction: "Resolve short references in the next user message against the latest same-chat user and assistant turns before asking what the user means.",
    last_user_message: lastUserMessage?.content,
    last_assistant_message: lastAssistantMessage?.content,
    recent_entities: extractReferenceCandidates(messages),
    source_message_count: messages.length
  };
}

function extractReferenceCandidates(messages: ConversationHandoffMessage[]): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();

  for (const message of messages.slice().reverse()) {
    const content = message.content;
    for (const match of content.matchAll(/\b(?:ChatGPT|GPT|OpenAI|Claude|Gemini|Qwen|Llama|DeepSeek)(?:[-\s]?[0-9]+(?:\.[0-9]+)?[A-Za-z-]*)?\b/gi)) {
      addCandidate(candidates, seen, match[0]);
    }
    for (const match of content.matchAll(/["“]([^"”]{2,80})["”]/g)) {
      addCandidate(candidates, seen, match[1]);
    }
    for (const match of content.matchAll(/\b[A-Z][A-Za-z0-9]*(?:[ .-][A-Z0-9][A-Za-z0-9]*){0,4}\b/g)) {
      addCandidate(candidates, seen, match[0]);
    }
    if (candidates.length >= 8) {
      break;
    }
  }

  return candidates.slice(0, 8);
}

function addCandidate(candidates: string[], seen: Set<string>, raw: string): void {
  const candidate = raw.trim().replace(/\s+/g, " ").replace(/[.,;:!?]+$/g, "");
  if (candidate.length < 2 || candidate.length > 80) {
    return;
  }
  const key = candidate.toLowerCase();
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  candidates.push(candidate);
}

function trimContent(content: string, maxLength: number): string {
  if (content.length <= maxLength) {
    return content;
  }
  return `${content.slice(0, maxLength - 3)}...`;
}
