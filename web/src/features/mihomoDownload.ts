import type { DownloadProgress } from "../services/api";

export const MIHOMO_DOWNLOAD_STORAGE_KEY = "clash-web-mihomo-download-progress";

export function readStoredDownloadProgress(): DownloadProgress | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(MIHOMO_DOWNLOAD_STORAGE_KEY);
  if (!raw) return null;

  try {
    const progress = JSON.parse(raw) as DownloadProgress;
    if (isDownloadTaskComplete(progress)) {
      localStorage.removeItem(MIHOMO_DOWNLOAD_STORAGE_KEY);
      return null;
    }
    return progress;
  } catch {
    localStorage.removeItem(MIHOMO_DOWNLOAD_STORAGE_KEY);
    return null;
  }
}

export function writeStoredDownloadProgress(progress: DownloadProgress | null) {
  if (typeof window === "undefined") return;
  if (!progress || isDownloadTaskComplete(progress)) {
    localStorage.removeItem(MIHOMO_DOWNLOAD_STORAGE_KEY);
    return;
  }
  localStorage.setItem(MIHOMO_DOWNLOAD_STORAGE_KEY, JSON.stringify(progress));
}

export function isDownloadTaskActive(progress: DownloadProgress | null | undefined): boolean {
  return Boolean(progress?.active);
}

export function isDownloadTaskComplete(progress: DownloadProgress | null | undefined): boolean {
  return Boolean(progress && !progress.active && (progress.status === "done" || progress.status === "idle"));
}

export function formatRemainingTime(seconds: number | null | undefined): string {
  if (seconds == null || Number.isNaN(seconds) || seconds < 0) return "--";
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  const remainSeconds = seconds % 60;
  if (minutes < 60) {
    return remainSeconds > 0 ? `${minutes}m ${remainSeconds}s` : `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainMinutes = minutes % 60;
  return remainMinutes > 0 ? `${hours}h ${remainMinutes}m` : `${hours}h`;
}

export function formatBytesPerSecond(bytesPerSecond: number | null | undefined): string {
  if (bytesPerSecond == null || bytesPerSecond <= 0) return "--";
  return `${formatBytes(bytesPerSecond)}/s`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || bytes < 0) return "--";
  if (bytes < 1024) return `${bytes} B`;

  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

export function describeDownloadStatus(status: string): string {
  switch (status) {
    case "starting":
      return "starting";
    case "downloading":
      return "downloading";
    case "extracting":
      return "extracting";
    case "done":
      return "done";
    case "error":
      return "error";
    default:
      return "idle";
  }
}
