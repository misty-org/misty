import { execFile } from "node:child_process";

export type ProcessTable = Map<number, number>;

export function processTable(): Promise<ProcessTable> {
  return new Promise((done, fail) =>
    execFile("ps", ["-A", "-o", "pid=,ppid="], (error, stdout) => {
      if (error) return fail(error);
      const table: ProcessTable = new Map();
      for (const line of stdout.split("\n")) {
        const [pid, ppid] = line.trim().split(/\s+/).map(Number);
        if (Number.isInteger(pid) && Number.isInteger(ppid)) table.set(pid, ppid);
      }
      done(table);
    }),
  );
}

export function ancestry(table: ProcessTable, pid: number): Array<[number, number]> {
  const chain: Array<[number, number]> = [];
  const seen = new Set<number>();
  let current = pid;
  while (!seen.has(current)) {
    seen.add(current);
    const parent = table.get(current);
    if (parent === undefined) break;
    chain.push([current, parent]);
    if (parent <= 1) break;
    current = parent;
  }
  return chain;
}

export function descendants(table: ProcessTable, pid: number): number[] {
  const found: number[] = [];
  const queue = [pid];
  while (queue.length) {
    const parent = queue.shift()!;
    for (const [child, of] of table) {
      if (of === parent && !found.includes(child)) {
        found.push(child);
        queue.push(child);
      }
    }
  }
  return found;
}

export async function stopDescendants(graceMs = 5_000) {
  const signal = (pids: number[], name: NodeJS.Signals) => {
    for (const pid of pids) {
      try {
        process.kill(pid, name);
      } catch {
      }
    }
  };
  const under = descendants(await processTable(), process.pid);
  signal(under, "SIGTERM");
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    const table = await processTable();
    if (!under.some((pid) => table.has(pid))) return;
    await new Promise((wait) => setTimeout(wait, 200));
  }
  signal(under, "SIGKILL");
}

export const isStranded = (chain: Array<[number, number]>, table: ProcessTable) =>
  chain.some(([pid, parent]) => table.get(pid) !== parent);

export function whenStranded(stop: () => void, intervalMs = 2_000) {
  if (process.platform === "win32") return;
  void processTable()
    .then((start) => {
      const chain = ancestry(start, process.pid);
      const timer = setInterval(() => {
        processTable()
          .then((table) => {
            if (!isStranded(chain, table)) return;
            clearInterval(timer);
            stop();
          })
          .catch(() => {});
      }, intervalMs);
      timer.unref();
    })
    .catch(() => {});
}
