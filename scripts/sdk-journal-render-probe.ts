/** Browser rendering fixture for the built component; device/server transports are controlled doubles. */
import * as React from "react";
import * as ReactDOM from "react-dom";
import * as ReactDOMClient from "react-dom/client";
import * as jsxRuntime from "react/jsx-runtime";
import * as Y from "yjs";
import * as sync from "y-protocols/sync";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import { createMistyAppSDK, type MistyComponentDefinition, type MistySurfaceAdapter } from "@misty/sdk";

const probeParams = new URLSearchParams(location.search);
const nativeProbe = probeParams.get("native") === "1";
const nativeLoader = nativeProbe ? await import("../src/features/apps/desktopAppLoader") : null;
const nativeCatalog = nativeProbe ? await fetch(probeParams.get("catalog")!).then(response => response.json()) : null;
const nativeApp = nativeCatalog?.apps.find((app: { id: string }) => app.id === "journal");
if (nativeProbe && nativeApp?.desktop.runtime !== "downloaded") throw new Error("Journal candidate is unavailable");
const definition: MistyComponentDefinition = nativeLoader
  ? await nativeLoader.loadDesktopApp(nativeApp)
  : (await import(/* @vite-ignore */ new URL("./journal.js", location.href).href)).default;
let nativeDeviceInstance = "";
const nativeDeviceCompleted: string[] = [];
async function nativeDevice(method: string, params: unknown) {
  const { invoke } = await import("@tauri-apps/api/core");
  if (!nativeDeviceInstance) {
    const installed = await invoke<Array<{id:string;root:string;plugin_dir:string}>>("scan_local_plugins");
    const record = installed.find(item=>item.id==="journal"&&item.root==="public");
    if(!record) throw new Error("Verified Journal package disappeared");
    nativeDeviceInstance = await invoke<string>("mini_widget_open", {request:{root:record.plugin_dir,owner:{accountId:"user-a",spaceId:"space-a"},scopeLimit:nativeApp.scopes}});
  }
  const {encodeNativeAppValue, decodeNativeAppValue} = await import("../src/features/apps/nativeAppWire");
  const encoded = encodeNativeAppValue(params ?? {});
  if(method !== "files.release") {
    const status = await invoke<{capability:string;granted:boolean}>("mini_app_permission_status", {instance:nativeDeviceInstance,method,params:encoded});
    if(!status.granted) await invoke("mini_app_permission_decide", {instance:nativeDeviceInstance,capability:status.capability,allowed:true});
  }
  const result = decodeNativeAppValue(await invoke(method.startsWith("clipboard.") ? "sdk_probe_clipboard_call" : "mini_app_device_call", {nonce:probeParams.get("nonce"),instance:nativeDeviceInstance,method,params:encoded}));
  nativeDeviceCompleted.push(method);
  return result;
}
const subscriptions = new Map<string, Set<(event: unknown) => void>>();
const leases = new Map<string, Y.Doc>();
const doc = new Y.Doc();
const common = { angle: 0, strokeColor: "#1971c2", backgroundColor: "#d0ebff", fillStyle: "solid", strokeWidth: 2, strokeStyle: "solid", roughness: 1, opacity: 100, groupIds: [], frameId: null, roundness: null, seed: 1, version: 1, versionNonce: 1, isDeleted: false, boundElements: null, updated: 1, link: null, locked: false };
doc.getMap("drawing:elements").set("box", { ...common, id: "box", index: "a0", type: "rectangle", x: 40, y: 40, width: 420, height: 140 });
doc.getMap("drawing:elements").set("label", { ...common, id: "label", index: "a1", type: "text", x: 70, y: 85, width: 340, height: 35, backgroundColor: "transparent", text: "Downloaded Journal SDK", originalText: "Downloaded Journal SDK", fontFamily: 5, fontSize: 24, textAlign: "left", verticalAlign: "top", containerId: null, autoResize: true, lineHeight: 1.25 });
doc.getMap("drawing:scene").set("viewBackgroundColor", "#ffffff");
const calls: Array<{ method: string; params?: unknown }> = [];
const errors: string[] = [];
const outputs: Array<{ name: string; bytes: number }> = [];
const drafts = new Map<string, { name: string; parts: Uint8Array[] }>();
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
let clipboardImage = false;
const pickedFile = new TextEncoder().encode(JSON.stringify({ type: "excalidraw", version: 2, source: "SDK fixture", elements: [...doc.getMap("drawing:elements").values(), { ...common, id: "imported", index: "a2", type: "rectangle", x: 500, y: 300, width: 100, height: 100 }], appState: { viewBackgroundColor: "#ffffff" }, files: {} }));
let surface: MistySurfaceAdapter | null = null;
const drawing = { id: "drawing-a", space_id: "space-a", creator_user_id: "user-a", title: "Downloaded SDK canvas", lifecycle_state: "active", collaboration_revision: 0, acl_version: 1, created_at: "2026-09-05T00:00:00Z", updated_at: "2026-09-05T00:00:00Z", role: "creator", can_delete: true, audience_kind: "space" };
const emit = (topic: string, value: unknown) => { for (const listener of subscriptions.get(topic) ?? []) listener(value); };
const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const sdk = createMistyAppSDK({
  async request(message) {
    calls.push(message);
    if (nativeProbe && (message.method.startsWith("clipboard.") || message.method.startsWith("files."))) return nativeDevice(message.method, message.params);
    const params = message.params as Record<string, unknown> | undefined;
    switch (message.method) {
      case "lifecycle.ready": case "workspace.title.set": case "navigation.setItems": case "navigation.open": case "storage.local.set": return;
      case "context.get": return { appId: "journal", user: { id: "user-a" }, space: { id: "space-a", name: "Product" } };
      case "spaces.members.list": return { members: [], agents: [] };
      case "storage.local.get": return null;
      case "notes.list": return { notes: [] };
      case "drawings.list": return { drawings: [drawing] };
      case "ai.snapshot": return { available: false, following: false };
      case "activity.report": errors.push(String(params?.message)); return;
      case "collaboration.open": { const handle = crypto.randomUUID(); leases.set(handle, doc); return { handle, role: "creator" }; }
      case "collaboration.close": leases.delete(String(params?.handle)); return;
      case "collaboration.send": {
        const source = leases.get(String(params?.handle)); if (!source) throw new Error("Closed fixture lease");
        const decoder = decoding.createDecoder(Uint8Array.from(atob(String(params?.data)), character => character.charCodeAt(0)));
        if (decoding.readVarUint(decoder) !== 0) return;
        const encoder = encoding.createEncoder(); encoding.writeVarUint(encoder, 0);
        sync.readSyncMessage(decoder, encoder, source, "sdk-client");
        const reply = encoding.toUint8Array(encoder);
        if (reply.length > 1) queueMicrotask(() => emit(`collaboration:${params?.handle}`, { type: "binary", data: base64(reply) }));
        return;
      }
      case "clipboard.readText": return { text: "SDK clipboard text" };
      case "clipboard.readImage": return clipboardImage ? { mimeType: "image/png", data: png } : null;
      case "clipboard.writeImage": case "clipboard.writeText": return;
      case "files.pickDirectory": return { handle: "folder", name: "Exports" };
      case "files.pick": return { handle: "import", name: "Imported.excalidraw", bytes: pickedFile.length };
      case "files.readBytes": return pickedFile.slice(Number(params?.offset), Number(params?.offset) + Number(params?.length)).buffer;
      case "files.createCopy": { const handle = crypto.randomUUID(); drafts.set(handle, { name: String(params?.name), parts: [] }); return { handle }; }
      case "files.appendCopy": drafts.get(String(params?.handle))!.parts.push(new Uint8Array(params?.bytes as ArrayBuffer)); return;
      case "files.commitCopy": { const draft = drafts.get(String(params?.handle))!; const value = { name: draft.name, bytes: draft.parts.reduce((sum, part) => sum + part.length, 0) }; outputs.push(value); drafts.delete(String(params?.handle)); return value; }
      case "files.discardCopy": drafts.delete(String(params?.handle)); return;
      case "files.release": return;
      default: throw new Error(`Unexpected probe method: ${message.method}`);
    }
  },
  async registerSurface(adapter) { surface = adapter; return () => { if (surface === adapter) surface = null; }; },
  async subscribe(topic, listener) {
    const listeners = subscriptions.get(topic) ?? new Set(); listeners.add(listener); subscriptions.set(topic, listeners);
    if (topic.startsWith("collaboration:")) setTimeout(() => listener({ type: "open" }), 0);
    return () => { listeners.delete(listener); if (!listeners.size) subscriptions.delete(topic); };
  },
});
const lifetime = new AbortController();
const context = { instanceId: "journal-render", route: "/apps/journal?space=space-a&view=drawings&drawing=drawing-a&drawingView=canvas", active: true, focused: true, appearance: { mode: "dark" as const } };
const mounted = await definition.mount({ root: document.getElementById("root")!, misty: sdk, signal: lifetime.signal, context, libraries: { react: React, reactDom: ReactDOM, reactDomClient: ReactDOMClient, jsxRuntime, jsxDevRuntime: jsxRuntime, yjs: Y } });
Object.assign(window, { journalProbe: {
  calls, errors, outputs,
  setClipboardImage: (enabled: boolean) => { clipboardImage = enabled; },
  drawingElements: () => [...doc.getMap("drawing:elements").values()],
  snapshot: () => ({ leases: leases.size, subscriptions: subscriptions.size, surface: !!surface, elements: doc.getMap("drawing:elements").size, fonts: document.fonts.size }),
  preview: () => mounted.update({ ...context, route: "/apps/journal?space=space-a&view=drawings&drawing=drawing-a&drawingView=list" }),
  close: async () => { await mounted.unmount(); lifetime.abort(); doc.destroy(); },
} });

