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
export type ClashMode = "rule" | "global" | "direct";

export interface CurrentProxyTarget {
  mode: ClashMode;
  groups: ProxyGroup[];
  selectedGroup?: ProxyGroup;
  groupName: string;
  groupLocked: boolean;
  nodeName: string;
  nodeOptions: string[];
  node?: ProxyItem;
  nodeDelay: number;
  isChainSelection: boolean;
  chainTarget?: ProxyGroup;
}

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
const RULE_GROUP_NAME_HINTS = [
  "proxy",
  "节点选择",
  "select",
  "selector",
  "final",
  "default",
  "auto",
  "自动",
  "gateway",
] as const;
const GLOBAL_PROXY_GROUP_NAME = "GLOBAL";
const DIRECT_PROXY_NAME = "DIRECT";
const GLOBAL_MODE_SPECIAL_OPTIONS = new Set(["DIRECT", "REJECT"]);

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

export function getDelay(proxy?: ProxyItem | null, override?: number): number {
  const history = proxy?.history;
  // mihomo records delay 0 when the URL test FAILED — treat it as unavailable,
  // never as a (best-looking) 0ms result.
  const delay = override ?? history?.at(-1)?.delay ?? -1;
  return delay > 0 ? delay : -1;
}

export function reconcileDelayOverrides(
  overrides: Record<string, number>,
  previous: Record<string, ProxyItem>,
  current: Record<string, ProxyItem>
): Record<string, number> {
  return Object.fromEntries(Object.entries(overrides).filter(([name]) => {
    const before = previous[name];
    const after = current[name];
    if (!after || before?.type !== after.type) return false;
    const beforeTest = before?.history?.at(-1);
    const afterTest = after.history?.at(-1);
    return beforeTest?.time === afterTest?.time && beforeTest?.delay === afterTest?.delay;
  }));
}

export type DelayColor = "success" | "warning" | "error" | "default";

/** Single source of truth for delay chip colors; <=0 means failed/untested. */
export function getDelayColor(delay: number): DelayColor {
  if (delay <= 0) return "default";
  if (delay <= 300) return "success";
  if (delay <= 800) return "warning";
  return "error";
}

