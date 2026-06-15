// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import {
  formatBytes,
  formatBytesPerSecond,
  formatRemainingTime,
  isDownloadTaskActive,
  isDownloadTaskComplete,
  readStoredDownloadProgress,
  writeStoredDownloadProgress,
} from "./mihomoDownload";
import type { DownloadProgress } from "../services/api";

const sampleProgress: DownloadProgress = {
  active: true,
  task_type: "install",
  status: "downloading",
  downloaded: 1024,
  total: 2048,
  percent: 50,
  remaining_secs: 8,
  bytes_per_sec: 128,
  started_at: 100,
  updated_at: 108,
  message: "Downloading",
};

describe("mihomoDownload helpers", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("persists and restores download progress", () => {
    writeStoredDownloadProgress(sampleProgress);
    expect(readStoredDownloadProgress()).toEqual(sampleProgress);
  });

  it("clears invalid cached progress", () => {
    localStorage.setItem("clash-web-mihomo-download-progress", "{invalid json");
    expect(readStoredDownloadProgress()).toBeNull();
    expect(localStorage.getItem("clash-web-mihomo-download-progress")).toBeNull();
  });

  it("detects active task state", () => {
    expect(isDownloadTaskActive(sampleProgress)).toBe(true);
    expect(
      isDownloadTaskActive({
        ...sampleProgress,
        active: false,
        status: "done",
      })
    ).toBe(false);
  });

  it("does not persist completed download progress", () => {
    const completedProgress = {
      ...sampleProgress,
      active: false,
      status: "done",
    } as const;

    expect(isDownloadTaskComplete(completedProgress)).toBe(true);
    writeStoredDownloadProgress(completedProgress);
    expect(readStoredDownloadProgress()).toBeNull();
    expect(localStorage.getItem("clash-web-mihomo-download-progress")).toBeNull();
  });

  it("formats remaining time and transfer metrics", () => {
    expect(formatRemainingTime(59)).toBe("59s");
    expect(formatRemainingTime(125)).toBe("2m 5s");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytesPerSecond(2048)).toBe("2.0 KB/s");
  });
});
