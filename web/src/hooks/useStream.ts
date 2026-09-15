import { useEffect, useRef, useState, useCallback } from "react";
import { createTrafficWs, createMemoryWs } from "../services/api";

export interface TrafficData {
  up: number;
  down: number;
}

export interface MemoryData {
  inuse: number;
  oslimit: number;
}

type StreamStatus = "connecting" | "open" | "reconnecting" | "closed";

const MAX_HISTORY_POINTS = 60;
const INITIAL_RECONNECT_DELAY_MS = 3000;
const MAX_RECONNECT_DELAY_MS = 30000;
// Traffic and memory arrive every second; an open but silent socket is stale.
const STREAM_IDLE_TIMEOUT_MS = 10000;

function appendHistory<T>(prev: T[], item: T): T[] {
  const next = [...prev, item];
  return next.length > MAX_HISTORY_POINTS ? next.slice(-MAX_HISTORY_POINTS) : next;
}

function normalizeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function useRealtimeStream<T>({
  createSocket,
  initialValue,
  normalize,
  enabled,
}: {
  createSocket: () => WebSocket;
  initialValue: T;
  normalize: (value: unknown) => T;
  enabled: boolean;
}) {
  const [current, setCurrent] = useState<T>(initialValue);
  const [history, setHistory] = useState<T[]>([]);
  const [status, setStatus] = useState<StreamStatus>("connecting");
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const idleTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const closedByUnmountRef = useRef(false);
  const normalizeRef = useRef(normalize);
  const initialValueRef = useRef(initialValue);

  useEffect(() => {
    normalizeRef.current = normalize;
  }, [normalize]);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const clearIdleTimer = useCallback(() => {
    if (idleTimerRef.current !== null) {
      window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }, []);

  const scheduleReconnect = useCallback((connectFn: () => void) => {
    if (closedByUnmountRef.current || reconnectTimerRef.current !== null) return;

    reconnectAttemptRef.current += 1;
    const baseDelay = Math.min(
      INITIAL_RECONNECT_DELAY_MS * 2 ** (reconnectAttemptRef.current - 1),
      MAX_RECONNECT_DELAY_MS
    );
    const delay = baseDelay + Math.floor(Math.random() * 1000);
    setCurrent(initialValueRef.current);
    setStatus("reconnecting");
    reconnectTimerRef.current = window.setTimeout(() => {
      reconnectTimerRef.current = null;
      connectFn();
    }, delay);
  }, []);

  const connect = useCallback(function connect() {
    const existingSocket = wsRef.current;
    if (
      existingSocket &&
      (existingSocket.readyState === WebSocket.CONNECTING || existingSocket.readyState === WebSocket.OPEN)
    ) {
      return;
    }

    clearReconnectTimer();
    setStatus(reconnectAttemptRef.current > 0 ? "reconnecting" : "connecting");

    let ws: WebSocket;
    try {
      ws = createSocket();
    } catch {
      scheduleReconnect(connect);
      return;
    }
    wsRef.current = ws;

    const watchForData = () => {
      clearIdleTimer();
      idleTimerRef.current = window.setTimeout(() => {
        idleTimerRef.current = null;
        if (closedByUnmountRef.current || wsRef.current !== ws) return;
        // Retire this socket before closing it; a delayed close event must
        // not disturb its replacement or prevent reconnecting.
        wsRef.current = null;
        ws.close();
        scheduleReconnect(connect);
      }, STREAM_IDLE_TIMEOUT_MS);
    };
    watchForData();

    ws.onmessage = (event) => {
      if (wsRef.current !== ws) return;
      try {
        const data = normalizeRef.current(JSON.parse(event.data));
        watchForData();
        reconnectAttemptRef.current = 0;
        setStatus("open");
        setCurrent(data);
        setHistory((prev) => appendHistory(prev, data));
      } catch {
        return;
      }
    };

    ws.onclose = () => {
      if (wsRef.current !== ws) return;
      wsRef.current = null;
      clearIdleTimer();

      if (closedByUnmountRef.current) {
        setStatus("closed");
        return;
      }

      scheduleReconnect(connect);
    };

    ws.onerror = () => {
      if (wsRef.current !== ws) return;
      ws.close();
    };
  }, [clearIdleTimer, clearReconnectTimer, createSocket, scheduleReconnect]);

  useEffect(() => {
    if (!enabled) return;
    closedByUnmountRef.current = false;
    reconnectAttemptRef.current = 0;
    connect();

    return () => {
      closedByUnmountRef.current = true;
      clearReconnectTimer();
      clearIdleTimer();
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [clearIdleTimer, clearReconnectTimer, connect, enabled]);

  return {
    current: enabled ? current : initialValue,
    history: enabled ? history : [],
    status: enabled ? status : "closed" as StreamStatus,
  };
}

export function useTraffic(enabled = true) {
  const stream = useRealtimeStream<TrafficData>({
    createSocket: createTrafficWs,
    enabled,
    initialValue: { up: 0, down: 0 },
    normalize: (value) => {
      const data = value as Partial<TrafficData>;
      return {
        up: normalizeNumber(data.up),
        down: normalizeNumber(data.down),
      };
    },
  });

  return { traffic: stream.current, history: stream.history, status: stream.status };
}

export function useMemory(enabled = true) {
  const stream = useRealtimeStream<MemoryData>({
    createSocket: createMemoryWs,
    enabled,
    initialValue: { inuse: 0, oslimit: 0 },
    normalize: (value) => {
      const data = value as Partial<MemoryData>;
      return {
        inuse: normalizeNumber(data.inuse),
        oslimit: normalizeNumber(data.oslimit),
      };
    },
  });

  return { memory: stream.current, history: stream.history, status: stream.status };
}
