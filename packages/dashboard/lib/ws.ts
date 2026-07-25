/**
 * WebSocket 客户端（模块级单例 + React Hook）
 *
 * - 同源连接：ws(s)://<origin>/ws?token=<accessToken>
 * - 30s 心跳 ping
 * - 指数退避重连：1s, 2s, 4s, 8s, ..., max 30s
 * - 暴露 useWebSocket() hook，返回 { connected, subscribe }
 */

'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { getToken } from './api';
import type {
  WsServerMessage,
  WsApprovalRequestPayload,
  WsApprovalResponsePayload,
  Activity,
} from './types';

type Listener = (msg: WsServerMessage) => void;

const PING_INTERVAL_MS = 30_000;
const MAX_BACKOFF_MS = 30_000;

class WsClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private backoff = 1000;
  private manualClose = false;
  private connected = false;
  private connectedListeners = new Set<(c: boolean) => void>();
  private hasToken = false;

  isConnected(): boolean {
    return this.connected;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  subscribeConnected(fn: (c: boolean) => void): () => void {
    this.connectedListeners.add(fn);
    fn(this.connected);
    return () => {
      this.connectedListeners.delete(fn);
    };
  }

  private setConnected(c: boolean): void {
    if (this.connected === c) return;
    this.connected = c;
    this.connectedListeners.forEach((fn) => fn(c));
  }

  private emit(msg: WsServerMessage): void {
    this.listeners.forEach((fn) => {
      try {
        fn(msg);
      } catch {
        /* swallow */
      }
    });
  }

  /** 打开 / 重建连接（拿到最新 token） */
  connect(): void {
    if (typeof window === 'undefined') return;
    const token = getToken();
    if (!token) {
      this.hasToken = false;
      return;
    }
    this.hasToken = true;
    this.manualClose = false;
    this.openSocket(token);
  }

  private openSocket(token: string): void {
    // 关闭旧连接
    if (this.ws) {
      try {
        this.ws.onclose = null;
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
    this.clearTimers();

    const origin = window.location.origin;
    const wsBase = origin.replace(/^http/, 'ws');
    const url = `${wsBase}/ws?token=${encodeURIComponent(token)}`;

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.backoff = 1000;
      this.setConnected(true);
      this.startPing();
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as WsServerMessage;
        this.emit(msg);
      } catch {
        /* ignore non-json */
      }
    };

    ws.onerror = () => {
      // 错误后一般会跟一个 close
    };

    ws.onclose = () => {
      this.setConnected(false);
      this.clearTimers();
      if (!this.manualClose && this.hasToken) {
        this.scheduleReconnect();
      }
    };
  }

  private startPing(): void {
    this.clearTimers();
    this.pingTimer = setInterval(() => {
      this.send({ type: 'ping' });
    }, PING_INTERVAL_MS);
  }

  private clearTimers(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private scheduleReconnect(): void {
    this.clearTimers();
    const delay = Math.min(this.backoff, MAX_BACKOFF_MS);
    this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
    this.reconnectTimer = setTimeout(() => {
      const token = getToken();
      if (!token) {
        this.hasToken = false;
        return;
      }
      this.openSocket(token);
    }, delay);
  }

  send(msg: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(msg));
      } catch {
        /* ignore */
      }
    }
  }

  /** 主动断开（退出登录时调用） */
  disconnect(): void {
    this.manualClose = true;
    this.hasToken = false;
    this.clearTimers();
    if (this.ws) {
      try {
        this.ws.onclose = null;
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
    this.setConnected(false);
  }
}

// 模块级单例
let instance: WsClient | null = null;
function getInstance(): WsClient {
  if (!instance) instance = new WsClient();
  return instance;
}

export const wsClient = {
  connect: () => getInstance().connect(),
  disconnect: () => getInstance().disconnect(),
  subscribe: (fn: Listener) => getInstance().subscribe(fn),
  subscribeConnected: (fn: (c: boolean) => void) => getInstance().subscribeConnected(fn),
  isConnected: () => getInstance().isConnected(),
  send: (msg: unknown) => getInstance().send(msg),
};

export interface UseWebSocketResult {
  connected: boolean;
  /** 订阅服务端消息，返回取消订阅函数 */
  subscribe: (fn: Listener) => () => void;
}

/**
 * useWebSocket: 在组件挂载时确保连接已建立（token 存在的话），
 * 并订阅 connected 状态变化。
 */
export function useWebSocket(): UseWebSocketResult {
  const [connected, setConnected] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const client = getInstance();
    // 只在有 token 时连接
    if (getToken() && !client.isConnected()) {
      client.connect();
    }
    const unsub = client.subscribeConnected((c) => {
      if (mountedRef.current) setConnected(c);
    });
    setConnected(client.isConnected());
    return () => {
      mountedRef.current = false;
      unsub();
    };
  }, []);

  return {
    connected,
    subscribe: (fn: Listener) => getInstance().subscribe(fn),
  };
}

/** 类型守卫：审批请求 */
export function isApprovalRequest(
  msg: WsServerMessage,
): msg is WsServerMessage<WsApprovalRequestPayload> {
  return msg.type === 'approval_request';
}

/** 类型守卫：审批决策回执 */
export function isApprovalResponse(
  msg: WsServerMessage,
): msg is WsServerMessage<WsApprovalResponsePayload> {
  return msg.type === 'approval_response';
}

/** 类型守卫：活动事件 */
export function isActivity(msg: WsServerMessage): msg is WsServerMessage<Activity> {
  return msg.type === 'activity';
}
