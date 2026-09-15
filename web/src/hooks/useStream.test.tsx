// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTraffic } from "./useStream";

const { createTrafficWs } = vi.hoisted(() => ({ createTrafficWs: vi.fn() }));
vi.mock("../services/api", () => ({ createTrafficWs, createMemoryWs: vi.fn() }));

class FakeSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  readyState = FakeSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn(() => {
    this.readyState = 3;
    this.onclose?.();
  });
  open() {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }
  message(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
}

describe("traffic stream recovery", () => {
  let root: Root;
  let container: HTMLDivElement;
  let sockets: FakeSocket[];
  let state: ReturnType<typeof useTraffic>;

  function Probe({ enabled = true }: { enabled?: boolean }) {
    state = useTraffic(enabled);
    return null;
  }

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("WebSocket", FakeSocket);
    vi.spyOn(Math, "random").mockReturnValue(0);
    sockets = [];
    createTrafficWs.mockImplementation(() => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    });
    container = document.createElement("div");
    root = createRoot(container);
    await act(() => root.render(<Probe />));
  });

  afterEach(async () => {
    await act(() => root.unmount());
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("only reports live traffic after the first sample arrives", async () => {
    await act(() => sockets[0].open());
    expect(state.status).toBe("connecting");
    await act(() => sockets[0].message({ up: 1024, down: 2048 }));
    expect(state.status).toBe("open");
    expect(state.traffic).toEqual({ up: 1024, down: 2048 });
  });

  it("reconnects a stalled open socket and clears the obsolete speed", async () => {
    const lateMessage = sockets[0].onmessage;
    await act(() => {
      sockets[0].open();
      sockets[0].message({ up: 100, down: 200 });
    });
    await act(() => vi.advanceTimersByTime(10000));
    expect(sockets[0].close).toHaveBeenCalled();
    expect(state.status).toBe("reconnecting");
    expect(state.traffic).toEqual({ up: 0, down: 0 });
    await act(() => vi.advanceTimersByTime(3000));
    expect(sockets).toHaveLength(2);
    await act(() => {
      sockets[1].open();
      sockets[1].message({ up: 400, down: 800 });
    });
    expect(state.status).toBe("open");
    expect(state.traffic).toEqual({ up: 400, down: 800 });
    await act(() => lateMessage?.({ data: JSON.stringify({ up: 1, down: 1 }) }));
    expect(state.traffic).toEqual({ up: 400, down: 800 });
  });

  it("retries after the core is offline without leaving retries after unmount", async () => {
    await act(() => sockets[0].close());
    expect(state.status).toBe("reconnecting");
    await act(() => vi.advanceTimersByTime(3000));
    await act(() => {
      sockets[1].open();
      sockets[1].message({ up: 500, down: 1000 });
    });
    expect(state.status).toBe("open");
    await act(() => root.unmount());
    await act(() => vi.advanceTimersByTime(60000));
    expect(sockets).toHaveLength(2);
  });

  it("keeps a stream alive while one-second samples continue", async () => {
    await act(() => sockets[0].open());
    for (let i = 0; i < 65; i += 1) {
      await act(() => {
        vi.advanceTimersByTime(1000);
        sockets[0].message({ up: i, down: i * 2 });
      });
    }
    expect(sockets).toHaveLength(1);
    expect(state.history).toHaveLength(60);
    expect(state.traffic).toEqual({ up: 64, down: 128 });
  });

  it("connects immediately when the core becomes ready and stops when it goes offline", async () => {
    await act(() => root.render(<Probe enabled={false} />));
    expect(state.status).toBe("closed");
    await act(() => vi.advanceTimersByTime(60000));
    expect(sockets).toHaveLength(1);
    await act(() => root.render(<Probe enabled />));
    expect(sockets).toHaveLength(2);
    await act(() => {
      sockets[1].open();
      sockets[1].message({ up: 400, down: 800 });
    });
    expect(state.status).toBe("open");
    await act(() => root.render(<Probe enabled={false} />));
    expect(state.traffic).toEqual({ up: 0, down: 0 });
    expect(sockets[1].close).toHaveBeenCalled();
  });
});
