import { ConnectedDevicesProvider } from "../src/features/connected-devices";
import { useWorkspaceStore } from "../src/features/workspace/useWorkspaceStore";
import React from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import { MemoryRouter } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { createMistyAppSDK, type MistyComponentContext } from "@misty/sdk";
import { loadDesktopApp } from "../src/features/apps/desktopAppLoader";
import { createAppRpcScope } from "../src/features/apps/rpc/session";
import { createFileSystemRpc } from "../src/features/apps/rpc/fileSystem";
import { createFileWorkspaceMount, type FileWorkspaceRegistration } from "../src/features/apps/rpc/fileWorkspace";
import { FileWorkspaceSurface } from "../src/features/apps/FileWorkspaceSurface";
import { componentLibraries } from "../src/features/apps/componentLibraries";
import { useAppStore } from "../src/features/app-shell";
import { useSettingsStore } from "../src/features/settings";
import { OfficialAppAuthProvider } from "../src/features/auth/AuthContext";
import { PointerDragProvider } from "../src/features/dnd";
import { TooltipProvider } from "../src/shared/ui";
import { useTransfersStore } from "../src/features/transfers/store";
import { useExplorerStore } from "@/features/files/explorer/store";
import type { OfficialApp } from "../src/api/apps";
import type { WorkspaceTab } from "../src/features/workspace/model";

