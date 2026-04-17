import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import type { IMAdapter } from "./im-adapter.js";
import type { IMAdapterConfig, IMPlatform, MessageContent, UnifiedMessage } from "../types.js";
import { WEB_CHAT_PAGE_HTML } from "./web-chat-page.js";

interface WebChatConfig {
  host: string;
  port: number;
  path: string;
}

export class WebChatAdapter implements IMAdapter {
  public readonly platform: IMPlatform = "web";

  private httpServer?: Server;
  private server?: WebSocketServer;
  private handler?: (msg: UnifiedMessage) => void;
  private readonly socketsByChatId = new Map<string, WebSocket>();
  private readonly chatIdBySocket = new Map<WebSocket, string>();
  private readonly socketWaitersByChatId = new Map<string, Array<(socket: WebSocket) => void>>();

  public onMessage(handler: (msg: UnifiedMessage) => void): void {
    this.handler = handler;
  }

  public async start(config: IMAdapterConfig): Promise<void> {
    const resolved = this.resolveConfig(config);
    this.httpServer = createServer((request, response) => {
      this.handleHttpRequest(request, response, resolved);
    });

    this.server = new WebSocketServer({
      server: this.httpServer,
      path: resolved.path
    });

    this.server.on("connection", (socket, request) => {
      const requestUrl = new URL(request.url ?? resolved.path, `ws://${request.headers.host ?? "localhost"}`);
      const chatId = requestUrl.searchParams.get("chat_id") ?? randomUUID();
      const senderId = requestUrl.searchParams.get("user_id") ?? chatId;

      this.socketsByChatId.set(chatId, socket);
      this.chatIdBySocket.set(socket, chatId);
      this.resolveSocketWaiters(chatId, socket);

      socket.on("message", (data) => {
        const message = this.toUnifiedMessage(chatId, senderId, data);
        this.handler?.(message);
      });

      socket.on("close", () => {
        if (this.socketsByChatId.get(chatId) === socket) {
          this.socketsByChatId.delete(chatId);
        }
        this.chatIdBySocket.delete(socket);
      });
    });

    await new Promise<void>((resolve, reject) => {
      this.httpServer?.once("error", reject);
      this.httpServer?.listen(resolved.port, resolved.host, () => {
        this.httpServer?.off("error", reject);
        resolve();
      });
    });
  }

  public async stop(): Promise<void> {
    for (const socket of this.socketsByChatId.values()) {
      socket.close();
    }
    this.socketsByChatId.clear();
    this.chatIdBySocket.clear();
    this.socketWaitersByChatId.clear();

    await new Promise<void>((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close(() => resolve());
      this.server = undefined;
    });

    await new Promise<void>((resolve) => {
      if (!this.httpServer) {
        resolve();
        return;
      }
      this.httpServer.close(() => resolve());
      this.httpServer = undefined;
    });
  }

  public async sendMessage(chatId: string, content: MessageContent): Promise<{ message_id: string }> {
    const socket = await this.getLiveSocket(chatId);

    const messageId = randomUUID();
    socket.send(
      JSON.stringify({
        type: "message",
        message_id: messageId,
        content
      })
    );

    return { message_id: messageId };
  }

  public async editMessage(chatId: string, messageId: string, content: MessageContent): Promise<void> {
    const socket = await this.getLiveSocket(chatId);

    socket.send(
      JSON.stringify({
        type: "edit",
        message_id: messageId,
        content
      })
    );
  }

  public async typingIndicator(chatId: string): Promise<void> {
    const socket = this.socketsByChatId.get(chatId);
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    socket.send(
      JSON.stringify({
        type: "typing"
      })
    );
  }

  private resolveConfig(config: IMAdapterConfig): WebChatConfig {
    const host = config.auth.host ?? "127.0.0.1";
    const port = parseInt(config.auth.port ?? "3301", 10);
    const path = config.auth.path ?? "/chat";
    return { host, port, path };
  }

