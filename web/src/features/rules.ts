export interface RuleItem {
  type: string;
  payload: string;
  proxy: string;
  size?: number;
}

export interface RulesResponse {
  rules: RuleItem[];
}

export interface IndexedRuleItem extends RuleItem {
  /** 1-based position in the original API order (clash match priority). */
  index: number;
}

export interface RulesSummary {
  total: number;
  direct: number;
  reject: number;
  proxyGroups: number;
  topType: string | null;
}

export type RuleTypeFilter = string;
export type RuleSortKey = "order" | "type" | "payload" | "proxy" | "size";
export type SortDirection = "asc" | "desc";

export function indexRules(rules: RuleItem[]): IndexedRuleItem[] {
  return rules.map((rule, position) => ({ ...rule, index: position + 1 }));
}

export function formatRuleSize(size: number | undefined): string {
  if (size === undefined || size < 0) return "—";
  return String(size);
}

function normalizeKeyword(value: string): string {
  return value.trim().toLowerCase();
}

function includesKeyword(value: string | undefined, keyword: string): boolean {
  if (!keyword) return true;
  return (value ?? "").toLowerCase().includes(keyword);
}

export function getRuleTypes(rules: RuleItem[]): string[] {
  return Array.from(new Set(rules.map((rule) => rule.type))).sort((left, right) =>
    left.localeCompare(right)
  );
}

export function summarizeRules(rules: RuleItem[]): RulesSummary {
  const typeCounts = new Map<string, number>();

  const summary = rules.reduce<RulesSummary>(
    (result, rule) => {
      const proxy = rule.proxy.toLowerCase();
      typeCounts.set(rule.type, (typeCounts.get(rule.type) ?? 0) + 1);

      if (proxy === "direct") result.direct += 1;
      else if (proxy === "reject") result.reject += 1;
      else result.proxyGroups += 1;

      return result;
    },
    {
      total: rules.length,
      direct: 0,
      reject: 0,
      proxyGroups: 0,
      topType: null,
    }
  );

  summary.topType = [...typeCounts.entries()].sort((left, right) => {
    if (right[1] !== left[1]) return right[1] - left[1];
    return left[0].localeCompare(right[0]);
  })[0]?.[0] ?? null;

  return summary;
}

export function filterRules<T extends RuleItem>(
  rules: T[],
  search: string,
  typeFilter: RuleTypeFilter
): T[] {
  const keyword = normalizeKeyword(search);

  return rules.filter((rule) => {
    const typeMatched = typeFilter === "all" || rule.type === typeFilter;
    if (!typeMatched) return false;
    if (!keyword) return true;

    return (
      includesKeyword(rule.type, keyword) ||
      includesKeyword(rule.payload, keyword) ||
      includesKeyword(rule.proxy, keyword)
    );
  });
}

export function sortRules<T extends RuleItem>(
  rules: T[],
  sortKey: RuleSortKey,
  direction: SortDirection
): T[] {
  // "order" keeps the original API order — clash matches rules by priority,
  // so this is the identity sort regardless of direction.
  if (sortKey === "order") return [...rules];

  const multiplier = direction === "asc" ? 1 : -1;

  return [...rules].sort((left, right) => {
    if (sortKey === "size") {
      const leftValue = left.size ?? 0;
      const rightValue = right.size ?? 0;
      if (leftValue === rightValue) return left.payload.localeCompare(right.payload);
      return multiplier * (leftValue - rightValue);
    }

    const compared = left[sortKey].localeCompare(right[sortKey]);
    if (compared === 0) return left.payload.localeCompare(right.payload);
    return multiplier * compared;
  });
}
