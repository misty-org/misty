import { loadDesktopApp } from "../src/features/apps/desktopAppLoader";
import { officialDesktopPackageReady, uninstallOfficialDesktopPackage } from "../src/features/apps/desktopPackages";
import type { OfficialApp } from "../src/api/apps/api";
import { invoke } from "@tauri-apps/api/core";
import { createMistyAppSDK, isMistyTerminalMethod, type MistyAppSettings, type MistySurfaceAdapter } from "@misty/sdk";
import { createAppRpcScope } from "../src/features/apps/rpc/session";
import { createTerminalRpc } from "../src/features/apps/rpc/terminal";
import { createAppUiRpc } from "../src/features/apps/rpc/appUi";
import { createAppSurfaceBridge } from "../src/features/apps/rpc/surface";
import { mountAppComponent } from "../src/features/apps/rpc/component";
import { nativeRpcBackend } from "../src/features/apps/rpc/nativeBackend";

const parameters = new URLSearchParams(location.search);
const fixture = parameters.get("fixture")!;
const packageURL = "/node_modules/.cache/misty-terminal-component/app.js";
const packageApp: OfficialApp | undefined = parameters.has("package")
  ? (await fetch("/official-apps/catalog.json").then(response => response.json())).apps.find((app:OfficialApp) => app.id === "terminal")
  : undefined;
