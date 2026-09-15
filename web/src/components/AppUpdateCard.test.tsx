// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AppUpdateCard from "./AppUpdateCard";
import type { AppUpdateStatus } from "../services/api";

const api = vi.hoisted(() => ({
  getAppUpdateStatus: vi.fn(), checkAppUpdate: vi.fn(),
  saveAppUpdateSettings: vi.fn(), installAppUpdate: vi.fn(), getPrecheckResult: vi.fn(),
}));
vi.mock("../services/api", () => api);
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const initial: AppUpdateStatus = {
  current_version: "0.3.0", repository_url: "https://github.com/umbrella22/clash-web",
  installation_supported: true, settings: { check_interval_hours: 24, auto_update: false },
  checking: false, last_checked_at: null, next_check_at: 123,
  latest: null, update_available: false, package_ready: false, check_error: null,
  installation: { phase: "idle", updated_at: 0, version: null, error: null },
};

describe("application update settings", () => {
  let root: Root;
  let container: HTMLDivElement;
  let client: QueryClient;

  beforeEach(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.resetAllMocks();
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    api.getAppUpdateStatus.mockResolvedValue({ data: initial });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    client.clear();
    container.remove();
    vi.unstubAllGlobals();
  });

  async function render(status = initial) {
    api.getAppUpdateStatus.mockResolvedValue({ data: status });
    client.setQueryData(["appUpdate"], status);
    await act(async () => root.render(<QueryClientProvider client={client}><AppUpdateCard /></QueryClientProvider>));
  }

  function button(label: string) {
    const element = [...container.querySelectorAll("button")].find((button) => button.textContent === label);
    if (!element) throw new Error(`Missing button ${label}`);
    return element;
  }

  async function settle() {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  }

  async function changeInterval(value: string) {
    const input = container.querySelector<HTMLInputElement>('input[type="number"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("checks for a release and starts one installation while showing its progress", async () => {
    const available = { ...initial, latest: { version: "0.4.0", tag: "v0.4.0", url: "https://github.com/umbrella22/clash-web/releases/tag/v0.4.0", notes: "New release" }, update_available: true, package_ready: true };
    api.checkAppUpdate.mockResolvedValue({ data: available });
    api.installAppUpdate.mockResolvedValue({ data: { ...available, installation: { ...initial.installation, phase: "queued", version: "0.4.0" } } });
    await render();
    expect(button("app_updates.install").disabled).toBe(true);
    await act(async () => button("settings.check_update").click());
    await settle();
    expect(button("app_updates.install").disabled).toBe(false);
    await act(async () => button("app_updates.install").click());
    await settle();
    expect(api.installAppUpdate).toHaveBeenCalledTimes(1);
    expect(button("app_updates.install").disabled).toBe(true);
    expect(container.textContent).toContain("app_updates.phase_queued");
  });

  it("saves the interval with automatic installation and disables it in manual mode", async () => {
    api.saveAppUpdateSettings.mockImplementation((settings) => Promise.resolve({ data: { ...initial, settings } }));
    await render();
    await changeInterval("6");
    await act(async () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    await act(async () => button("settings.save").click());
    await settle();
    expect(api.saveAppUpdateSettings.mock.calls[0][0]).toEqual({ check_interval_hours: 6, auto_update: true });
    await changeInterval("0");
    expect(container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false);
    await act(async () => button("settings.save").click());
    await settle();
    expect(api.saveAppUpdateSettings.mock.calls[1][0]).toEqual({ check_interval_hours: 0, auto_update: false });
  });

  it("prevents invalid intervals and hides install capability for unsupported deployments", async () => {
    await render({ ...initial, installation_supported: false });
    expect(container.textContent).toContain("app_updates.unsupported");
    expect(container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.disabled).toBe(true);
    await changeInterval("721");
    expect(button("settings.save").disabled).toBe(true);
    await changeInterval("1.5");
    expect(button("settings.save").disabled).toBe(true);
    expect(button("app_updates.install").disabled).toBe(true);
  });
});
