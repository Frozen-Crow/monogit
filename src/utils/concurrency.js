// Run `fn` over `items` with a bounded number of workers in flight.
// Returns results in input order, each shaped like Promise.allSettled entries.
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const size = Math.max(1, Math.min(limit || 1, items.length));

  const worker = async () => {
    while (true) {
      const idx = next++;
      if (idx >= items.length) break;
      try {
        results[idx] = { status: 'fulfilled', value: await fn(items[idx], idx) };
      } catch (reason) {
        results[idx] = { status: 'rejected', reason };
      }
    }
  };

  await Promise.all(Array.from({ length: size }, worker));
  return results;
}
