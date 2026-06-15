import { describe, expect, it } from "vitest";
import {
  buildProxyGroups,
  filterGroupProxyNames,
  filterProviders,
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

  it("prioritizes overview quick control groups by common home-gateway naming", () => {
    expect(getQuickControlGroups(buildProxyGroups(proxies), [], 2).map((group) => group.groupName)).toEqual([
      "GLOBAL",
      "FINAL",
    ]);
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
