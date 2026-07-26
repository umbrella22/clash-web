export interface Connection {
  id: string;
  metadata: {
    host: string;
    destinationIP?: string;
    destinationPort: number;
    sourceIP: string;
    sourcePort: number;
    network: string;
    type: string;
  };
  chains: string[];
  upload: number;
  download: number;
  start: string;
}

export interface ConnectionsData {
  connections: Connection[];
}

export interface ConnectionsSummary {
  total: number;
  tcp: number;
  udp: number;
  upload: number;
  download: number;
  topChain: string | null;
}

export type ConnectionNetworkFilter = "all" | "tcp" | "udp";
/** "time" sorts by connection duration (now - start); "start" sorts by the raw start timestamp. */
export type ConnectionSortKey = "time" | "start" | "download" | "upload" | "host";
export type SortDirection = "asc" | "desc";

function normalizeKeyword(value: string): string {
  return value.trim().toLowerCase();
}

function includesKeyword(value: string | undefined, keyword: string): boolean {
  if (!keyword) return true;
  return (value ?? "").toLowerCase().includes(keyword);
}

export function summarizeConnections(connections: Connection[]): ConnectionsSummary {
  const chainCounts = new Map<string, number>();

  const summary = connections.reduce<ConnectionsSummary>(
    (result, connection) => {
      const network = connection.metadata?.network?.toLowerCase() ?? "";
      // mihomo lists chains exit-node first, so chains[0] is the exit node the
      // connection actually leaves through — that is what topChain counts.
      const exitNode = connection.chains?.[0];

      if (network === "tcp") result.tcp += 1;
      if (network === "udp") result.udp += 1;
      if (exitNode) chainCounts.set(exitNode, (chainCounts.get(exitNode) ?? 0) + 1);

      result.upload += connection.upload;
      result.download += connection.download;
      return result;
    },
    {
      total: connections.length,
      tcp: 0,
      udp: 0,
      upload: 0,
      download: 0,
      topChain: null,
    }
  );

  summary.topChain = [...chainCounts.entries()].sort((left, right) => {
    if (right[1] !== left[1]) return right[1] - left[1];
    return left[0].localeCompare(right[0]);
  })[0]?.[0] ?? null;

  return summary;
}

export function filterConnections(
  connections: Connection[],
  search: string,
  networkFilter: ConnectionNetworkFilter
): Connection[] {
  const keyword = normalizeKeyword(search);

  return connections.filter((connection) => {
    const network = connection.metadata?.network?.toLowerCase() ?? "";
    const networkMatched = networkFilter === "all" || network === networkFilter;
    if (!networkMatched) return false;
    if (!keyword) return true;

    return (
      includesKeyword(connection.metadata?.host, keyword) ||
      includesKeyword(connection.metadata?.destinationIP, keyword) ||
      includesKeyword(connection.metadata?.sourceIP, keyword) ||
      includesKeyword(connection.metadata?.type, keyword) ||
      (connection.chains ?? []).some((chain) => includesKeyword(chain, keyword))
    );
  });
}

export function sortConnections(
  connections: Connection[],
  sortKey: ConnectionSortKey,
  direction: SortDirection
): Connection[] {
  const multiplier = direction === "asc" ? 1 : -1;
  const now = Date.now();

  const numericValue = (connection: Connection): number => {
    // "time" is labeled Duration: descending must put the longest-lived connection first.
    if (sortKey === "time") return now - new Date(connection.start).getTime();
    if (sortKey === "start") return new Date(connection.start).getTime();
    return connection[sortKey as "download" | "upload"] ?? 0;
  };

  return [...connections].sort((left, right) => {
    const leftHost = left.metadata?.host ?? "";
    const rightHost = right.metadata?.host ?? "";

    if (sortKey === "host") {
      return multiplier * leftHost.localeCompare(rightHost);
    }

    const leftValue = numericValue(left);
    const rightValue = numericValue(right);

    if (leftValue === rightValue) return leftHost.localeCompare(rightHost);
    return multiplier * (leftValue - rightValue);
  });
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${parseFloat((bytes / 1024 ** index).toFixed(1))} ${units[index]}`;
}