const params = new URLSearchParams(location.search), nonce = params.get("nonce")!, fixture = params.get("fixture")!;
const log = (message:string) => invoke("sdk_probe_log",{nonce,message});
let success = false, message = "";
const host = createRoot(document.getElementById("host")!);
const packageRoot = document.createElement("div"); packageRoot.style.height = "100%";
document.body.append(packageRoot);
let registration: FileWorkspaceRegistration | null = null;
const tab: WorkspaceTab = {id:"files-probe",surfaceId:"official-app",groupKey:"app:files",instanceKey:"files",title:"Explorer",route:"/apps/files",sidebarVisible:true,state:null,createdAt:0,lastFocusedAt:0};
useWorkspaceStore.getState().reset();
const opened = useWorkspaceStore.getState().openSurface({surfaceId:"official-app",groupKey:"app:files",instanceKey:"files",title:"Explorer",route:"/apps/files",instancePolicy:"multiple",state:{version:1,path:fixture}});
tab.id = opened.id;
const user = {id:"files-probe",name:"Files verification",email:"files@example.invalid"};
const render = () => host.render(<MemoryRouter><OfficialAppAuthProvider user={user}><ConnectedDevicesProvider><PointerDragProvider><TooltipProvider>
  {registration && createPortal(<FileWorkspaceSurface tab={tab} options={registration.options}/>, registration.root)}
</TooltipProvider></PointerDragProvider></ConnectedDevicesProvider></OfficialAppAuthProvider></MemoryRouter>);
const scope = createAppRpcScope({identity:{appId:"files",accountId:user.id,instanceId:tab.id}, scopes:["files.read","files.write","connections.read","connections.write","navigation.write"],expiresAt:new Date(Date.now()+120000).toISOString(),isCurrentAccount:()=>true});
const fileSystem = createFileSystemRpc(scope, invoke);
const calls: string[] = [];
const transport = {
  mountFileWorkspace: createFileWorkspaceMount(scope, packageRoot, next => {registration=next;render();}),
  async request(input: {method:string;params?:unknown}) {
    calls.push(input.method);
    if (input.method.startsWith("fileSystem.")) return fileSystem(input);
    if (["lifecycle.ready","navigation.setItems"].includes(input.method)) return;
    throw new Error(`Unexpected Files SDK request ${input.method}`);
  },
};
const sdk = createMistyAppSDK(transport);
async function until(check:()=>boolean, reason:string) {
  const end = Date.now()+20000;
  while (!check()) {if(Date.now()>end) throw new Error(reason); await new Promise(resolve=>setTimeout(resolve,50));}
}
try {
  const app: OfficialApp = (await fetch(params.get("catalog")!).then(r=>r.json())).apps.find((a:OfficialApp)=>a.id==="files");
  await log("loading component");
  const definition = await loadDesktopApp(app);
  await log("loading native app/settings");
  await Promise.all([useAppStore.getState().loadApp(),useSettingsStore.getState().load()]);
  const snapshot = useAppStore.getState().app;
  if (!snapshot) throw new Error("Native app snapshot did not load");
  // All filesystem writes and initial Explorer browsing are confined to this disposable fixture.
  useAppStore.setState({app:{...snapshot,environment:{...snapshot.environment,homeDir:fixture}}});
  await log("listing fixture");
  const listing = await sdk.fileSystem.listDirectory({path:fixture,showHidden:true});
  if (!listing.entries.some(e=>e.name==="source")) throw new Error("Native folder listing failed");
  await sdk.fileSystem.disks();
  await sdk.fileSystem.pairedDevices();
  const context: MistyComponentContext = {instanceId:tab.id,route:"/apps/files",active:true,focused:true,appearance:{mode:"dark"}};
  await log("mounting original Explorer");
  const mounted = await definition.mount({root:packageRoot,misty:sdk,context,signal:scope.signal,libraries:componentLibraries});
  await until(()=>packageRoot.textContent?.includes("source")===true,"Original Explorer did not show native files");
  await log("Explorer rendered, starting copy");
  const before = await sdk.fileSystem.transfers();
  await sdk.fileSystem.queueTransfer({sources:[{path:`${fixture}/source/example.txt`,isDirectory:false,sizeBytes:27,remoteModified:null}],destinationDirectory:`${fixture}/destination`,operation:"copy"});
  await log("copy queued, reading SQLite");
  let history = await sdk.fileSystem.transfers();
  const end = Date.now()+15000;
  while (!history.rows.some(row=>row.fileName==="example.txt" && row.status==="completed")) {
    if(Date.now()>end) throw new Error(`Native transfer did not complete: ${JSON.stringify(history.rows)}`);
    await new Promise(resolve=>setTimeout(resolve,100)); history=await sdk.fileSystem.transfers();
  }
  if (history.totalCount<=before.totalCount) throw new Error("Copy did not enter SQLite transfer history");
  if (!(await sdk.fileSystem.listDirectory({path:`${fixture}/destination`,showHidden:true})).entries.some(e=>e.name==="example.txt")) throw new Error("Native copy did not create destination file");
  await log("copy completed, opening Transfers");
  mounted.update({...context,route:"/apps/files?view=transfers"});
  await until(()=>packageRoot.querySelector('[data-misty-file-workspace="transfers"]')!==null,"Transfers route did not select full workspace");
  await useTransfersStore.getState().load();
  await until(()=>packageRoot.textContent?.includes("example.txt")===true,"Transfers did not display native history");
  await log("Transfers rendered, reopening Explorer");
  mounted.update(context);
  await until(()=>packageRoot.querySelector('[data-misty-file-workspace="explorer"]')!==null,"Explorer route did not reopen");
  if (!Object.values(useExplorerStore.getState().panes).length) throw new Error("Explorer lost its panes");
  await mounted.unmount(); scope.close();
  if (registration) throw new Error("Files workspace did not clean up");
  if (calls.some(c=>c.startsWith("files."))) throw new Error("Files used the replacement permission/transfer path");
  success=true;
  message="PASS: local downloaded Files package; original Explorer renders native folders; disks and paired-device snapshots; SDK IPC copy creates a real file and SQLite transfer history; full Transfers displays it; Explorer/Transfers navigation and cleanup. No folder-grant prompts or view-local transfer queue. External paired hardware remains unverified.";
} catch(error) {message=`FAIL: ${error instanceof Error ? error.message + " | " + error.stack + " | " + packageRoot.textContent?.slice(-1800) : String(error)}`;}
finally {scope.close();host.unmount();}
await log(message);
await invoke("sdk_probe_complete",{nonce,success,message});
