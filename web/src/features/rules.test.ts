import { describe, expect, it } from "vitest";
import {
  filterRules,
  formatRuleSize,
  getRuleTypes,
  indexRules,
  sortRules,
  summarizeRules,
  type RuleItem,
} from "./rules";

const rules: RuleItem[] = [
  { type: "DOMAIN-SUFFIX", payload: "example.com", proxy: "Proxy", size: 20 },
  { type: "GEOIP", payload: "CN", proxy: "DIRECT", size: 10 },
  { type: "DOMAIN-SUFFIX", payload: "ads.example.com", proxy: "REJECT", size: 30 },
  { type: "MATCH", payload: "", proxy: "Proxy", size: 0 },
];

describe("rule helpers", () => {
  it("summarizes routing targets and the most common rule type", () => {
    expect(summarizeRules(rules)).toEqual({
      total: 4,
      direct: 1,
      reject: 1,
      proxyGroups: 2,
      topType: "DOMAIN-SUFFIX",
    });
  });

  it("builds stable rule type filters", () => {
    expect(getRuleTypes(rules)).toEqual(["DOMAIN-SUFFIX", "GEOIP", "MATCH"]);
  });

  it("filters rules by type and keyword", () => {
    expect(filterRules(rules, "example", "DOMAIN-SUFFIX")).toEqual([
      rules[0],
      rules[2],
    ]);
    expect(filterRules(rules, "direct", "all")).toEqual([rules[1]]);
  });

  it("sorts rules by size and text fields", () => {
    expect(sortRules(rules, "size", "desc").map((rule) => rule.payload)).toEqual([
      "ads.example.com",
      "example.com",
      "CN",
      "",
    ]);
    expect(sortRules(rules, "proxy", "asc").map((rule) => rule.proxy)).toEqual([
      "DIRECT",
      "Proxy",
      "Proxy",
      "REJECT",
    ]);
  });

  it("keeps the original API order for the priority sort mode", () => {
    expect(sortRules(rules, "order", "asc")).toEqual(rules);
    expect(sortRules(rules, "order", "desc")).toEqual(rules);
    expect(sortRules(rules, "order", "asc")).not.toBe(rules);
  });

  it("assigns 1-based priority indexes that survive filtering", () => {
    const indexed = indexRules(rules);
    expect(indexed.map((rule) => rule.index)).toEqual([1, 2, 3, 4]);

    const filtered = filterRules(indexed, "example", "DOMAIN-SUFFIX");
    expect(filtered.map((rule) => rule.index)).toEqual([1, 3]);

    const sorted = sortRules(filtered, "size", "desc");
    expect(sorted.map((rule) => rule.index)).toEqual([3, 1]);
  });

  it("formats rule sizes with an em dash for missing or sentinel values", () => {
    expect(formatRuleSize(20)).toBe("20");
    expect(formatRuleSize(0)).toBe("0");
    expect(formatRuleSize(-1)).toBe("—");
    expect(formatRuleSize(undefined)).toBe("—");
  });
});
