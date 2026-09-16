// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OverviewPage from "./OverviewPage";
import { proxyQueryKey } from "../hooks/useProxies";
import type { ProxiesResponse } from "../features/proxies";

const mocks = vi.hoisted(() => ({
  mode: "rule",
  mihomoApi: { get: vi.fn(), put: vi.fn() },
  pingGoogleWithProxy: vi.fn(),
  getMihomoInstallStatus: vi.fn(),
}));
vi.mock("../services/api", () => ({
  ...mocks,
  installMihomo: vi.fn(),
  getPrecheckResult: () => null,
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("../hooks/useApi", () => ({
  useStatus: () => ({ data: { mihomo_running: true, server: { host: "localhost", port: 9097 } } }),
  useMode: () => ({ data: { mode: mocks.mode } }),
  useSetMode: () => ({}),
  useStartMihomo: () => ({}),
  useStopMihomo: () => ({}),
  useRestartMihomo: () => ({}),
  usePreferences: () => ({}),
}));
vi.mock("../contexts/MihomoDownloadTaskContext", () => ({ useMihomoDownloadTaskContext: () => ({}) }));
vi.mock("../components/overview/TrafficCard", () => ({ default: () => null }));
vi.mock("../components/overview/MemoryCard", () => ({ default: () => null }));

function proxyData(): ProxiesResponse {
  return {
    proxies: {
      GLOBAL: {
        name: "GLOBAL", type: "Selector",
        all: ["Slow", "Offline", "Fast", "Untested"], now: "Slow",
      },
      PROXY: {
        name: "PROXY", type: "Selector",
        all: ["Slow", "Offline", "Fast", "Untested"], now: "Slow",
      },
      Slow: {
        name: "Slow", type: "Trojan",
        history: [{ time: "2026-09-16T00:00:00Z", delay: 300 }],
      },
      Fast: {
        name: "Fast", type: "Trojan",
        history: [{ time: "2026-09-16T00:00:00Z", delay: 50 }],
      },
      Offline: {
        name: "Offline", type: "Trojan",
        history: [{ time: "2026-09-16T00:00:00Z", delay: 0 }],
      },
      Untested: { name: "Untested", type: "Trojan" },
    },
  };
}

describe("overview node latency ordering", () => {
  let root: Root;
  let container: HTMLDivElement;
  let client: QueryClient;
  let serverData: ProxiesResponse;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.resetAllMocks();
    localStorage.clear();
    mocks.mode = "rule";
    serverData = proxyData();
    mocks.mihomoApi.get.mockImplementation(() =>
      Promise.resolve({ data: structuredClone(serverData) })
    );
    mocks.getMihomoInstallStatus.mockResolvedValue({ data: { installed: true } });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue(new DOMRect(0, 0, 300, 40));
    client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    client.setQueryData(proxyQueryKey, structuredClone(serverData));
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    client.clear();
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function render() {
    await act(async () => {
      root.render(<QueryClientProvider client={client}><OverviewPage /></QueryClientProvider>);
    });
    await settle();
  }

  async function settle() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }

  function nodeSelect() {
    // The quick-control card presents the group followed by its selected node.
    return container.querySelectorAll<HTMLElement>('[role="combobox"]')[1];
  }

  async function openNodes() {
    await act(async () => {
      nodeSelect().dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    });
  }

  function nodeOrder() {
    return [...document.querySelectorAll('[role="option"]')]
      .map((option) => option.getAttribute("data-value"));
  }

  async function closeNodes() {
    await act(async () => {
      document.querySelector('[role="listbox"]')!
        .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
  }

  it.each(["rule", "global"])(
    "sorts the %s dropdown by measured latency and keeps the selected node",
    async (mode) => {
      mocks.mode = mode;
      await render();
      await openNodes();
      expect(nodeOrder()).toEqual(["Fast", "Slow", "Offline", "Untested"]);
      const selected = document.querySelector('[role="option"][aria-selected="true"]');
      expect(selected?.getAttribute("data-value")).toBe("Slow");
      expect(mocks.mihomoApi.put).not.toHaveBeenCalled();
    }
  );

  it("reorders immediately after Ping Google and keeps the result through stale polls", async () => {
    mocks.pingGoogleWithProxy.mockResolvedValue({ data: { delay: 20 } });
    await render();
    const ping = [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "proxies.google_ping")!;
    await act(async () => ping.click());
    await settle();
    expect(mocks.pingGoogleWithProxy).toHaveBeenCalledWith("Slow");
    expect(nodeSelect().textContent).toContain("20ms");
    await openNodes();
    expect(nodeOrder()).toEqual(["Slow", "Fast", "Offline", "Untested"]);

    await act(async () => {
      await client.refetchQueries({ queryKey: proxyQueryKey });
    });
    await settle();
    expect(nodeOrder()).toEqual(["Slow", "Fast", "Offline", "Untested"]);
    expect(document.querySelector('[data-value="Slow"]')?.textContent).toContain("20ms");

    serverData.proxies.Slow.history = [{ time: "2026-09-16T00:01:00Z", delay: 200 }];
    await act(async () => {
      await client.refetchQueries({ queryKey: proxyQueryKey });
    });
    await settle();
    expect(nodeOrder()).toEqual(["Fast", "Slow", "Offline", "Untested"]);
    expect(document.querySelector('[data-value="Slow"]')?.textContent).toContain("200ms");
    expect(mocks.mihomoApi.put).not.toHaveBeenCalled();
  });

  it("moves a failed ping behind available nodes", async () => {
    mocks.pingGoogleWithProxy.mockRejectedValue(new Error("Timeout"));
    await render();
    const ping = [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "proxies.google_ping")!;
    await act(async () => ping.click());
    await settle();
    await openNodes();
    expect(nodeOrder()).toEqual(["Fast", "Offline", "Slow", "Untested"]);
    expect(document.querySelector('[data-value="Slow"]')?.textContent).toContain("proxies.unavailable");
  });

  it("sorts the result of the current-node speed button as well", async () => {
    mocks.pingGoogleWithProxy.mockResolvedValue({ data: { delay: 25 } });
    await render();
    const speedButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="overview.current_proxy_test"]'
    )!;
    await act(async () => speedButton.click());
    await settle();
    expect(mocks.pingGoogleWithProxy).toHaveBeenCalledWith("Slow");
    await openNodes();
    expect(nodeOrder()).toEqual(["Slow", "Fast", "Offline", "Untested"]);
    expect(document.querySelector('[data-value="Slow"]')?.textContent).toContain("25ms");
    await closeNodes();
    expect(nodeSelect().textContent).toContain("25ms");
  });
});
