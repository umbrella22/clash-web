export async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
  onSettled?: (index: number, result: PromiseSettledResult<R>) => void
): Promise<PromiseSettledResult<R>[]> {
  if (items.length === 0) return [];

  const normalizedLimit = Math.max(1, Math.min(Math.floor(limit), items.length));
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let nextIndex = 0;

  async function runNext(): Promise<void> {
    const currentIndex = nextIndex;
    nextIndex += 1;
    if (currentIndex >= items.length) return;

    try {
      results[currentIndex] = {
        status: "fulfilled",
        value: await worker(items[currentIndex], currentIndex),
      };
    } catch (reason) {
      results[currentIndex] = {
        status: "rejected",
        reason,
      };
    }

    // Stream each result to the caller as soon as it settles so UIs can
    // update live instead of waiting for the whole batch.
    onSettled?.(currentIndex, results[currentIndex]);

    await runNext();
  }

  await Promise.all(Array.from({ length: normalizedLimit }, () => runNext()));
  return results;
}
