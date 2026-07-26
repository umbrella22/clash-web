import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { mihomoApi } from "../services/api";
import {
  buildProxyGroups,
  type ProxiesResponse,
  type ProxyItem,
} from "../features/proxies";

export const proxyQueryKey = ["proxies"] as const;

export function useProxies() {
  return useQuery({
    queryKey: proxyQueryKey,
    queryFn: () => mihomoApi.get<ProxiesResponse>("/").then((response) => response.data),
    refetchInterval: 10000,
  });
}

export function useProxyGroups(search: string = "") {
  const query = useProxies();
  const proxies = useMemo(
    () => (query.data?.proxies ?? {}) as Record<string, ProxyItem>,
    [query.data]
  );
  const groups = useMemo(() => buildProxyGroups(proxies, search), [proxies, search]);

  return {
    ...query,
    proxies,
    groups,
  };
}

export function useSelectProxy() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ group, name }: { group: string; name: string }) =>
      mihomoApi.put(`/proxies/${encodeURIComponent(group)}`, { name }),
    // Optimistically flip the group's "now" so the UI reacts instantly;
    // roll back on error and reconcile with the server once settled.
    // Both cache writes pin `updatedAt` to the existing stamp: consumers
    // (ProxiesPage's delay-override map) treat a dataUpdatedAt bump as "fresh
    // server data arrived", and an optimistic local write must not masquerade
    // as that. Rollback is per-group rather than a whole-map snapshot restore,
    // so a failed selection can't revert a concurrent selection in another group.
    onMutate: async ({ group, name }) => {
      await queryClient.cancelQueries({ queryKey: proxyQueryKey });
      const state = queryClient.getQueryState<ProxiesResponse>(proxyQueryKey);
      const previousNow = state?.data?.proxies?.[group]?.now;
      const previousUpdatedAt = state?.dataUpdatedAt;

      queryClient.setQueryData<ProxiesResponse>(
        proxyQueryKey,
        (current) => {
          const groupItem = current?.proxies?.[group];
          if (!current || !groupItem) return current;

          return {
            ...current,
            proxies: {
              ...current.proxies,
              [group]: { ...groupItem, now: name },
            },
          };
        },
        { updatedAt: previousUpdatedAt }
      );

      return { group, previousNow, previousUpdatedAt };
    },
    onError: (_error, _variables, context) => {
      if (!context || context.previousNow === undefined) return;
      queryClient.setQueryData<ProxiesResponse>(
        proxyQueryKey,
        (current) => {
          const groupItem = current?.proxies?.[context.group];
          if (!current || !groupItem) return current;

          return {
            ...current,
            proxies: {
              ...current.proxies,
              [context.group]: { ...groupItem, now: context.previousNow },
            },
          };
        },
        { updatedAt: context.previousUpdatedAt }
      );
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: proxyQueryKey }),
  });
}

export function useTestProxyDelay() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (name: string) =>
      mihomoApi.get(
        `/proxies/${encodeURIComponent(name)}/delay?timeout=5000&url=https://www.gstatic.com/generate_204`
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: proxyQueryKey }),
  });
}
