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
