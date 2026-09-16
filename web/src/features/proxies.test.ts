import { describe, expect, it } from "vitest";
import {
  buildProxyGroups,
  filterGroupProxyNames,
  filterProviders,
  getCurrentProxyTarget,
  getDelay,
  getDelayColor,
  reconcileDelayOverrides,
  getPrimaryRuleProxyGroup,
  getQuickControlGroups,
  sortProxyGroupsByPinned,
  sortProxyNames,
  summarizeGroup,
  summarizeProvider,
  togglePinnedProxyGroup,
  type ProxyItem,
  type ProxyProvider,
} from "./proxies";

const proxies: Record<string, ProxyItem> = {
  GLOBAL: {
    name: "GLOBAL",
    type: "Selector",
    all: ["Alpha", "Bravo", "Offline"],
    now: "Bravo",
  },
  Alpha: {
    name: "Alpha",
    type: "Shadowsocks",
    history: [{ time: "2026-05-30T00:00:00Z", delay: 120 }],
  },
  Bravo: {
    name: "Bravo",
    type: "Trojan",
    history: [{ time: "2026-05-30T00:00:00Z", delay: 80 }],
  },
  Offline: {
    name: "Offline",
    type: "Trojan",
  },
  FINAL: {
    name: "FINAL",
    type: "Fallback",
    all: ["DIRECT", "Alpha"],
    now: "Alpha",
  },
  DIRECT: {
    name: "DIRECT",
    type: "Direct",
    history: [{ time: "2026-05-30T00:00:00Z", delay: 0 }],
  },
};

const providers: Array<ProxyProvider & { name: string }> = [
  {
    name: "Provider Alpha",
    type: "Proxy",
    vehicleType: "HTTP",
    proxies: [
      { name: "Alpha", type: "Shadowsocks" },
      { name: "Offline", type: "Trojan" },
    ],
  },
  {
    name: "Provider Bravo",
    type: "Proxy",
    vehicleType: "File",
    proxies: [{ name: "Bravo", type: "Trojan" }],
  },
];

