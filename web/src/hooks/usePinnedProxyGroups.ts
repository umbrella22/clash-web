import { useCallback, useEffect, useState } from "react";
import {
  PINNED_PROXY_GROUPS_STORAGE_KEY,
  readPinnedProxyGroups,
  togglePinnedProxyGroup,
  writePinnedProxyGroups,
} from "../features/proxies";

export function usePinnedProxyGroups() {
  const [pinnedGroupNames, setPinnedGroupNames] = useState<string[]>(readPinnedProxyGroups);

  useEffect(() => {
    function handleStorage(event: StorageEvent) {
      if (event.key === PINNED_PROXY_GROUPS_STORAGE_KEY) {
        setPinnedGroupNames(readPinnedProxyGroups());
      }
    }

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const setPinnedGroups = useCallback((groupNames: string[]) => {
    setPinnedGroupNames(groupNames);
    writePinnedProxyGroups(groupNames);
  }, []);

  const togglePinnedGroup = useCallback((groupName: string) => {
    setPinnedGroupNames((current) => {
      const next = togglePinnedProxyGroup(current, groupName);
      writePinnedProxyGroups(next);
      return next;
    });
  }, []);

  return {
    pinnedGroupNames,
    setPinnedGroups,
    togglePinnedGroup,
  };
}

export const COLLAPSED_PROXY_GROUPS_STORAGE_KEY = "clash-web-collapsed-proxy-groups";

function readCollapsedProxyGroupOverrides(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  const raw = localStorage.getItem(COLLAPSED_PROXY_GROUPS_STORAGE_KEY);
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, boolean] =>
          entry[0].length > 0 && typeof entry[1] === "boolean"
      )
    );
  } catch {
    localStorage.removeItem(COLLAPSED_PROXY_GROUPS_STORAGE_KEY);
    return {};
  }
}

function writeCollapsedProxyGroupOverrides(overrides: Record<string, boolean>) {
  if (typeof window === "undefined") return;
  localStorage.setItem(COLLAPSED_PROXY_GROUPS_STORAGE_KEY, JSON.stringify(overrides));
}

/**
 * Per-group collapsed-state overrides persisted in localStorage. A group with
 * no stored override falls back to the caller-provided default (the proxies
 * page expands pinned groups and collapses the rest by default).
 */
export function useCollapsedProxyGroups() {
  const [collapsedOverrides, setCollapsedOverrides] = useState<Record<string, boolean>>(
    readCollapsedProxyGroupOverrides
  );

  useEffect(() => {
    function handleStorage(event: StorageEvent) {
      if (event.key === COLLAPSED_PROXY_GROUPS_STORAGE_KEY) {
        setCollapsedOverrides(readCollapsedProxyGroupOverrides());
      }
    }

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const isGroupCollapsed = useCallback(
    (groupName: string, defaultCollapsed: boolean) =>
      collapsedOverrides[groupName] ?? defaultCollapsed,
    [collapsedOverrides]
  );

  const toggleGroupCollapsed = useCallback(
    (groupName: string, defaultCollapsed: boolean) => {
      setCollapsedOverrides((current) => {
        const next = {
          ...current,
          [groupName]: !(current[groupName] ?? defaultCollapsed),
        };
        writeCollapsedProxyGroupOverrides(next);
        return next;
      });
    },
    []
  );

  return {
    isGroupCollapsed,
    toggleGroupCollapsed,
  };
}
