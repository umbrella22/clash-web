export interface ProxyItem {
  name: string;
  type: string;
  all?: string[];
  now?: string;
  history?: { time: string; delay: number }[];
}

export interface ProxiesResponse {
  proxies: Record<string, ProxyItem>;
}

export interface ProxyProvider {
  type: string;
  proxies: { name: string; type: string }[];
  vehicleType: string;
  subscriptionInfo?: {
    Upload?: number;
    Download?: number;
    Total?: number;
    Expire?: number;
  };
  updatedAt?: string;
}

export interface ProvidersResponse {
  providers: Record<string, ProxyProvider>;
}

export interface ProxyGroup extends ProxyItem {
  groupName: string;
  all: string[];
}

export interface GroupSummary {
  totalNodes: number;
  availableNodes: number;
  unavailableNodes: number;
  activeDelay: number | null;
  bestDelay: number | null;
  averageDelay: number | null;
}

export interface ProviderSummary {
  totalNodes: number;
  availableNodes: number;
  bestDelay: number | null;
  averageDelay: number | null;
}

export type ProxySortMode = "default" | "delay" | "name";
export type ProxyAvailabilityFilter = "all" | "available" | "unavailable";
export type ProviderVehicleFilter = string;

export const PINNED_PROXY_GROUPS_STORAGE_KEY = "clash-web-pinned-proxy-groups";
export const GROUP_TYPES = ["Selector", "URLTest", "Fallback", "LoadBalance", "Relay"] as const;
const GROUP_TYPE_ALIASES = new Map([
  ["selector", "Selector"],
  ["select", "Selector"],
  ["urltest", "URLTest"],
  ["url-test", "URLTest"],
  ["fallback", "Fallback"],
  ["loadbalance", "LoadBalance"],
  ["load-balance", "LoadBalance"],
  ["relay", "Relay"],
]);
const QUICK_GROUP_NAME_HINTS = [
  "global",
  "proxy",
  "final",
  "select",
  "default",
  "auto",
  "gateway",
  "home",
] as const;

function normalizeKeyword(value: string): string {
  return value.trim().toLowerCase();
}