describe("proxy helpers", () => {
  it("builds searchable groups and summarizes delay metrics", () => {
    const groups = buildProxyGroups(proxies, "global");
    expect(groups).toHaveLength(1);

    const summary = summarizeGroup(groups[0], proxies);
    expect(summary).toEqual({
      totalNodes: 3,
      availableNodes: 2,
      unavailableNodes: 1,
      activeDelay: 80,
      bestDelay: 80,
      averageDelay: 100,
    });
  });

  it("filters visible nodes by search and availability and sorts by delay", () => {
    const group = buildProxyGroups(proxies)[0];

    expect(filterGroupProxyNames(group, proxies, "global", "available")).toEqual([
      "Alpha",
      "Bravo",
    ]);
    expect(filterGroupProxyNames(group, proxies, "", "unavailable")).toEqual(["Offline"]);
    expect(sortProxyNames(group.all, proxies, "delay")).toEqual([
      "Bravo",
      "Alpha",
      "Offline",
    ]);
  });

  it("treats mihomo's failed-test delay 0 as unavailable", () => {
    const dead: ProxyItem = {
      name: "Dead",
      type: "Trojan",
      history: [{ time: "2026-05-30T00:00:00Z", delay: 0 }],
    };
    expect(getDelay(dead)).toBe(-1);
    expect(getDelay(proxies.Alpha)).toBe(120);
    expect(getDelay(proxies.Offline)).toBe(-1);

    const withDead: Record<string, ProxyItem> = {
      ...proxies,
      GLOBAL: { ...proxies.GLOBAL, all: ["Alpha", "Bravo", "Dead"] },
      Dead: dead,
    };
    const group = buildProxyGroups(withDead, "global")[0];
    expect(summarizeGroup(group, withDead).availableNodes).toBe(2);
    expect(filterGroupProxyNames(group, withDead, "", "unavailable")).toEqual(["Dead"]);
    expect(sortProxyNames(group.all, withDead, "delay")).toEqual(["Bravo", "Alpha", "Dead"]);
  });

  it("sorts and summarizes the latest ping results before a server refetch", () => {
    const group = buildProxyGroups(proxies)[0];
    const latest = { Alpha: 20, Bravo: 250, Offline: 50 };

    expect(sortProxyNames(group.all, proxies, "delay", latest)).toEqual([
      "Alpha", "Offline", "Bravo",
    ]);
    expect(summarizeGroup(group, proxies, latest)).toMatchObject({
      availableNodes: 3,
      activeDelay: 250,
      bestDelay: 20,
    });
    expect(filterGroupProxyNames(group, proxies, "", "available", latest)).toEqual(group.all);
  });

  it("puts failed pings last even when the previous test was fast", () => {
    const group = buildProxyGroups(proxies)[0];
    const latest = { Bravo: -1, Offline: 0 };

    expect(sortProxyNames(group.all, proxies, "delay", latest)).toEqual([
      "Alpha", "Bravo", "Offline",
    ]);
    expect(filterGroupProxyNames(group, proxies, "", "unavailable", latest)).toEqual([
      "Bravo", "Offline",
    ]);
    expect(sortProxyNames(group.all, proxies, "default", latest)).toEqual(group.all);
  });

  it("keeps ping results through stale polls until the server history changes", () => {
    const latest = { Alpha: 20, Bravo: -1 };
    const stale = JSON.parse(JSON.stringify(proxies)) as Record<string, ProxyItem>;
    expect(reconcileDelayOverrides(latest, proxies, stale)).toEqual(latest);

    const refreshed = {
      ...stale,
      Alpha: { ...stale.Alpha, history: [{ time: "2026-05-30T00:01:00Z", delay: 30 }] },
    };
    expect(reconcileDelayOverrides(latest, proxies, refreshed)).toEqual({ Bravo: -1 });
    expect(reconcileDelayOverrides(latest, proxies, {})).toEqual({});
  });

  it("maps delay to chip colors with failed/untested as neutral", () => {
    expect(getDelayColor(-1)).toBe("default");
    expect(getDelayColor(0)).toBe("default");
    expect(getDelayColor(120)).toBe("success");
    expect(getDelayColor(500)).toBe("warning");
    expect(getDelayColor(900)).toBe("error");
  });

  it("prioritizes overview quick control groups by common home-gateway naming", () => {
    expect(getQuickControlGroups(buildProxyGroups(proxies), [], 2).map((group) => group.groupName)).toEqual([
      "GLOBAL",
      "FINAL",
    ]);
  });

  it("resolves current node control from the active clash mode", () => {
    const ruleTarget = getCurrentProxyTarget(proxies, "rule", "FINAL");
    expect(ruleTarget.groupName).toBe("FINAL");
    expect(ruleTarget.groupLocked).toBe(false);
    expect(ruleTarget.nodeName).toBe("Alpha");
    expect(ruleTarget.nodeOptions).toEqual(["Alpha", "DIRECT"]);

    const globalTarget = getCurrentProxyTarget(proxies, "global");
    expect(globalTarget.groupName).toBe("GLOBAL");
    expect(globalTarget.groupLocked).toBe(true);
    expect(globalTarget.nodeName).toBe("Bravo");
    expect(globalTarget.nodeOptions).toEqual(["Bravo", "Alpha", "Offline"]);

    const directTarget = getCurrentProxyTarget(proxies, "direct");
    expect(directTarget.groupName).toBe("DIRECT");
    expect(directTarget.nodeName).toBe("DIRECT");
    expect(directTarget.nodeOptions).toEqual(["DIRECT"]);
  });

  it("prefers rule selector groups and detects chained group selections", () => {
    const chainedProxies: Record<string, ProxyItem> = {
      ...proxies,
      "Node Selector": {
        name: "Node Selector",
        type: "Selector",
        all: ["Relay Chain", "Alpha"],
        now: "Relay Chain",
      },
      "Relay Chain": {
        name: "Relay Chain",
        type: "Relay",
        all: ["Alpha", "Bravo"],
        now: "Alpha",
      },
    };
    const groups = buildProxyGroups(chainedProxies);

    expect(getPrimaryRuleProxyGroup(groups)?.groupName).toBe("Node Selector");

    const target = getCurrentProxyTarget(chainedProxies, "rule", "Node Selector");
    expect(target.nodeName).toBe("Relay Chain");
    expect(target.isChainSelection).toBe(true);
    expect(target.chainTarget?.groupName).toBe("Relay Chain");
  });

  it("keeps pinned groups first for proxy page sorting and overview quick control", () => {
    const groups = buildProxyGroups(proxies);

    expect(sortProxyGroupsByPinned(groups, ["FINAL"]).map((group) => group.groupName)).toEqual([
      "FINAL",
      "GLOBAL",
    ]);
    expect(getQuickControlGroups(groups, ["FINAL"], 1).map((group) => group.groupName)).toEqual([
      "FINAL",
    ]);
  });

  it("toggles pinned group persistence list without reordering existing pins", () => {
    expect(togglePinnedProxyGroup(["GLOBAL"], "FINAL")).toEqual(["GLOBAL", "FINAL"]);
    expect(togglePinnedProxyGroup(["GLOBAL", "FINAL"], "GLOBAL")).toEqual(["FINAL"]);
  });

  it("filters providers by keyword and vehicle type and summarizes provider health", () => {
    expect(filterProviders(providers, "bravo", "all").map((provider) => provider.name)).toEqual([
      "Provider Bravo",
    ]);
    expect(filterProviders(providers, "", "HTTP").map((provider) => provider.name)).toEqual([
      "Provider Alpha",
    ]);
    expect(summarizeProvider(providers[0], proxies)).toEqual({
      totalNodes: 2,
      availableNodes: 1,
      bestDelay: 120,
      averageDelay: 120,
    });
  });
});
