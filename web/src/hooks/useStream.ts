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
}: {
  createSocket: () => WebSocket;
  initialValue: T;
  normalize: (value: unknown) => T;
}) {
  const [current, setCurrent] = useState<T>(initialValue);
  const [history, setHistory] = useState<T[]>([]);
  const [status, setStatus] = useState<StreamStatus>("connecting");
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const closedByUnmountRef = useRef(false);
  const normalizeRef = useRef(normalize);

  useEffect(() => {
    normalizeRef.current = normalize;
  }, [normalize]);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
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
    setStatus("reconnecting");
    reconnectTimerRef.current = window.setTimeout(() => {
      reconnectTimerRef.current = null;
      connectFn();
    }, delay);
  }, []);

  const connect = useCallback(() => {
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

    ws.onopen = () => {
      if (wsRef.current !== ws) return;
      reconnectAttemptRef.current = 0;
      setStatus("open");
    };

    ws.onmessage = (event) => {
      if (wsRef.current !== ws) return;
      try {
        const data = normalizeRef.current(JSON.parse(event.data));
        setCurrent(data);
        setHistory((prev) => appendHistory(prev, data));
      } catch {
        return;
      }
    };

    ws.onclose = () => {
      if (wsRef.current !== ws) return;
      wsRef.current = null;

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
  }, [clearReconnectTimer, createSocket, scheduleReconnect]);

  useEffect(() => {
    closedByUnmountRef.current = false;
    connect();

    return () => {
      closedByUnmountRef.current = true;
      clearReconnectTimer();
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [clearReconnectTimer, connect]);

  return { current, history, status };
}

export function useTraffic() {
  const stream = useRealtimeStream<TrafficData>({
    createSocket: createTrafficWs,
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

export function useMemory() {
  const stream = useRealtimeStream<MemoryData>({
    createSocket: createMemoryWs,
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
