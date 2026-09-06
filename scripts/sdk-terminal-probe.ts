import { invoke } from "@tauri-apps/api/core";
import { createMistyAppSDK } from "@misty/sdk";
import { createAppRpcScope } from "../src/features/apps/rpc/session";
import { createTerminalRpc } from "../src/features/apps/rpc/terminal";
import { nativeRpcBackend } from "../src/features/apps/rpc/nativeBackend";

const parameters = new URLSearchParams(location.search);
const fixture = parameters.get("fixture")!;
const scope = createAppRpcScope({
  identity: { appId: "terminal", accountId: "sdk-probe", instanceId: "sdk-probe" },
  scopes: ["terminal.execute"],
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  isCurrentAccount: (id) => id === "sdk-probe",
});
const rpc = createTerminalRpc(scope, nativeRpcBackend);
const sdk = createMistyAppSDK({
  request: (message) =>
    message.method === "lifecycle.ready" ? Promise.resolve() : rpc.request(message),
  subscribe: rpc.subscribe,
});
void (async () => {
  let success = false;
  let message = "";
  try {
    const session = await sdk.terminal.create({
      cwd: fixture,
      cols: 80,
      rows: 24,
      env: { ZDOTDIR: fixture, HISTFILE: "/dev/null" },
    });
    let resolveExit!: () => void;
    const exited = new Promise<void>((resolve) => {
      resolveExit = resolve;
    });
    let output = "";
    let exitCode: number | null = null;
    const unsubscribe = await sdk.terminal.subscribe(session.handle, (event) => {
      if (event.type === "output") output += event.data;
      else {
        exitCode = event.exitCode;
        resolveExit();
      }
    });
    await sdk.terminal.resize(session.handle, { cols: 100, rows: 30 });
    // Split the sentinel so PTY input echo cannot masquerade as command output.
    await sdk.terminal.write(session.handle, "printf '__MISTY_SDK_%s__\\n' OK; exit\r");
    await Promise.race([
      exited,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Terminal SDK probe timed out")), 12_000),
      ),
    ]);
    if (!output.includes("__MISTY_SDK_OK__") || exitCode !== 0)
      throw new Error(`Terminal output/exit verification failed (exit=${exitCode})`);
    unsubscribe();
    await sdk.terminal.close(session.handle);
    let denied = false;
    try {
      await sdk.terminal.write(session.handle, "must not run");
    } catch {
      denied = true;
    }
    if (!denied) throw new Error("Closed terminal handle remained usable");
    success = true;
    message =
      "PASS: SDK → scoped RPC → macOS PTY create/resize/write/output/exit/close; closed handle rejected.";
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  } finally {
    await rpc.close();
    scope.close();
  }
  document.getElementById("result")!.textContent = message;
  await invoke("sdk_probe_complete", { nonce: parameters.get("nonce"), success, message });
})();