if (parameters.has("package") && !packageApp) throw new Error("Terminal is missing from the downloadable catalog");
const definition = packageApp ? await loadDesktopApp(packageApp) : (await import(/* @vite-ignore */ packageURL)).default;
const errors: string[] = [];
function instance(id: string) {
  const root = document.getElementById(id)!;
  const scope = createAppRpcScope({identity:{appId:"terminal", accountId:"sdk-probe", instanceId:id},
    scopes:["terminal.execute", "ai.use"], expiresAt:new Date(Date.now()+60000).toISOString(),
    isCurrentAccount:account => account === "sdk-probe"});
  let surface: MistySurfaceAdapter | null = null;
  const surfaceBridge = createAppSurfaceBridge(scope, adapter => { surface = adapter; });
  const terminal = createTerminalRpc(scope, nativeRpcBackend);
  const commands = new Map<string, () => void>();
  const settingsListeners = new Set<() => void>();
  const settings: MistyAppSettings = {terminal:{cursorBlink:true,cursorStyleIndex:0,fontFamily:"",fontSize:13,scrollback:1000},shortcutLabels:{"terminal.search":"⌘F"}};
  let title = "";
  const ui = createAppUiRpc(scope, {
    settings:() => settings, setTitle:value => {title = value;},
    openExternal:async () => {throw new Error("The component probe must not open external links");},
    reportError:message => errors.push(message),
    subscribeSettings:listener => { settingsListeners.add(listener); return () => settingsListeners.delete(listener); },
    registerShortcut:(command, listener) => {commands.set(command, listener); return () => commands.delete(command);},
  });
  let handle = "";
  let resizeCount = 0;
  const transport = {
    registerSurface:surfaceBridge.register,
    async request(message: {method:string; params?:unknown}) {
      if (message.method === "lifecycle.ready") return;
      // The probe shell uses a temporary profile and no user shell history.
      if (message.method === "terminal.create") {
        const result = await terminal.request({...message, params:{...message.params as object, cwd:fixture, env:{ZDOTDIR:fixture,HISTFILE:"/dev/null"}}}) as {handle:string};
        handle = result.handle;
        return result;
      }
      if (message.method === "terminal.environments") return [];
      if (message.method === "terminal.resize") resizeCount++;
      return isMistyTerminalMethod(message.method) ? terminal.request(message) : ui.request(message);
    },
    subscribe:(topic:string, callback:(event:unknown) => void) => topic.startsWith("terminal:") ? terminal.subscribe(topic, callback) : ui.subscribe(topic, callback),
  };
  const sdk = createMistyAppSDK(transport);
  const mounted = mountAppComponent({definition, root, scope, transport,
    context:{instanceId:id,route:"/apps/terminal",active:true,focused:id === "a",appearance:{mode:"dark"}},
    release:() => {ui.close(); surfaceBridge.close(); void terminal.close();}});
  return {root, sdk, mounted, scope, commands, handle:() => handle, title:() => title,
    text:() => surface?.getSelection?.()?.content ?? "",
    changeSettings:() => {settings.terminal!.fontSize = 16; settingsListeners.forEach(listener => listener());},
    resizes:() => resizeCount};
}
const a = instance("a"), b = instance("b");
async function until(check:() => boolean, reason:string) {
  const end = Date.now()+10000;
  while (!check()) {
    if (errors.length) throw new Error(errors.join("; "));
    if (Date.now()>end) throw new Error(reason);
    await new Promise(resolve => setTimeout(resolve, 40));
  }
}
let success = false, message = "";
try {
  await Promise.all([a.mounted.ready, b.mounted.ready]);
  await until(() => Boolean(a.handle() && b.handle()), "The actual Terminal screens did not create their PTYs");
  await a.sdk.terminal.write(a.handle(), "printf '__SDK_COMPONENT_%s__\\n' FIRST\r");
  await b.sdk.terminal.write(b.handle(), "printf '__SDK_COMPONENT_%s__\\n' SECOND\r");
  await until(() => a.text().includes("__SDK_COMPONENT_FIRST__") && b.text().includes("__SDK_COMPONENT_SECOND__"), "xterm did not display the SDK output");
  if (a.text().includes("__SDK_COMPONENT_SECOND__") || b.text().includes("__SDK_COMPONENT_FIRST__")) throw new Error("Component stores leaked between tabs");
  let denied = false;
  try { await b.sdk.terminal.write(a.handle(), "must not run"); } catch {denied = true;}
  if (!denied) throw new Error("One component accessed another component's PTY");
  a.commands.get("terminal.search")?.();
  if (!a.root.contains(document.activeElement) || document.activeElement?.tagName !== "INPUT") throw new Error("SDK shortcut did not focus Terminal search");
  const before = a.resizes();
  a.changeSettings();
  await until(() => a.resizes()>before, "Terminal did not apply live SDK settings");
  if (!a.title().startsWith("Terminal") || !b.title().startsWith("Terminal")) throw new Error("SDK tab titles were not set");
  await a.mounted.close();
  if (a.root.children.length || a.commands.size) throw new Error("Closed component retained its DOM or shortcuts");
  await b.sdk.terminal.write(b.handle(), "printf '__SDK_COMPONENT_%s__\\n' STILL_RUNNING\r");
  await until(() => b.text().includes("__SDK_COMPONENT_STILL_RUNNING__"), "Closing one tab stopped the other tab");
  if (packageApp) {
    await b.mounted.close();
    if (!await officialDesktopPackageReady(packageApp)) throw new Error("The signed installation was not verified");
    await invoke("sdk_probe_tamper", {nonce:parameters.get("nonce")});
    if (await officialDesktopPackageReady(packageApp)) throw new Error("Modified extracted code passed verification");
    await loadDesktopApp(packageApp);
    if (!await officialDesktopPackageReady(packageApp)) throw new Error("The modified package was not repaired");
    const reopened = instance("a");
    try {
      await reopened.mounted.ready;
      await until(() => Boolean(reopened.handle()), "The installed Terminal did not reopen");
      await reopened.sdk.terminal.write(reopened.handle(), "printf '__SDK_PACKAGE_%s__\\n' REOPENED\r");
      await until(() => reopened.text().includes("__SDK_PACKAGE_REOPENED__"), "The reopened Terminal did not render shell output");
    } finally { await reopened.mounted.close(); }
    await uninstallOfficialDesktopPackage(packageApp.id);
    if (await officialDesktopPackageReady(packageApp)) throw new Error("Uninstall retained the package");
  }
  success = true;
  message = "PASS: built SDK-only Terminal components → macOS PTYs; isolated tabs/output, search shortcut, live settings, titles, AI context, cross-handle denial and cleanup.";
  if (packageApp) message += " Signed download/install, custom-scheme JS/CSS import, tamper rejection/repair, reopen and uninstall also passed.";
} catch (error) { message = error instanceof Error ? error.message : String(error); }
finally { await Promise.allSettled([a.mounted.close(), b.mounted.close()]); }
document.getElementById("result")!.textContent = message;
await invoke("sdk_probe_complete", {nonce:parameters.get("nonce"), success, message});