  private handleHttpRequest(
    request: IncomingMessage,
    response: ServerResponse,
    config: WebChatConfig
  ): void {
    const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? `${config.host}:${config.port}`}`);

    if (request.method !== "GET") {
      response.writeHead(405, { "content-type": "text/plain; charset=utf-8" });
      response.end("Method Not Allowed");
      return;
    }

    if (requestUrl.pathname === "/" || requestUrl.pathname === "/index.html") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(WEB_CHAT_PAGE_HTML);
      return;
    }

    if (requestUrl.pathname === "/health") {
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: true, platform: "web", path: config.path }));
      return;
    }

    if (requestUrl.pathname === config.path) {
      response.writeHead(426, {
        "content-type": "text/plain; charset=utf-8",
        "sec-websocket-version": "13"
      });
      response.end(`Upgrade Required. Connect via WebSocket at ${config.path}.`);
      return;
    }

    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not Found");
  }

  private toUnifiedMessage(chatId: string, senderId: string, raw: RawData): UnifiedMessage {
    const timestamp = new Date().toISOString();
    const payload = this.parsePayload(raw);

    if (typeof payload === "string") {
      return {
        message_id: randomUUID(),
        platform: "web",
        chat_id: chatId,
        sender_id: senderId,
        timestamp,
        content: { type: "text", text: payload },
        metadata: {}
      };
    }

    const record = payload as Record<string, unknown>;
    const type = typeof record.type === "string" ? record.type : "text";

    let content: MessageContent;
    switch (type) {
      case "markdown":
        content = { type: "markdown", text: asRequiredString(record.text, "") };
        break;
      case "action":
        content = {
          type: "action",
          action: asRequiredString(record.action, ""),
          params: isRecord(record.params) ? record.params : undefined
        };
        break;
      default:
        content = {
          type: "text",
          text: asRequiredString(record.text ?? record.content, "")
        };
        break;
    }

    return {
      message_id: asRequiredString(record.message_id, randomUUID()),
      platform: "web",
      chat_id: chatId,
      sender_id: asRequiredString(record.sender_id, senderId),
      timestamp,
      content,
      reply_to: asOptionalString(record.reply_to),
      metadata: isRecord(record.metadata) ? record.metadata : {}
    };
  }

  private parsePayload(raw: RawData): string | Record<string, unknown> {
    const text = raw.toString();
    try {
      const parsed = JSON.parse(text) as unknown;
      if (isRecord(parsed)) {
        return parsed;
      }
    } catch {}
    return text;
  }

  private resolveSocketWaiters(chatId: string, socket: WebSocket): void {
    const waiters = this.socketWaitersByChatId.get(chatId);
    if (!waiters || waiters.length === 0) {
      return;
    }
    this.socketWaitersByChatId.delete(chatId);
    for (const resolve of waiters) {
      resolve(socket);
    }
  }

  private async getLiveSocket(chatId: string): Promise<WebSocket> {
    const existing = this.socketsByChatId.get(chatId);
    if (existing && existing.readyState === WebSocket.OPEN) {
      return existing;
    }

    const socket = await new Promise<WebSocket>((resolve, reject) => {
      const timeout = setTimeout(() => {
        const waiters = this.socketWaitersByChatId.get(chatId);
        if (waiters) {
          this.socketWaitersByChatId.set(chatId, waiters.filter((candidate) => candidate !== resolve));
          if (this.socketWaitersByChatId.get(chatId)?.length === 0) {
            this.socketWaitersByChatId.delete(chatId);
          }
        }
        reject(new Error(`Web chat connection for chat_id ${chatId} is not available.`));
      }, 250);

      const wrapped = (candidate: WebSocket) => {
        clearTimeout(timeout);
        resolve(candidate);
      };

      const waiters = this.socketWaitersByChatId.get(chatId) ?? [];
      waiters.push(wrapped);
      this.socketWaitersByChatId.set(chatId, waiters);
    });

    if (socket.readyState !== WebSocket.OPEN) {
      throw new Error(`Web chat connection for chat_id ${chatId} is not available.`);
    }
    return socket;
  }
}

function asRequiredString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
