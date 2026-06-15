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
    onSuccess: () => queryClient.refetchQueries({ queryKey: proxyQueryKey }),
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
