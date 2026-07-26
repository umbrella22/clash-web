import type { AxiosResponse } from "axios";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createProgressSSE,
  getMihomoDownloadStatus,
  type DownloadProgress,
  type DownloadTaskStartResponse,
} from "../services/api";
import {
  isDownloadTaskActive,
  isDownloadTaskComplete,
  readStoredDownloadProgress,
  writeStoredDownloadProgress,
} from "../features/mihomoDownload";
import { formatApiError } from "../utils/errors";

interface UseMihomoDownloadTaskOptions {
  enabled?: boolean;
}

export function useMihomoDownloadTask(
  options: UseMihomoDownloadTaskOptions = {}
) {
  const { enabled = true } = options;
  const qc = useQueryClient();
  const [progress, setProgress] = useState<DownloadProgress | null>(() =>
    readStoredDownloadProgress()
  );
  const [actionError, setActionError] = useState<string | null>(null);
  const sseRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const mountedRef = useRef(true);
  const closedRef = useRef(false);

  const { refetch: refetchDownloadStatus } = useQuery({
    queryKey: ["mihomoDownloadStatus"],
    queryFn: () => getMihomoDownloadStatus().then((response) => response.data),
    enabled,
    refetchOnMount: "always",
  });

  const syncProgress = useCallback((next: DownloadProgress | null) => {
    const normalized = isDownloadTaskComplete(next) ? null : next;
    setProgress(normalized);
    writeStoredDownloadProgress(normalized);
  }, []);

  const closeProgressStream = useCallback(() => {
    closedRef.current = true;
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    sseRef.current?.close();
    sseRef.current = null;
  }, []);

  const invalidateRelatedQueries = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["mihomoDownloadStatus"] });
    qc.invalidateQueries({ queryKey: ["status"] });
    qc.invalidateQueries({ queryKey: ["mihomoVersion"] });
    qc.invalidateQueries({ queryKey: ["mihomoInstall"] });
  }, [qc]);

  const handleProgressUpdate = useCallback(
    (next: DownloadProgress) => {
      reconnectAttemptRef.current = 0;
      syncProgress(next);
      if (!next.active) {
        closeProgressStream();
        invalidateRelatedQueries();
      }
    },
    [closeProgressStream, invalidateRelatedQueries, syncProgress]
  );

  const refreshStatus = useCallback(async () => {
    const result = await refetchDownloadStatus();
    if (!result.data) return null;

    syncProgress(result.data);
    if (result.data.active) {
      return result.data;
    }

    closeProgressStream();
    return result.data;
  }, [closeProgressStream, refetchDownloadStatus, syncProgress]);

  const startListeningProgress = useCallback(() => {
    if (!mountedRef.current) return;
    if (sseRef.current || reconnectTimerRef.current !== null) return;

    closedRef.current = false;
    let es: EventSource;
    try {
      es = createProgressSSE();
    } catch {
      return;
    }
    sseRef.current = es;
    es.onopen = () => {
      reconnectAttemptRef.current = 0;
    };
    es.onmessage = (event) => {
      try {
        const next: DownloadProgress = JSON.parse(event.data);
        handleProgressUpdate(next);
      } catch {}
    };
    es.onerror = () => {
      es.close();
      if (sseRef.current === es) {
        sseRef.current = null;
      }
      void refreshStatus().then((latest) => {
        if (!mountedRef.current || closedRef.current) return;
        if (latest?.active && reconnectTimerRef.current === null) {
          const delay = Math.min(1000 * 2 ** reconnectAttemptRef.current, 10000);
          reconnectAttemptRef.current += 1;
          reconnectTimerRef.current = window.setTimeout(() => {
            reconnectTimerRef.current = null;
            startListeningProgress();
          }, delay);
        } else if (!latest?.active) {
          reconnectAttemptRef.current = 0;
        }
      }).catch(() => {
        if (!mountedRef.current || closedRef.current) return;
        if (reconnectTimerRef.current === null) {
          const delay = Math.min(1000 * 2 ** reconnectAttemptRef.current, 10000);
          reconnectAttemptRef.current += 1;
          reconnectTimerRef.current = window.setTimeout(() => {
            reconnectTimerRef.current = null;
            startListeningProgress();
          }, delay);
        }
      });
    };
  }, [handleProgressUpdate, refreshStatus]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      closeProgressStream();
    };
  }, [closeProgressStream]);

  useEffect(() => {
    if (!enabled) {
      closeProgressStream();
      return;
    }

    closedRef.current = false;
    void refreshStatus().then((latest) => {
      if (!mountedRef.current || closedRef.current) return;
      if (latest?.active) {
        startListeningProgress();
      }
    });
  }, [closeProgressStream, enabled, refreshStatus, startListeningProgress]);

  const runDownloadAction = useCallback(
    async (
      action: () => Promise<AxiosResponse<DownloadTaskStartResponse>>,
      fallbackError: string
    ) => {
      if (isDownloadTaskActive(progress)) return false;

      setActionError(null);
      try {
        const result = await action();
        if (!mountedRef.current) return false;
        const nextProgress = result.data.progress;
        syncProgress(nextProgress);
        if (nextProgress.active) {
          startListeningProgress();
        } else {
          invalidateRelatedQueries();
        }
        return true;
      } catch (error) {
        if (!mountedRef.current) return false;
        closeProgressStream();
        setActionError(formatApiError(error, fallbackError));
        const latest = await refreshStatus();
        if (mountedRef.current && !closedRef.current && latest?.active) {
          startListeningProgress();
        }
        return false;
      }
    },
    [
      closeProgressStream,
      invalidateRelatedQueries,
      progress,
      refreshStatus,
      startListeningProgress,
      syncProgress,
    ]
  );

  return {
    progress,
    actionError,
    actionPending: isDownloadTaskActive(progress),
    refreshStatus,
    runDownloadAction,
  };
}
