import type { IncomingMessage, Server as HttpServer } from "node:http";
import type { NeuroCoreEvent } from "@neurocore/protocol";
import { WebSocketServer, type WebSocket } from "ws";
import { randomUUID } from "node:crypto";

interface WsMessage {
  type: "subscribe" | "unsubscribe" | "event" | "ack" | "error" | "ping" | "pong" | "command";
  channel: string;
  payload: unknown;
  message_id: string;
  timestamp: string;
}

interface ClientConnection {
  ws: WebSocket;
  tenantId: string;
  subscriptions: Set<string>;
  lastPong: number;
  missCount: number;
}

interface AuthResult {
  tenantId: string;
  userId?: string;
}

export interface WsServerOptions {
  server: HttpServer;
  authenticate: (request: IncomingMessage) => Promise<AuthResult | null>;
  onEvent: (event: NeuroCoreEvent) => void;
  subscribeToSession: (sessionId: string, callback: (event: NeuroCoreEvent) => void) => (() => void) | null;
  getAllEvents: (sessionId: string) => NeuroCoreEvent[];
  onCommand?: (command: WsMessage) => Promise<unknown>;
}

export class WsServer {
  private readonly clients = new Map<WebSocket, ClientConnection>();
  private readonly sessionUnsubscribes = new Map<string, () => void>();
  private readonly options: WsServerOptions;
  private pingInterval: ReturnType<typeof setInterval> | null = null;

  public constructor(options: WsServerOptions) {
    this.options = options;
    this.attachUpgrade();
  }

  public start(): void {
    this.pingInterval = setInterval(() => this.sendPings(), 30_000);
  }

  public stop(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    for (const [ws, client] of this.clients) {
      ws.close(1001, "server shutdown");
    }
    this.clients.clear();
  }

  public broadcast(channel: string, payload: unknown): void {
    const msg: WsMessage = {
      type: "event",
      channel,
      payload,
      message_id: randomUUID(),
      timestamp: new Date().toISOString(),
    };
    const raw = JSON.stringify(msg);
    for (const [, client] of this.clients) {
      if (client.subscriptions.has(channel) || this.isGlobalChannel(channel, client)) {
        client.ws.send(raw);
      }
    }
  }

  public getClientCount(): number {
    return this.clients.size;
  }

  private attachUpgrade(): void {
    this.options.server.on("upgrade", async (request: IncomingMessage, socket: import("node:stream").Duplex, head: Buffer) => {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
      if (url.pathname !== "/v1/ws") return;

      const token = url.searchParams.get("token") ?? request.headers["sec-websocket-protocol"] as string | undefined;
      if (!token) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      const authResult = await this.options.authenticate(request).catch(() => null);
      if (!authResult) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      const wss = new WebSocketServer({ noServer: true });
      wss.handleUpgrade(request, socket, head, (ws) => {
        this.handleConnection(ws, authResult);
        wss.close();
      });
    });
  }

  private handleConnection(ws: WebSocket, auth: AuthResult): void {
    const client: ClientConnection = {
      ws,
      tenantId: auth.tenantId,
      subscriptions: new Set(),
      lastPong: Date.now(),
      missCount: 0,
    };
    this.clients.set(ws, client);

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString()) as WsMessage;
        this.handleMessage(client, msg);
      } catch {
        this.sendError(client, "VALIDATION_ERROR", "Invalid message format");
      }
    });

    ws.on("close", () => {
      this.cleanup(client);
    });

    ws.on("pong", () => {
      client.lastPong = Date.now();
      client.missCount = 0;
    });
  }

  private handleMessage(client: ClientConnection, msg: WsMessage): void {
    switch (msg.type) {
      case "subscribe":
        this.handleSubscribe(client, msg);
        break;
      case "unsubscribe":
        this.handleUnsubscribe(client, msg);
        break;
      case "pong":
        client.lastPong = Date.now();
        client.missCount = 0;
        break;
      case "command":
        this.handleCommand(client, msg);
        break;
      default:
        this.sendError(client, "VALIDATION_ERROR", `Unknown message type: ${msg.type}`);
    }
  }

  private handleSubscribe(client: ClientConnection, msg: WsMessage): void {
    const channel = msg.channel;

    if (channel.startsWith("session:")) {
      const sessionId = channel.slice("session:".length);
      const unsub = this.options.subscribeToSession(sessionId, (event) => {
        this.sendToClient(client, channel, event);
      });
      if (unsub) {
        this.sessionUnsubscribes.set(`${client.tenantId}:${channel}`, unsub);
      }

      const historical = this.options.getAllEvents(sessionId);
      for (const event of historical) {
        this.sendToClient(client, channel, event);
      }
    }

    client.subscriptions.add(channel);
    this.sendAck(client, channel, msg.message_id);
  }

  private handleUnsubscribe(client: ClientConnection, msg: WsMessage): void {
    client.subscriptions.delete(msg.channel);

    if (msg.channel.startsWith("session:")) {
      const key = `${client.tenantId}:${msg.channel}`;
      const unsub = this.sessionUnsubscribes.get(key);
      if (unsub) {
        unsub();
        this.sessionUnsubscribes.delete(key);
      }
    }

    this.sendAck(client, msg.channel, msg.message_id);
  }

  private async handleCommand(client: ClientConnection, msg: WsMessage): Promise<void> {
    if (this.options.onCommand) {
      try {
        const result = await this.options.onCommand(msg);
        this.sendToClient(client, "commands", { action: (msg.payload as Record<string, unknown>).action, result });
      } catch (err) {
        this.sendError(client, "COMMAND_ERROR", err instanceof Error ? err.message : "Command failed");
      }
    }
  }

  private sendPings(): void {
    const now = Date.now();
    for (const [ws, client] of this.clients) {
      if (now - client.lastPong > 40_000) {
        client.missCount++;
        if (client.missCount >= 3) {
          ws.close(1000, "heartbeat timeout");
          continue;
        }
      }
      ws.ping();
    }
  }

  private sendToClient(client: ClientConnection, channel: string, payload: unknown): void {
    if (client.ws.readyState !== 1) return;
    const msg: WsMessage = {
      type: "event",
      channel,
      payload,
      message_id: randomUUID(),
      timestamp: new Date().toISOString(),
    };
    client.ws.send(JSON.stringify(msg));
  }

  private sendAck(client: ClientConnection, channel: string, replyTo: string): void {
    const msg: WsMessage = {
      type: "ack",
      channel,
      payload: { subscribed: true },
      message_id: replyTo,
      timestamp: new Date().toISOString(),
    };
    client.ws.send(JSON.stringify(msg));
  }

  private sendError(client: ClientConnection, code: string, message: string): void {
    const msg: WsMessage = {
      type: "error",
      channel: "",
      payload: { code, message },
      message_id: randomUUID(),
      timestamp: new Date().toISOString(),
    };
    client.ws.send(JSON.stringify(msg));
  }

  private cleanup(client: ClientConnection): void {
    this.clients.delete(client.ws);
    for (const key of this.sessionUnsubscribes.keys()) {
      if (key.startsWith(`${client.tenantId}:session:`)) {
        const unsub = this.sessionUnsubscribes.get(key);
        unsub?.();
        this.sessionUnsubscribes.delete(key);
      }
    }
  }

  private isGlobalChannel(channel: string, client: ClientConnection): boolean {
    return (
      client.subscriptions.has("events") &&
      (channel.startsWith("session:") || channel === "metrics" || channel === "approvals" || channel === "agents" || channel === "delegations" || channel === "devices" || channel === "evals")
    );
  }
}
