// Run an async task per item, respecting a dependency graph: an item starts only
// after all its (in-set) dependencies complete successfully. Independent items run
// in parallel (up to `concurrency`). If a dependency fails or is skipped, its
// dependents are skipped. Pure orchestration — the task does the I/O.

export function findCycle(deps) {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map([...deps.keys()].map((n) => [n, WHITE]));
  const stack = [];
  let cycle = null;

  function dfs(n) {
    color.set(n, GRAY);
    stack.push(n);
    for (const d of deps.get(n) || []) {
      if (color.get(d) === GRAY) {
        cycle = [...stack.slice(stack.indexOf(d)), d];
        return true;
      }
      if (color.get(d) === WHITE && dfs(d)) return true;
    }
    color.set(n, BLACK);
    stack.pop();
    return false;
  }

  for (const n of deps.keys()) {
    if (color.get(n) === WHITE && dfs(n)) break;
  }
  return cycle;
}

// items: array of nodes. getName(node) -> string. getDeps(node) -> string[] (names).
// task(node) -> Promise (throw to fail). Returns Map name -> { status, value?, error?, reason? }.
export async function runDependencyGraph(items, getName, getDeps, task, { concurrency = 8 } = {}) {
  const byName = new Map(items.map((i) => [getName(i), i]));
  const names = new Set(byName.keys());

  // normalize deps to only those in the current set (a dep not being processed isn't waited for)
  const deps = new Map();
  for (const i of items) deps.set(getName(i), (getDeps(i) || []).filter((d) => names.has(d)));

  const cycle = findCycle(deps);
  if (cycle) throw new Error(`Dependency cycle detected: ${cycle.join(' → ')}`);

  const results = new Map();
  const remaining = new Map();
  const dependents = new Map();
  for (const [n, ds] of deps) {
    remaining.set(n, ds.length);
    for (const d of ds) {
      if (!dependents.has(d)) dependents.set(d, []);
      dependents.get(d).push(n);
    }
  }

  const queue = [...deps.keys()].filter((n) => remaining.get(n) === 0);
  let active = 0;
  let resolveAll;
  const done = new Promise((r) => (resolveAll = r));

  function skip(name, reason) {
    if (results.has(name)) return;
    results.set(name, { status: 'skipped', reason });
    for (const dep of dependents.get(name) || []) skip(dep, `dependency "${name}" ${reason}`);
  }

  function settleDependents(name) {
    for (const dep of dependents.get(name) || []) {
      if (results.has(dep)) continue;
      remaining.set(dep, remaining.get(dep) - 1);
      if (remaining.get(dep) === 0) queue.push(dep);
    }
  }

  function maybeFinish() {
    if (results.size === deps.size && active === 0) resolveAll();
  }

  function pump() {
    while (active < concurrency && queue.length) {
      const name = queue.shift();
      if (results.has(name)) continue; // was skipped
      active += 1;
      Promise.resolve()
        .then(() => task(byName.get(name)))
        .then((value) => results.set(name, { status: 'ok', value }))
        .catch((error) => {
          results.set(name, { status: 'fail', error });
          for (const dep of dependents.get(name) || []) skip(dep, 'failed');
        })
        .finally(() => {
          active -= 1;
          settleDependents(name);
          pump();
          maybeFinish();
        });
    }
    maybeFinish();
  }

  pump();
  await done;
  return results;
}