// Real macOS package/renderer check. Server and device calls above remain doubles.
if (nativeProbe) {
  const { invoke } = await import("@tauri-apps/api/core");
  const packages = await import("../src/features/apps/desktopPackages");
  let success = false;
  let message = "";
  const until = async (check: () => boolean, reason: string, timeoutMs = 20000) => {
    const deadline = Date.now() + timeoutMs;
    while (!check()) {
      if (errors.length) throw new Error(errors.join("; "));
      if (Date.now() > deadline) throw new Error(reason);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  };
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await mounted.unmount(); lifetime.abort(); doc.destroy();
    if(nativeDeviceInstance) { await invoke("mini_app_close", {instance:nativeDeviceInstance}); nativeDeviceInstance=""; }
  };
  try {
    await until(() => !!document.querySelector(".excalidraw canvas") && document.fonts.size >= 230 && !!surface && leases.size === 1,
      "Journal canvas, bundled fonts, collaboration lease or AI surface did not mount in WKWebView");
    await document.fonts.ready;
    const canvas = document.querySelector<HTMLCanvasElement>(".excalidraw canvas")!;
    if (!canvas.width || !canvas.height || document.querySelector("iframe")) throw new Error("Journal canvas dimensions or component hosting failed");
    mounted.update({ ...context, route: "/apps/journal?space=space-a&view=drawings&drawing=drawing-a&drawingView=list" });
    await until(() => [...document.querySelectorAll("button")].some(button => button.getAttribute("aria-label") === "Copy to clipboard" || button.title === "Copy to clipboard" || button.textContent?.trim() === "Copy to clipboard"), "Journal preview did not render");
    const copy = [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.trim() === "Copy to clipboard")!;
    await until(() => !copy.disabled, "Journal preview image was not ready to copy");
    copy.click();
    await until(() => nativeDeviceCompleted.includes("clipboard.writeImage"), "Journal native PNG copy did not finish");
    await sdk.clipboard.writeText("SDK Journal native clipboard verification");
    if(await sdk.clipboard.readText() !== "SDK clipboard text") throw new Error("Journal SDK native text read failed");
    const image = await sdk.clipboard.readImage();
    if(!image || image.type !== "image/png") throw new Error("Journal SDK native PNG read failed");
    const pngBytes = new DataView(await image.arrayBuffer());
    if(pngBytes.byteLength < 24 || pngBytes.getUint32(0) !== 0x89504e47 || pngBytes.getUint32(16) !== 1 || pngBytes.getUint32(20) !== 1) throw new Error("Native clipboard fixture PNG dimensions failed");
    const exportButton = [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.trim() === "Export image")!;
    exportButton.dispatchEvent(new PointerEvent("pointerdown", {bubbles:true, button:0, pointerType:"mouse"}));
    await until(() => [...document.querySelectorAll('[role="menuitem"]')].some(item=>item.textContent?.trim()==="SVG"), "Journal export menu did not open");
    [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(item=>item.textContent?.trim()==="SVG")!.click();
    await until(() => nativeDeviceCompleted.includes("files.commitCopy"), "Journal native export did not commit", 90000);
    const exports = await invoke<Array<{name:string;text:string}>>("sdk_probe_exports", {nonce:probeParams.get("nonce")});
    if(exports.length !== 1 || !exports[0].name.endsWith(".svg") || !exports[0].text.includes("<svg") || !exports[0].text.includes("Downloaded Journal SDK")) throw new Error("Native Journal SVG export contents failed");
    await close();
    await until(() => leases.size === 0 && subscriptions.size === 0 && !surface, "Journal left live resources after close");
    await invoke("sdk_probe_tamper", { nonce: probeParams.get("nonce") });
    if (await packages.officialDesktopPackageReady(nativeApp)) throw new Error("Modified Journal code passed verification");
    await nativeLoader!.loadDesktopApp(nativeApp);
    if (!await packages.officialDesktopPackageReady(nativeApp)) throw new Error("Journal repair failed");
    await packages.uninstallOfficialDesktopPackage(nativeApp.id);
    if (await packages.officialDesktopPackageReady(nativeApp)) throw new Error("Journal uninstall left a verified package");
    if (errors.length) throw new Error(errors.join("; "));
    success = true;
    message = "PASS: signed Journal download/install/import, native macOS WKWebView canvas/preview and bundled fonts, component hosting without iframe, lifecycle cleanup, tamper rejection/repair and uninstall. Native SDK clipboard text/PNG read/write and drawing preview copy pass with original clipboard restoration. Native folder selection and staged SVG file export pass in the disposable folder. Server/collaboration remain fixtures; real multi-client server behavior is not verified here.";
  } catch (error) { message = String(error); }
  finally { await close(); }
  document.getElementById("result")!.textContent = message;
  await invoke("sdk_probe_complete", { nonce: probeParams.get("nonce"), success, message });
}
