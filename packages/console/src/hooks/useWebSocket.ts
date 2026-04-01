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
  const [connected, setConnected] = useState(false);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
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

    wsRef.current?.send(JSON.stringify({
      type: "subscribe",
      channel,
      message_id: `sub_${Date.now()}`,
      timestamp: new Date().toISOString(),
    }));

    return () => {
      handlersRef.current.get(channel)?.delete(handler);
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
