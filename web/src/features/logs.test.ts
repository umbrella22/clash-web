import { describe, expect, it } from "vitest";
import { appendLogs, filterLogs, getVisibleLogs, type LogEntry } from "./logs";

const logs: LogEntry[] = [
  { type: "info", payload: "proxy started" },
  { type: "warning", payload: "slow provider" },
  { type: "error", payload: "provider failed" },
];

describe("log helpers", () => {
  it("appends buffered logs and trims from the head", () => {
    expect(appendLogs(logs.slice(0, 2), logs.slice(2), 2)).toEqual(logs.slice(1));
  });

  it("filters by level and keyword", () => {
    expect(filterLogs(logs, "warning", "provider")).toEqual([logs[1]]);
    expect(filterLogs(logs, "all", "PROVIDER")).toEqual([logs[1], logs[2]]);
  });

  it("returns only the latest visible rows", () => {
    expect(getVisibleLogs([1, 2, 3, 4], 2)).toEqual([3, 4]);
  });
});
