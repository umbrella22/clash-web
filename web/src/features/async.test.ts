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

  it("reports every settled result through onSettled, including rejections", async () => {
    const seen: { index: number; status: string }[] = [];

    const results = await runWithConcurrency(
      [1, 2, 3],
      2,
      async (item) => {
        if (item === 2) throw new Error("boom");
        return item;
      },
      (index, result) => seen.push({ index, status: result.status })
    );

    expect(seen).toHaveLength(3);
    expect(new Set(seen.map((entry) => entry.index))).toEqual(new Set([0, 1, 2]));
    expect(seen.find((entry) => entry.index === 1)?.status).toBe("rejected");
    expect(results.map((result) => result.status)).toEqual([
      "fulfilled",
      "rejected",
      "fulfilled",
    ]);
  });

  it("invokes onSettled as each item finishes, not after the whole batch", async () => {
    const resolvers: (() => void)[] = [];
    const settledIndexes: number[] = [];

    const batch = runWithConcurrency(
      [0, 1],
      1,
      (item) =>
        new Promise<number>((resolve) => {
          resolvers.push(() => resolve(item));
        }),
      (index) => settledIndexes.push(index)
    );

    resolvers[0]();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settledIndexes).toEqual([0]);

    resolvers[1]();
    await batch;
    expect(settledIndexes).toEqual([0, 1]);
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
