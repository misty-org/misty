/** Real local clangd protocol check. This is not a Tauri/SDK device-RPC integration test. */
import { build } from "esbuild";
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, writeFile, rm, mkdir, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const projectRpc = process.argv.includes("--project-rpc");
const virtualRoot = "/misty-project/clangd-fixture";
let rpc, rpcScope, released = 0;
const output = path.resolve(process.argv[2] || "/tmp/misty-code-lsp-probe");
await mkdir(output, { recursive: true });
const fixture = await realpath(await mkdtemp(path.join(tmpdir(), "misty-code-lsp-")));
let child, client;
let receive = () => {},
  exited = () => {};
let stderr = "",
  pending = Buffer.alloc(0);
const methods = [];
const transport = {
  async start() {
    const executable = execFileSync("xcrun", ["--find", "clangd"], { encoding: "utf8" }).trim();
    child = spawn(executable, ["--background-index=false", "--pch-storage=memory", "--log=error"], {
      cwd: fixture,
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stderr.on("data", (data) => {
      stderr = (stderr + data.toString()).slice(-8192);
    });
    child.stdout.on("data", (data) => {
      pending = Buffer.concat([pending, data]);
      if (pending.length > 8 * 1024 * 1024) {
        child.kill();
        exited("Language-server frame exceeded the probe limit.");
        return;
      }
      while (true) {
        const end = pending.indexOf("\r\n\r\n");
        if (end < 0) return;
        const length = Number(
          /Content-Length:\s*(\d+)/i.exec(pending.subarray(0, end).toString())?.[1],
        );
        if (!Number.isSafeInteger(length) || length < 0) {
          child.kill();
          exited("Malformed language-server frame.");
          return;
        }
        if (pending.length < end + 4 + length) return;
        const body = pending.subarray(end + 4, end + 4 + length);
        pending = pending.subarray(end + 4 + length);
        receive(JSON.parse(body.toString()));
      }
    });
    child.on("exit", () => exited("clangd stopped"));
    await new Promise((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    return "local-clangd";
  },
  async subscribe(_id, message, exit) {
    receive = message;
    exited = exit;
    return () => {
      receive = () => {};
      exited = () => {};
    };
  },
  async send(_id, message) {
    methods.push(message.method || "response");
    const body = Buffer.from(JSON.stringify(message));
    await new Promise((resolve, reject) =>
      child.stdin.write(
        Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]),
        (error) => (error ? reject(error) : resolve()),
      ),
    );
  },
  async stop() {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const exit = new Promise((resolve) => child.once("exit", resolve));
    const timeout = setTimeout(() => child.kill("SIGKILL"), 4000);
    child.kill("SIGTERM");
    await exit;
    clearTimeout(timeout);
  },
};
try {
  const modulePath = path.join(fixture, "client.mjs");
  await build({
    ...(projectRpc ? { stdin: { resolveDir: process.cwd(), contents: `
      export { LspClient, pathToUri, uriToPath } from "./src/features/coding-workspace/lsp/client.ts";
      export { createCodeLspRpc } from "./src/features/apps/rpc/codeLsp.ts";
      export { createAppRpcScope } from "./src/features/apps/rpc/session.ts";
      export { createMistyAppSDK } from "@misty/sdk";
      export { createSdkCodeLspTransport } from "./src/features/coding-workspace/lsp/sdkTransport.ts";
    ` } } : { entryPoints: ["src/features/coding-workspace/lsp/client.ts"] }),
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: modulePath,
    logLevel: "silent",
  });
  const module = await import(pathToFileURL(modulePath).href);
  const { LspClient, pathToUri, uriToPath } = module;
  const physicalFile = path.join(fixture, "日本語 sdk #?.cpp");
  const file = projectRpc ? `${virtualRoot}/日本語 sdk #?.cpp` : physicalFile;
  const text =
    "int sdk_add(int left, int right) {\n  return left + right;\n}\nint main() {\n  return sdk_add(2, 3);\n}\n";
  await writeFile(physicalFile, text);
  await writeFile(path.join(fixture, "compile_flags.txt"), "-xc++\n-std=c++17\n");
  let clientTransport = transport;
  if (projectRpc) {
    const events = new Map();
    rpcScope = module.createAppRpcScope({ identity: { appId: "code", accountId: "fixture", spaceId: "fixture", instanceId: "clangd-view" }, scopes: ["code.execute", "files.read"], expiresAt: "2099-01-01T00:00:00Z", isCurrentAccount: () => true });
    rpc = module.createCodeLspRpc(rpcScope, {
      listen: async (event, callback) => { events.set(event, callback); return () => events.delete(event); },
      invoke: async (command, args) => {
        if (command === "code_lsp_start") {
          assert.equal(args.request.cwd, fixture);
          await transport.subscribe(null,
            message => events.get("misty://code-lsp-message")?.({ sessionId: "local-clangd", payload: JSON.stringify(message) }),
            reason => events.get("misty://code-lsp-exit")?.({ sessionId: "local-clangd", reason }));
          return transport.start();
        }
        if (command === "code_lsp_send") return transport.send(args.sessionId, JSON.parse(args.payload));
        if (command === "code_lsp_stop") return transport.stop();
        throw new Error(`Unexpected native command ${command}`);
      },
    }, { resolveProject: async (root, signal) => {
      assert.equal(root, virtualRoot);
      return { nativeRoot: fixture, signal, release: () => { released++; } };
    } });
    clientTransport = module.createSdkCodeLspTransport(module.createMistyAppSDK({ request: rpc.request, subscribe: rpc.subscribe }));
  }
  client = new LspClient("cpp", projectRpc ? virtualRoot : fixture, clientTransport);
  await client.ensureStarted();
  assert.equal(client.isRunning(), true);
  let latestDiagnostics;
  const removeMessages = client.onMessage(message => {
    if (message.method === "textDocument/publishDiagnostics" && message.params?.uri === pathToUri(file)) latestDiagnostics = message.params;
  });
  await client.didOpen(file, "cpp", text);
  const position = { textDocument: { uri: pathToUri(file) }, position: { line: 4, character: 11 } };
  const hover = await client.request("textDocument/hover", position);
  assert.ok(JSON.stringify(hover).includes("sdk_add"));
  const definition = await client.request("textDocument/definition", position);
  assert.ok(
    Array.isArray(definition) &&
      definition.some((value) => uriToPath(value.uri) === file && value.range.start.line === 0),
  );
  const symbols = await client.request("textDocument/documentSymbol", {
    textDocument: { uri: pathToUri(file) },
  });
  assert.ok(symbols.some((symbol) => symbol.name === "sdk_add"));
  if (projectRpc) {
    latestDiagnostics = undefined;
    await client.didChange(file, text.replace("sdk_add(2, 3)", "missing_sdk_symbol(2, 3)"), 2);
    const deadline = Date.now() + 5000;
    while (!latestDiagnostics?.diagnostics?.some(item => item.message.includes("missing_sdk_symbol"))) {
      if (Date.now() > deadline) throw new Error("Expected mapped diagnostics after a document change.");
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(latestDiagnostics.uri, pathToUri(file));
    await client.didChange(file, text, 3);
    const references = await client.request("textDocument/references", { ...position, context: { includeDeclaration: true } });
    assert.ok(references.length >= 2 && references.every(item => uriToPath(item.uri) === file));
    const rename = await client.request("textDocument/rename", { ...position, newName: "sdk_sum" });
    assert.ok(Object.keys(rename.changes ?? {}).includes(pathToUri(file)) || rename.documentChanges?.some(item => item.textDocument.uri === pathToUri(file)));
  }
  assert.equal(methods[0], "initialize");
  assert.equal(methods[1], "initialized");
  removeMessages();
  await client.dispose();
  assert.equal(client.isRunning(), false);
  if (projectRpc) { await rpc.close(); rpcScope.close(); assert.equal(released, 1); }
  assert.ok(child.exitCode !== null || child.signalCode !== null);
  await assert.rejects(client.request("textDocument/hover", position), /closed/);
  const result = {
    status: "passed",
    environment:
      projectRpc ? "real local clangd through public SDK and host RPC project mapping; directory-grant/native IPC adapter still pending" : "real local clangd with a protocol-client transport; SDK native bridge still pending",
    methods,
    symbols: symbols.map((value) => value.name),
    processExited: true,
  };
  await writeFile(path.join(output, "result.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(stderr);
  throw error;
} finally {
  await client?.dispose().catch(() => {});
  await rpc?.close().catch(() => {});
  rpcScope?.close();
  await transport.stop();
  await rm(fixture, { recursive: true, force: true });
}
