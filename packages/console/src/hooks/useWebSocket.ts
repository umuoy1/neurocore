import { useCallback, useEffect, useRef, useState } from "react";

type WsMessage = {
  type: string;
  channel: string;
  payload: unknown;
  message_id: string;
};

type WsHandler = (msg: WsMessage) => void;

export function useWebSocket(url: string) {
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef<Map<string, Set<WsHandler>>>(new Map());
  const subscriptionsRef = useRef<Set<string>>(new Set());
  const [connected, setConnected] = useState(false);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    const apiKey = typeof window === "undefined" ? null : window.localStorage.getItem("nc_api_key");
    if (!apiKey) {
      setConnected(false);
      return;
    }

    const wsUrl = new URL(url, window.location.origin);
    wsUrl.searchParams.set("token", apiKey);
    const ws = new WebSocket(wsUrl.toString());
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      for (const channel of subscriptionsRef.current) {
        ws.send(JSON.stringify({
          type: "subscribe",
          channel,
          message_id: `sub_${Date.now()}_${channel}`,
          timestamp: new Date().toISOString(),
        }));
      }
    };
    ws.onclose = () => {
      setConnected(false);
      setTimeout(connect, 2000);
    };
    ws.onerror = () => ws.close();

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as WsMessage;
        const channelHandlers = handlersRef.current.get(msg.channel);
        if (channelHandlers) {
          for (const handler of channelHandlers) {
            handler(msg);
          }
        }
        if (msg.channel.startsWith("session:")) {
          const globalHandlers = handlersRef.current.get("events");
          if (globalHandlers) {
            for (const handler of globalHandlers) {
              handler(msg);
            }
          }
        }
      } catch {}
    };
  }, [url]);

  useEffect(() => {
    connect();
    return () => {
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [connect]);

  const subscribe = useCallback((channel: string, handler: WsHandler) => {
    if (!handlersRef.current.has(channel)) {
      handlersRef.current.set(channel, new Set());
    }
    handlersRef.current.get(channel)!.add(handler);
    subscriptionsRef.current.add(channel);

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: "subscribe",
        channel,
        message_id: `sub_${Date.now()}`,
        timestamp: new Date().toISOString(),
      }));
    }

    return () => {
      const handlers = handlersRef.current.get(channel);
      handlers?.delete(handler);
      if (!handlers || handlers.size === 0) {
        handlersRef.current.delete(channel);
        subscriptionsRef.current.delete(channel);
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({
            type: "unsubscribe",
            channel,
            message_id: `unsub_${Date.now()}`,
            timestamp: new Date().toISOString(),
          }));
        }
      }
    };
  }, []);

  const sendCommand = useCallback((payload: Record<string, unknown>) => {
    wsRef.current?.send(JSON.stringify({
      type: "command",
      channel: "commands",
      payload,
      message_id: `cmd_${Date.now()}`,
      timestamp: new Date().toISOString(),
    }));
  }, []);

  return { connected, subscribe, sendCommand };
}
