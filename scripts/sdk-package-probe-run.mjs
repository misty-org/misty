/** Run a disposable native macOS signed-package check against a candidate catalog.
 * Usage: node scripts/sdk-package-probe-run.mjs browser /tmp/misty-sdk-browser-release-candidate
 * The Rust harness uses temporary installation/profile roots; normal app data is untouched.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { access, readFile, mkdtemp, mkdir, copyFile, writeFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { constants } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { createServer as createPortReservation } from "node:net";

const [appId, candidate] = process.argv.slice(2);
if (process.platform !== "darwin") throw new Error("This verification runner requires macOS.");
if (!["terminal", "planner", "browser", "journal", "inbox"].includes(appId) || !candidate)
  throw new Error("Pass terminal, planner, browser, journal or inbox and its candidate repository directory.");
const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const candidateRoot = path.resolve(candidate);
const catalogPath = path.join(candidateRoot, "apps/catalog.json");
const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
const app = catalog.apps.find(item => item.id === appId);
if (app?.desktop.runtime !== "downloaded") throw new Error("The candidate must declare a downloaded runtime.");
const assets = path.join(candidateRoot, "public/official-apps");
await access(assets);
process.env.MISTY_OFFICIAL_APPS_CATALOG = catalogPath;
process.env.MISTY_OFFICIAL_APPS_DIR = assets;
const require = createRequire(import.meta.url);
const yjsRequire = createRequire(require.resolve("yjs"));
let journalFixture;
if (process.env.MISTY_SDK_JOURNAL_FIXTURE) {
  const fixturePath = process.env.MISTY_SDK_JOURNAL_FIXTURE;
  if (appId !== "journal" || (await stat(fixturePath)).mode & 0o077)
    throw new Error("Journal host verification requires a private fixture configuration.");
  journalFixture = JSON.parse(await readFile(fixturePath, "utf8"));
  const api = new URL(journalFixture.apiBase);
  if (api.protocol !== "http:" || api.hostname !== "127.0.0.1" || !journalFixture.accountToken)
    throw new Error("Journal host verification only accepts a disposable loopback account.");
}
let server;
let child;
let interrupted = false;
let bundleRoot;
const stop = () => { interrupted = true; child?.kill("SIGTERM"); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
try {
  const reservation = createPortReservation();
  await new Promise((resolve, reject) => {
    reservation.once("error", reject);
    reservation.listen(0, "127.0.0.1", resolve);
  });
  const port = reservation.address().port;
  await new Promise((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
  server = await createServer({
    root, mode: "desktop",
    plugins: [{ name: "sdk-browser-download-fixture", configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (journalFixture && request.url === "/scripts/sdk-journal-host-fixture.json") {
          const { accountToken, userId, spaceId, noteId, drawingId } = journalFixture;
          response.setHeader("Content-Type", "application/json");
          response.setHeader("Cache-Control", "no-store");
          response.end(JSON.stringify({ accountToken, userId, spaceId, noteId, drawingId }));
          return;
        }
        if (request.url !== "/scripts/sdk-browser-download.txt") return next();
        response.setHeader("Content-Type", "text/plain");
        response.setHeader("Content-Disposition", 'attachment; filename="misty-sdk-probe.txt"');
        response.end("Misty SDK native download fixture\n");
      });
    } }],
    // The collaboration fixture uses the same nested lib0 package as Yjs.
    resolve: { alias: { lib0: path.dirname(yjsRequire.resolve("lib0/package.json")) } },
    server: { host: "127.0.0.1", port, strictPort: true,
      ...(journalFixture ? { proxy: { "/__sdk-journal-api": {
        target: new URL(journalFixture.apiBase).origin,
        rewrite: (path) => path.replace(/^\/__sdk-journal-api/, ""),
      } } } : {}),
    },
  });
  await server.listen();
  const address = server.httpServer.address();
  if (!address || typeof address === "string") throw new Error("No loopback probe server.");
  if (interrupted) throw new Error("Probe interrupted before native launch.");
  const origin = `http://127.0.0.1:${address.port}`;
  console.log(`Verifying signed ${appId} candidate in a disposable macOS window.`);
  const run = async (command, args, env = process.env) => {
    child = spawn(command, args, { cwd: root, stdio: "inherit", env });
    return await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", code => resolve(interrupted ? 1 : code ?? 1));
    });
  };
  const built = await run("cargo", ["build", "--manifest-path", "src-tauri/Cargo.toml", "--example", "sdk_package_probe"]);
  if (built !== 0) throw new Error(`Native probe build failed (${built}).`);
  bundleRoot = await mkdtemp(path.join(os.tmpdir(), "misty-sdk-native-probe-"));
  const bundle = path.join(bundleRoot, "Misty SDK Verification.app");
  const binary = path.join(bundle, "Contents/MacOS/sdk_package_probe");
  await mkdir(path.dirname(binary), {recursive:true});
  await copyFile(path.join(root, "src-tauri/target/debug/examples/sdk_package_probe"), binary, constants.COPYFILE_FICLONE);
  await writeFile(path.join(bundle, "Contents/Info.plist"), `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.misty.sdk-package-probe</string><key>CFBundleName</key><string>Misty SDK Verification</string><key>CFBundleExecutable</key><string>sdk_package_probe</string><key>CFBundlePackageType</key><string>APPL</string><key>NSHighResolutionCapable</key><true/></dict></plist>`);
  console.log(`Native verification bundle: ${bundle}`);
  const debug = process.env.MISTY_SDK_PROBE_DEBUGGER === "1";
  const command = debug ? "lldb" : binary;
  const args = debug
    ? ["--batch", "-o", "breakpoint set -n objc_exception_throw", "-o", "run", "-o", "po (id)$x0", "-o", "bt", "-o", "process kill", "--", binary]
    : [];
  const status = await run(command, args, { ...process.env, MISTY_SDK_PROBE_APP: appId, MISTY_SDK_PROBE_ORIGIN: origin, MISTY_SDK_PROBE_CATALOG: `${origin}/official-apps/catalog.json` });
  process.exitCode = debug ? 1 : status;
} finally {
  if (child?.exitCode === null) child.kill("SIGTERM");
  await server?.close();
  if (bundleRoot) await rm(bundleRoot, {recursive:true, force:true});
  process.off("SIGINT", stop);
  process.off("SIGTERM", stop);
}