export function normalizeClashMode(mode?: string | null): ClashMode {
  const normalized = mode?.toLowerCase();
  if (normalized === "global" || normalized === "direct") return normalized;
  return "rule";
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

function getRuleGroupCandidates(groups: ProxyGroup[]): ProxyGroup[] {
  const nonGlobalGroups = groups.filter((group) => group.groupName !== GLOBAL_PROXY_GROUP_NAME);
  const candidates = nonGlobalGroups.length > 0 ? nonGlobalGroups : groups;
  const selectorGroups = candidates.filter((group) => group.type === "Selector");

  return selectorGroups.length > 0 ? selectorGroups : candidates;
}

function getRuleGroupScore(group: ProxyGroup): number {
  const name = group.groupName.toLowerCase();
  const hintIndex = RULE_GROUP_NAME_HINTS.findIndex((hint) => name.includes(hint));

  return hintIndex === -1 ? RULE_GROUP_NAME_HINTS.length : hintIndex;
}

export function getPrimaryRuleProxyGroup(
  groups: ProxyGroup[],
  preferredGroupName?: string | null
): ProxyGroup | undefined {
  const candidates = getRuleGroupCandidates(groups);
  const preferred = preferredGroupName
    ? candidates.find((group) => group.groupName === preferredGroupName)
    : undefined;
  if (preferred) return preferred;

  return [...candidates].sort((left, right) => {
    const leftScore = getRuleGroupScore(left);
    const rightScore = getRuleGroupScore(right);
    if (leftScore !== rightScore) return leftScore - rightScore;
    if (left.all.length !== right.all.length) return right.all.length - left.all.length;
    return left.groupName.localeCompare(right.groupName);
  })[0];
}

function getNodeOptions(group: ProxyGroup, mode: ClashMode): string[] {
  const names = Array.from(new Set(group.all.filter((name) => name.length > 0)));
  if (mode !== "global") return names;

  const filtered = names.filter((name) => !GLOBAL_MODE_SPECIAL_OPTIONS.has(name));
  if (group.now && GLOBAL_MODE_SPECIAL_OPTIONS.has(group.now)) return names;

  return filtered.length > 0 ? filtered : names;
}

function getSelectedNodeName(group: ProxyGroup | undefined, options: string[]): string {
  if (!group) return "";
  if (group.now && options.includes(group.now)) return group.now;
  return options[0] ?? group.now ?? "";
}

export function getCurrentProxyTarget(
  proxies: Record<string, ProxyItem>,
  rawMode?: string | null,
  preferredRuleGroupName?: string | null,
  delayOverrides: Record<string, number> = {}
): CurrentProxyTarget {
  const mode = normalizeClashMode(rawMode);
  const allGroups = createProxyGroups(proxies);
  const ruleGroups = getRuleGroupCandidates(allGroups);

  if (mode === "direct") {
    const directNode = proxies[DIRECT_PROXY_NAME] ?? { name: DIRECT_PROXY_NAME, type: "Direct" };
    return {
      mode,
      groups: ruleGroups,
      groupName: DIRECT_PROXY_NAME,
      groupLocked: true,
      nodeName: DIRECT_PROXY_NAME,
      nodeOptions: [DIRECT_PROXY_NAME],
      node: directNode,
      nodeDelay: getDelay(directNode),
      isChainSelection: false,
    };
  }

  const selectedGroup =
    mode === "global"
      ? allGroups.find((group) => group.groupName === GLOBAL_PROXY_GROUP_NAME) ??
        getPrimaryRuleProxyGroup(allGroups, preferredRuleGroupName)
      : getPrimaryRuleProxyGroup(allGroups, preferredRuleGroupName);
  const nodeOptions = selectedGroup ? getNodeOptions(selectedGroup, mode) : [];
  const nodeName = getSelectedNodeName(selectedGroup, nodeOptions);
  const node = nodeName ? proxies[nodeName] : undefined;
  const chainTarget = nodeName ? allGroups.find((group) => group.groupName === nodeName) : undefined;

  return {
    mode,
    groups: ruleGroups,
    selectedGroup,
    groupName:
      selectedGroup?.groupName ?? (mode === "global" ? GLOBAL_PROXY_GROUP_NAME : ""),
    groupLocked: mode === "global",
    nodeName,
    nodeOptions: sortProxyNames(nodeOptions, proxies, "delay", delayOverrides),
    node,
    nodeDelay: getDelay(node, delayOverrides[nodeName]),
    isChainSelection: Boolean(chainTarget),
    chainTarget,
  };
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
  proxies: Record<string, ProxyItem>,
  delayOverrides: Record<string, number> = {}
): GroupSummary {
  const delays = group.all
    .map((name) => getDelay(proxies[name], delayOverrides[name]))
    .filter((delay) => delay >= 0);
  const activeDelay = group.now ? getDelay(proxies[group.now], delayOverrides[group.now]) : -1;

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
  availabilityFilter: ProxyAvailabilityFilter,
  delayOverrides: Record<string, number> = {}
): string[] {
  const keyword = normalizeKeyword(search);
  const groupMatched =
    keyword.length > 0 &&
    (includesKeyword(group.groupName, keyword) || includesKeyword(group.now, keyword));

  return group.all.filter((name) => {
    const delay = getDelay(proxies[name], delayOverrides[name]);
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
  sortMode: ProxySortMode,
  delayOverrides: Record<string, number> = {}
): string[] {
  const sorted = [...names];

  if (sortMode === "name") {
    return sorted.sort((left, right) => left.localeCompare(right));
  }

  if (sortMode === "delay") {
    return sorted.sort((left, right) => {
      const leftDelay = getDelay(proxies[left], delayOverrides[left]);
      const rightDelay = getDelay(proxies[right], delayOverrides[right]);

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
