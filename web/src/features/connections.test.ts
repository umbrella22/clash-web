import { describe, expect, it } from "vitest";
import {
  filterConnections,
  formatBytes,
  sortConnections,
  summarizeConnections,
  type Connection,
} from "./connections";

const connections: Connection[] = [
  {
    id: "1",
    metadata: {
      host: "alpha.example.com",
      destinationIP: "10.0.0.1",
      destinationPort: 443,
      sourceIP: "192.168.1.10",
      sourcePort: 50000,
      network: "tcp",
      type: "HTTPS",
    },
    chains: ["Proxy", "Node A"],
    upload: 1024,
    download: 2048,
    start: "2026-05-30T00:00:00Z",
  },
  {
    id: "2",
    metadata: {
      host: "dns.example.com",
      destinationPort: 53,
      sourceIP: "192.168.1.11",
      sourcePort: 50001,
      network: "udp",
      type: "DNS",
    },
    chains: ["DIRECT"],
    upload: 512,
    download: 1024,
    start: "2026-05-30T00:02:00Z",
  },
  {
    id: "3",
    metadata: {
      host: "beta.example.com",
      destinationPort: 443,
      sourceIP: "192.168.1.12",
      sourcePort: 50002,
      network: "tcp",
      type: "HTTPS",
    },
    chains: ["Proxy", "Node B"],
    upload: 4096,
    download: 8192,
    start: "2026-05-30T00:01:00Z",
  },
];

describe("connection helpers", () => {
  it("summarizes network, traffic and top chain metrics", () => {
    expect(summarizeConnections(connections)).toEqual({
      total: 3,
      tcp: 2,
      udp: 1,
      upload: 5632,
      download: 11264,
      topChain: "Proxy",
    });
  });

  it("filters by keyword across endpoint and chain fields plus network", () => {
    expect(filterConnections(connections, "node b", "all").map((item) => item.id)).toEqual(["3"]);
    expect(filterConnections(connections, "example", "udp").map((item) => item.id)).toEqual(["2"]);
    expect(filterConnections(connections, "10.0.0.1", "tcp").map((item) => item.id)).toEqual(["1"]);
  });

  it("sorts deterministically by traffic, time and host", () => {
    expect(sortConnections(connections, "download", "desc").map((item) => item.id)).toEqual([
      "3",
      "1",
      "2",
    ]);
    expect(sortConnections(connections, "time", "asc").map((item) => item.id)).toEqual([
      "1",
      "3",
      "2",
    ]);
    expect(sortConnections(connections, "host", "asc").map((item) => item.id)).toEqual([
      "1",
      "3",
      "2",
    ]);
  });

  it("handles mihomo connection entries with nullable fields", () => {
    const nullableConnections = [
      {
        id: "nullable",
        metadata: {
          host: "",
          destinationPort: 0,
          sourceIP: "127.0.0.1",
          sourcePort: 12345,
          network: "tcp",
          type: "",
        },
        chains: null,
        upload: 0,
        download: 0,
        start: "2026-05-30T00:03:00Z",
      },
    ] as unknown as Connection[];

    expect(summarizeConnections(nullableConnections)).toEqual({
      total: 1,
      tcp: 1,
      udp: 0,
      upload: 0,
      download: 0,
      topChain: null,
    });
    expect(filterConnections(nullableConnections, "127.0.0.1", "all").map((item) => item.id)).toEqual([
      "nullable",
    ]);
    expect(sortConnections(nullableConnections, "host", "asc").map((item) => item.id)).toEqual([
      "nullable",
    ]);
  });

  it("formats byte counters for summary chips", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(2 * 1024 * 1024)).toBe("2 MB");
  });
});
