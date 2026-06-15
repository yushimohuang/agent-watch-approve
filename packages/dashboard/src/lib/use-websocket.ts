'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { getToken } from '@/lib/api';

interface WSMessage {
  type: string;
  payload?: unknown;
  timestamp?: string;
}

const WS_URL = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:3000';

export function useWebSocket() {
  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<WSMessage | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    const token = getToken();
    if (!token) return;

    const protocol = WS_URL.startsWith('https') ? 'wss:' : 'ws:';
    const wsHost = WS_URL.replace(/^https?:\/\//, '');
    const wsUrl = `${protocol}//${wsHost}/ws?token=${token}`;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          setLastMessage(message);
        } catch {
          // ignore
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        // 5秒后重连
        reconnectTimerRef.current = setTimeout(connect, 5000);
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch {
      // 连接失败，5秒后重试
      reconnectTimerRef.current = setTimeout(connect, 5000);
    }
  }, []);

  useEffect(() => {
    connect();

    // 心跳
    const heartbeat = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000);

    return () => {
      clearInterval(heartbeat);
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const send = useCallback((message: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  return { isConnected, lastMessage, send };
}