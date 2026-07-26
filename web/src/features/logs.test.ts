import { describe, expect, it } from "vitest";
import {
  appendLogs,
  filterLogs,
  formatLogTime,
  getVisibleLogs,
  stampLog,
  type LogEntry,
  type LogRecord,
} from "./logs";

const logs: LogEntry[] = [
  { type: "info", payload: "proxy started" },
  { type: "warning", payload: "slow provider" },
  { type: "error", payload: "provider failed" },
];

const records: LogRecord[] = logs.map((entry, i) => stampLog(entry, i + 1, 1000 + i));

describe("log helpers", () => {
  it("appends buffered logs and trims from the head", () => {
    expect(appendLogs(logs.slice(0, 2), logs.slice(2), 2)).toEqual(logs.slice(1));
  });

  it("appends stamped records and preserves ids across trimming", () => {
    const trimmed = appendLogs(records.slice(0, 2), records.slice(2), 2);
    expect(trimmed.map((r) => r.id)).toEqual([2, 3]);
  });

  it("filters by level and keyword", () => {
    expect(filterLogs(logs, "warning", "provider")).toEqual([logs[1]]);
    expect(filterLogs(logs, "all", "PROVIDER")).toEqual([logs[1], logs[2]]);
  });

  it("filters stamped records without losing metadata", () => {
    expect(filterLogs(records, "error", "")).toEqual([records[2]]);
  });

  it("returns only the latest visible rows", () => {
    expect(getVisibleLogs([1, 2, 3, 4], 2)).toEqual([3, 4]);
  });

  it("stamps entries with id and arrival time", () => {
    const record = stampLog({ type: "info", payload: "hello" }, 42, 123456);
    expect(record).toEqual({ type: "info", payload: "hello", id: 42, receivedAt: 123456 });
  });

  it("formats arrival time as zero-padded HH:MM:SS", () => {
    const timestamp = new Date(2026, 6, 26, 9, 5, 3).getTime();
    expect(formatLogTime(timestamp)).toBe("09:05:03");
  });
});
