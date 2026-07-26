export interface LogEntry {
  type: string;
  payload: string;
}

/** A log entry stamped at arrival with a monotonic id (stable row key /
 * displayed line number) and the arrival timestamp in epoch milliseconds. */
export interface LogRecord extends LogEntry {
  id: number;
  receivedAt: number;
}

export const LOG_BUFFER_LIMIT = 1500;
export const LOG_RENDER_LIMIT = 300;
export const LOG_FLUSH_INTERVAL_MS = 250;

export function stampLog(entry: LogEntry, id: number, receivedAt: number): LogRecord {
  return { type: entry.type, payload: entry.payload, id, receivedAt };
}

/** Formats an epoch-ms timestamp as a local HH:MM:SS string. */
export function formatLogTime(receivedAt: number): string {
  const date = new Date(receivedAt);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function appendLogs<T>(
  current: T[],
  incoming: T[],
  limit: number = LOG_BUFFER_LIMIT
): T[] {
  if (incoming.length === 0) return current;
  const next = [...current, ...incoming];
  return next.length > limit ? next.slice(-limit) : next;
}

export function filterLogs<T extends LogEntry>(logs: T[], filter: string, search: string): T[] {
  const keyword = search.trim().toLowerCase();

  return logs.filter((log) => {
    if (filter !== "all" && log.type !== filter) return false;
    if (keyword && !log.payload.toLowerCase().includes(keyword)) return false;
    return true;
  });
}

export function getVisibleLogs<T>(logs: T[], limit: number = LOG_RENDER_LIMIT): T[] {
  return logs.length > limit ? logs.slice(-limit) : logs;
}
