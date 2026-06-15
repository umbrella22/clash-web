import { describe, expect, it } from "vitest";
import {
  filterRules,
  getRuleTypes,
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
});
