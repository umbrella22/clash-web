export interface LogEntry {
  type: string;
  payload: string;
}

export const LOG_BUFFER_LIMIT = 1500;
export const LOG_RENDER_LIMIT = 300;
export const LOG_FLUSH_INTERVAL_MS = 250;

export function appendLogs(
  current: LogEntry[],
  incoming: LogEntry[],
  limit: number = LOG_BUFFER_LIMIT
): LogEntry[] {
  if (incoming.length === 0) return current;
  const next = [...current, ...incoming];
  return next.length > limit ? next.slice(-limit) : next;
}

export function filterLogs(logs: LogEntry[], filter: string, search: string): LogEntry[] {
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