function includesKeyword(value: string | undefined, keyword: string): boolean {
  if (!keyword) return true;
  return (value ?? "").toLowerCase().includes(keyword);
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export function getDelay(proxy?: ProxyItem | null): number {
  const history = proxy?.history;
  if (!history || history.length === 0) return -1;
  return history[history.length - 1].delay;
}

export function createProxyGroups(proxies: Record<string, ProxyItem>): ProxyGroup[] {
  return Object.entries(proxies)
    .map(([groupName, value]) => {
      const groupType = GROUP_TYPE_ALIASES.get(value.type.toLowerCase());
      if (!groupType || !Array.isArray(value.all)) return null;
      return { groupName, ...value, type: groupType, all: value.all };
    })
    .filter((group): group is ProxyGroup => group !== null);
}

export function buildProxyGroups(
  proxies: Record<string, ProxyItem>,
  search: string = ""
): ProxyGroup[] {
  const groups = createProxyGroups(proxies);
  if (!search.trim()) return groups;

  const keyword = normalizeKeyword(search);
  return groups.filter(
    (group) =>
      includesKeyword(group.groupName, keyword) ||
      includesKeyword(group.now, keyword) ||
      group.all.some((name) => includesKeyword(name, keyword))
  );
}

export function readPinnedProxyGroups(): string[] {
  if (typeof window === "undefined") return [];
  const raw = localStorage.getItem(PINNED_PROXY_GROUPS_STORAGE_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    return Array.from(
      new Set(parsed.filter((name): name is string => typeof name === "string" && name.length > 0))
    );
  } catch {
    localStorage.removeItem(PINNED_PROXY_GROUPS_STORAGE_KEY);
    return [];
  }
}

export function writePinnedProxyGroups(groupNames: string[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(
    PINNED_PROXY_GROUPS_STORAGE_KEY,
    JSON.stringify(Array.from(new Set(groupNames)))
  );
}

export function togglePinnedProxyGroup(groupNames: string[], groupName: string): string[] {
  if (groupNames.includes(groupName)) {
    return groupNames.filter((name) => name !== groupName);
  }

  return [...groupNames, groupName];
}

export function sortProxyGroupsByPinned<T extends ProxyGroup>(
  groups: T[],
  pinnedGroupNames: string[]
): T[] {
  if (pinnedGroupNames.length === 0) return groups;

  const pinnedIndex = new Map(pinnedGroupNames.map((name, index) => [name, index]));
  return [...groups].sort((left, right) => {
    const leftIndex = pinnedIndex.get(left.groupName);
    const rightIndex = pinnedIndex.get(right.groupName);

    if (leftIndex === undefined && rightIndex === undefined) return 0;
    if (leftIndex === undefined) return 1;
    if (rightIndex === undefined) return -1;
    return leftIndex - rightIndex;
  });
}

export function getQuickControlGroups(
  groups: ProxyGroup[],
  pinnedGroupNames: string[] = [],
  limit: number = 3
): ProxyGroup[] {
  const pinnedGroups = sortProxyGroupsByPinned(groups, pinnedGroupNames).filter((group) =>
    pinnedGroupNames.includes(group.groupName)
  );
  const pinnedGroupSet = new Set(pinnedGroups.map((group) => group.groupName));
  const heuristicGroups = groups
    .filter((group) => !pinnedGroupSet.has(group.groupName))
    .sort((left, right) => {
      const leftName = left.groupName.toLowerCase();
      const rightName = right.groupName.toLowerCase();
      const leftHint = QUICK_GROUP_NAME_HINTS.findIndex((hint) => leftName.includes(hint));
      const rightHint = QUICK_GROUP_NAME_HINTS.findIndex((hint) => rightName.includes(hint));
      const normalizedLeftHint =
        leftHint === -1 ? QUICK_GROUP_NAME_HINTS.length : leftHint;
      const normalizedRightHint =
        rightHint === -1 ? QUICK_GROUP_NAME_HINTS.length : rightHint;

      if (normalizedLeftHint !== normalizedRightHint) {
        return normalizedLeftHint - normalizedRightHint;
      }

      if (right.all.length !== left.all.length) {
        return right.all.length - left.all.length;
      }

      return left.groupName.localeCompare(right.groupName);
    });

  return [...pinnedGroups, ...heuristicGroups].slice(0, limit);
}

export function summarizeGroup(
  group: ProxyGroup,
  proxies: Record<string, ProxyItem>
): GroupSummary {
  const delays = group.all
    .map((name) => getDelay(proxies[name]))
    .filter((delay) => delay >= 0);
  const activeDelay = group.now ? getDelay(proxies[group.now]) : -1;

  return {
    totalNodes: group.all.length,
    availableNodes: delays.length,
    unavailableNodes: group.all.length - delays.length,
    activeDelay: activeDelay >= 0 ? activeDelay : null,
    bestDelay: delays.length > 0 ? Math.min(...delays) : null,
    averageDelay: average(delays),
  };
}

export function filterGroupProxyNames(
  group: ProxyGroup,
  proxies: Record<string, ProxyItem>,
  search: string,
  availabilityFilter: ProxyAvailabilityFilter
): string[] {
  const keyword = normalizeKeyword(search);
  const groupMatched =
    keyword.length > 0 &&
    (includesKeyword(group.groupName, keyword) || includesKeyword(group.now, keyword));

  return group.all.filter((name) => {
    const delay = getDelay(proxies[name]);
    const availabilityMatched =
      availabilityFilter === "all" ||
      (availabilityFilter === "available" && delay >= 0) ||
      (availabilityFilter === "unavailable" && delay < 0);

    if (!availabilityMatched) return false;
    if (!keyword) return true;
    return groupMatched || includesKeyword(name, keyword);
  });
}

export function sortProxyNames(
  names: string[],
  proxies: Record<string, ProxyItem>,
  sortMode: ProxySortMode
): string[] {
  const sorted = [...names];

  if (sortMode === "name") {
    return sorted.sort((left, right) => left.localeCompare(right));
  }

  if (sortMode === "delay") {
    return sorted.sort((left, right) => {
      const leftDelay = getDelay(proxies[left]);
      const rightDelay = getDelay(proxies[right]);

      if (leftDelay < 0 && rightDelay < 0) return left.localeCompare(right);
      if (leftDelay < 0) return 1;
      if (rightDelay < 0) return -1;
      if (leftDelay === rightDelay) return left.localeCompare(right);
      return leftDelay - rightDelay;
    });
  }

  return sorted;
}

export function filterProviders<T extends ProxyProvider & { name: string }>(
  providers: T[],
  search: string,
  vehicleFilter: ProviderVehicleFilter
): T[] {
  const keyword = normalizeKeyword(search);

  return providers.filter((provider) => {
    const vehicleMatched = vehicleFilter === "all" || provider.vehicleType === vehicleFilter;
    if (!vehicleMatched) return false;
    if (!keyword) return true;

    return (
      includesKeyword(provider.name, keyword) ||
      provider.proxies.some((proxy) => includesKeyword(proxy.name, keyword))
    );
  });
}

export function summarizeProvider(
  provider: ProxyProvider,
  proxies: Record<string, ProxyItem>
): ProviderSummary {
  const delays = (provider.proxies ?? [])
    .map((proxy) => getDelay(proxies[proxy.name]))
    .filter((delay) => delay >= 0);

  return {
    totalNodes: provider.proxies?.length ?? 0,
    availableNodes: delays.length,
    bestDelay: delays.length > 0 ? Math.min(...delays) : null,
    averageDelay: average(delays),
  };
}
