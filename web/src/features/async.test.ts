import { describe, expect, it } from "vitest";
import { runWithConcurrency } from "./async";

describe("async helpers", () => {
  it("limits active workers and preserves result order", async () => {
    let active = 0;
    let maxActive = 0;

    const results = await runWithConcurrency([1, 2, 3, 4, 5], 2, async (item) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active -= 1;
      return item * 2;
    });

    expect(maxActive).toBeLessThanOrEqual(2);
    expect(results).toEqual([
      { status: "fulfilled", value: 2 },
      { status: "fulfilled", value: 4 },
      { status: "fulfilled", value: 6 },
      { status: "fulfilled", value: 8 },
      { status: "fulfilled", value: 10 },
    ]);
  });

  it("keeps rejected worker results without stopping remaining tasks", async () => {
    const results = await runWithConcurrency(["ok", "bad", "next"], 4, async (item) => {
      if (item === "bad") throw new Error("failed");
      return item;
    });

    expect(results[0]).toEqual({ status: "fulfilled", value: "ok" });
    expect(results[1].status).toBe("rejected");
    expect(results[2]).toEqual({ status: "fulfilled", value: "next" });
  });
});
