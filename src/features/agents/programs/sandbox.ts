import {
  newQuickJSWASMModuleFromVariant,
  newVariant,
  shouldInterruptAfterDeadline,
  type QuickJSContext,
  type QuickJSHandle,
  type QuickJSWASMModule,
} from "quickjs-emscripten-core";
import releaseVariant from "@jitl/quickjs-wasmfile-release-sync";
import wasmLocation from "@jitl/quickjs-wasmfile-release-sync/wasm?url";

/**
 * A browser_run program's sandbox (docs/plans/agent-harness-v3.md, change 1): QuickJS compiled to
 * WebAssembly, a separate JavaScript engine that sees nothing of the app, the network or files.
 * Its only ways out are `__op(name, json)`, which the host answers with a promise of JSON, and
 * `__log(text)`. A program that spins is interrupted at its deadline.
 */

let engine: Promise<QuickJSWASMModule> | undefined;
let wasm = wasmLocation;
const quickjs = () => (engine ??= newQuickJSWASMModuleFromVariant(newVariant(releaseVariant, { wasmLocation: wasm })));

/** Tests run outside the app, where the bundler's URL for the engine is not a file: they name the file. */
export function useSandboxWasm(location: string) {
  wasm = location;
  engine = undefined;
}

export interface SandboxLimits {
  /** When the whole program must have finished. */
  deadline: number;
  memoryBytes?: number;
}

export interface SandboxResult {
  ok: boolean;
  /** The program's return value, as JSON. */
  value?: unknown;
  error?: string;
  logs: string[];
}

/** Host calls: a name and its arguments, answered with JSON-able data or an error. */
export type Host = (name: string, args: Record<string, unknown>) => Promise<unknown>;

const MAX_LOGS = 200;

export async function runInSandbox(prelude: string, code: string, host: Host, limits: SandboxLimits): Promise<SandboxResult> {
  const module = await quickjs();
  const runtime = module.newRuntime();
  runtime.setMemoryLimit(limits.memoryBytes ?? 64 * 1024 * 1024);
  runtime.setMaxStackSize(1024 * 1024);
  runtime.setInterruptHandler(shouldInterruptAfterDeadline(limits.deadline));
  const vm = runtime.newContext();
  const logs: string[] = [];
  let pending = 0;
  let finished = false;
  const release = () => {
    if (!vm.alive) return;
    vm.dispose();
    runtime.dispose();
  };
  try {
    const log = vm.newFunction("__log", (text) => {
      if (logs.length < MAX_LOGS) logs.push(vm.getString(text).slice(0, 2_000));
      return vm.undefined;
    });
    vm.setProp(vm.global, "__log", log);
    log.dispose();
    const op = vm.newFunction("__op", (nameHandle, argsHandle) => {
      const name = vm.getString(nameHandle);
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(vm.getString(argsHandle)) as Record<string, unknown>;
      } catch {
        args = {};
      }
      const deferred = vm.newPromise();
      pending++;
      host(name, args).then(
        (value) => {
          if (!vm.alive) return;
          const text = vm.newString(JSON.stringify(value ?? null));
          deferred.resolve(text);
          text.dispose();
        },
        (error: unknown) => {
          if (!vm.alive) return;
          const failure = vm.newError(error instanceof Error ? error.message : String(error));
          deferred.reject(failure);
          failure.dispose();
        },
      ).finally(() => {
        pending--;
        if (finished) {
          if (!pending) release();
        } else if (vm.alive) runtime.executePendingJobs();
      });
      return deferred.handle;
    });
    vm.setProp(vm.global, "__op", op);
    op.dispose();
    const loaded = vm.evalCode(prelude, "prelude.js");
    if (loaded.error) return failed(vm, loaded.error, logs);
    loaded.value.dispose();
    // The program body runs as an async function, so it can await page calls and return a value.
    const started = vm.evalCode(`(async () => {\n${code}\n})()`, "program.js");
    if (started.error) return failed(vm, started.error, logs);
    const settled = vm.resolvePromise(started.value);
    started.value.dispose();
    runtime.executePendingJobs();
    const outcome = await Promise.race([
      settled,
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), Math.max(0, limits.deadline - Date.now()))),
    ]);
    if (outcome === "timeout")
      return { ok: false, error: `The program ran past its time limit${pending ? ` with ${pending} page call(s) unfinished` : ""}. Split it into shorter programs.`, logs };
    if (outcome.error) return failed(vm, outcome.error, logs);
    const value = vm.dump(outcome.value);
    outcome.value.dispose();
    return { ok: true, value, logs };
  } finally {
    // Page calls still running end with the job's own lease; the sandbox goes when they do.
    finished = true;
    if (!pending) release();
  }
}

function failed(vm: QuickJSContext, error: QuickJSHandle, logs: string[]): SandboxResult {
  const dumped = vm.dump(error) as { name?: string; message?: string; stack?: string } | string;
  error.dispose();
  const text =
    typeof dumped === "string"
      ? dumped
      : [`${dumped?.name ?? "Error"}: ${dumped?.message ?? ""}`, dumped?.stack?.split("\n").slice(0, 6).join("\n")].filter(Boolean).join("\n");
  return { ok: false, error: text.slice(0, 2_000), logs };
}
