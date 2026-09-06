import { listen } from "@tauri-apps/api/event";
import { openBrowserPopup } from "../src/features/browser/openBrowserPopup";
import { dockLeaves } from "../src/features/workspace/dockTree";
import { invoke } from "@tauri-apps/api/core";
import { loadDesktopApp } from "../src/features/apps/desktopAppLoader";
import { officialDesktopPackageReady, uninstallOfficialDesktopPackage } from "../src/features/apps/desktopPackages";
import { createAppRpcScope } from "../src/features/apps/rpc/session";
import { createBrowserRpc } from "../src/features/apps/rpc/browser";
import { createBrowserRpcBackend } from "../src/features/apps/rpc/browserBackend";
import { createAppUiRpc } from "../src/features/apps/rpc/appUi";
import { createAppSurfaceBridge } from "../src/features/apps/rpc/surface";
import { mountAppComponent } from "../src/features/apps/rpc/component";
import { useWorkspaceStore } from "../src/features/workspace/useWorkspaceStore";
import { createBrowserTabState } from "../src/features/workspace/model";
import type { OfficialApp } from "../src/api/apps/api";
import type { MistyComponentContext, MistyBrowserInspection, MistySurfaceAdapter } from "@misty/sdk";
const params = new URLSearchParams(location.search);
const catalog = await fetch(params.get("catalog")!).then(response=>response.json());
const app:OfficialApp = catalog.apps.find((item:OfficialApp)=>item.id==="browser");
if(app?.desktop.runtime!=="downloaded") throw new Error("Browser candidate is unavailable");
const definition = await loadDesktopApp(app);
const errors:string[]=[];
let title="",handle="",surface:MistySurfaceAdapter|null=null;
const root=document.getElementById("a")!;
const tab=useWorkspaceStore.getState().openSurface({surfaceId:"official-app",groupKey:"app:browser",instanceKey:crypto.randomUUID(),title:"Browser",route:"/apps/browser",state:createBrowserTabState(location.origin+"/scripts/sdk-browser-page.html")});
const scope=createAppRpcScope({identity:{appId:"browser",accountId:`sdk-probe-${params.get("nonce")}`,instanceId:tab.id},scopes:app.scopes,expiresAt:new Date(Date.now()+60000).toISOString(),isCurrentAccount:()=>true});
const browser=createBrowserRpc(scope,createBrowserRpcBackend(scope,root,location.origin));
const ui=createAppUiRpc(scope,{settings:()=>({browser:{homeUrl:location.origin+"/scripts/sdk-browser-page.html",searchEngineIndex:0}}),setTitle:value=>{title=value;},subscribeSettings:()=>()=>{},registerShortcut:()=>()=>{},reportError:message=>errors.push(message),openExternal:async()=>{throw new Error("Probe cannot open external links");}});
const surfaces=createAppSurfaceBridge(scope,value=>{surface=value;});
let context:MistyComponentContext={instanceId:tab.id,route:"/apps/browser",active:true,focused:true,appearance:{mode:"dark"}};
const mounted=mountAppComponent({definition,root,scope,context,release:()=>{ui.close();surfaces.close();void browser.close();},transport:{registerSurface:surfaces.register,subscribe:(topic,listener)=>topic.startsWith("browser:")?browser.subscribe(topic,listener):ui.subscribe(topic,listener),async request(message){
 if(message.method==="lifecycle.ready")return;
 if(message.method.startsWith("browser.")){const value=await browser.request(message);if(message.method==="browser.create")handle=(value as {handle:string}).handle;return value;}
 return ui.request(message);
}}});
async function until(check:()=>boolean|Promise<boolean>,message:string){const end=Date.now()+10000;while(!await check()){if(errors.length)throw new Error(errors.join("; "));if(Date.now()>end)throw new Error(message);await new Promise(resolve=>setTimeout(resolve,40));}}
const inspect=()=>browser.request({method:"browser.inspect",params:{handle}}) as Promise<MistyBrowserInspection>;
const count=()=>invoke<number>("sdk_probe_browser_count",{nonce:params.get("nonce")});
let popup: { sourceId:string; url:string; tabId:string } | null = null;
const removePopup = await listen<{sourceId:string;url:string}>("misty://browser-popup", ({payload}) => {
 const opened = openBrowserPopup(payload);
 if(opened) popup={...payload,tabId:opened.id};
});
async function clickNamed(name:string) {
 const page=await inspect(); const item=page.interactive.find(item=>item.name===name);
 if(!item) throw new Error(`Missing native fixture control: ${name}`);
 await browser.request({method:"browser.click",params:{handle,documentId:page.documentId,elementRef:item.ref}});
}
async function checkProfile(accountId:string, expected:string) {
 const profileTab=useWorkspaceStore.getState().openBrowserTab({url:location.origin+"/scripts/sdk-browser-page.html"});
 const profileScope=createAppRpcScope({identity:{appId:"browser",accountId,instanceId:profileTab.id},scopes:app.scopes,expiresAt:new Date(Date.now()+60000).toISOString(),isCurrentAccount:()=>true});
 const rpc=createBrowserRpc(profileScope,createBrowserRpcBackend(profileScope,root,location.origin));
 let remove=()=>{};
 try {
  const created=await rpc.request({method:"browser.create",params:{bounds:{x:0,y:0,width:1000,height:480}}}) as {handle:string};
  let loaded=false;
  remove=await rpc.subscribe(`browser:${created.handle}`, event=>{
   const page=event as {type:string;phase?:string};
   if(page.type==="page"&&page.phase==="finished")loaded=true;
  });
  await until(()=>loaded,"Profile fixture page did not finish loading");
  await until(async()=>{
   const page=await rpc.request({method:"browser.inspect",params:{handle:created.handle}}) as MistyBrowserInspection;
   return page.text.includes(`Profile: ${expected}`);
  },`Native profile did not preserve/isolate storage: ${expected}`);
 } finally {remove();await rpc.close();profileScope.close();useWorkspaceStore.getState().closeTab(profileTab.id);}
}
let success=false,message="",stage="mount";
try{
 await mounted.ready;
 await until(()=>!!handle&&title==="SDK browser fixture","The downloaded Browser did not load its native page");
 if(await count()!==1)throw new Error("Browser did not own exactly one native child");
 const first=await inspect();
 if(!first.text.includes("Native Browser SDK fixture")||JSON.stringify(first).includes("do-not-expose-this"))throw new Error("Native inspection text or password filtering failed");
 const original=first.interactive.find(item=>item.name==="Original control")!;
 await browser.request({method:"browser.click",params:{handle,documentId:first.documentId,elementRef:original.ref}});
 const after=await inspect();
 if(!after.text.includes("Clicked original control"))throw new Error("SDK click did not activate the inspected native control");
 let staleDenied=false;try{await browser.request({method:"browser.click",params:{handle,documentId:first.documentId,elementRef:original.ref}});}catch{staleDenied=true;}
 if(!staleDenied)throw new Error("Stale native document was accepted");
 await browser.request({method:"browser.overlay",params:{handle,reason:"probe",active:true}});
 await browser.request({method:"browser.overlay",params:{handle,reason:"probe",active:false}});
 context={...context,active:false,focused:false};mounted.update(context);
 await new Promise(resolve=>setTimeout(resolve,120));
 context={...context,active:true,focused:true};mounted.update(context);
 await until(()=>!!surface,"Browser did not register its Misty surface");
 if(root.querySelector("iframe"))throw new Error("Browser used an iframe");
 stage="store profile"; await clickNamed("Store profile marker");
 stage="popup"; await clickNamed("Open popup fixture");
 await until(()=>!!popup,"Native popup did not reach the host");
 const openedPopup=popup! as {sourceId:string;url:string;tabId:string};
 const pane=dockLeaves(useWorkspaceStore.getState().layout.root).find(pane=>pane.tabs.some(item=>item.id===tab.id))!;
 if(pane.tabs[pane.tabs.findIndex(item=>item.id===tab.id)+1]?.id!==openedPopup.tabId)throw new Error("Popup was not adjacent to its source");
 if(await count()!==1)throw new Error("WebKit created an unmanaged popup child");
 useWorkspaceStore.getState().closeTab(openedPopup.tabId);useWorkspaceStore.getState().focusTab(tab.id);
 stage="download"; await clickNamed("Download fixture");
 await until(async()=>{
  const files=await invoke<string[]>("sdk_probe_downloads",{nonce:params.get("nonce")});
  return files.length===1&&files[0]==="Misty SDK native download fixture\n";
 },"Native download did not finish with the expected bytes");
 await mounted.close();await browser.close();
 useWorkspaceStore.getState().closeTab(tab.id);
 if(openBrowserPopup(openedPopup)!==null)throw new Error("Closed native source opened a ghost popup");
 stage="same-account profile"; await checkProfile(`sdk-probe-${params.get("nonce")}`,"profile-a");
 stage="other-account profile"; await checkProfile(`sdk-probe-other-${params.get("nonce")}`,"empty");
 await until(async()=>await count()===0,"Closing the component left a native browser child");
 await invoke("sdk_probe_tamper",{nonce:params.get("nonce")});
 if(await officialDesktopPackageReady(app))throw new Error("Modified Browser code passed verification");
 await loadDesktopApp(app);
 if(!await officialDesktopPackageReady(app))throw new Error("Browser repair failed");
 await uninstallOfficialDesktopPackage(app.id);
 if(await officialDesktopPackageReady(app))throw new Error("Browser uninstall left a verified package");
 if(errors.length)throw new Error(errors.join("; "));
 success=true;message="PASS: signed Browser download/install/import on macOS, native WKWebView page, SDK inspection/click, password filtering, stale-document rejection, overlay coordination, tab visibility lifecycle, AI surface, popup routing and closed-source rejection, native download bytes, same-account profile persistence and cross-account storage isolation, native cleanup, tamper rejection/repair and uninstall.";
}catch(error){message=`${stage}: ${String(error)}`;}
finally{removePopup();await mounted.close();await browser.close();}
document.getElementById("result")!.textContent=message;
await invoke("sdk_probe_complete",{nonce:params.get("nonce"),success,message});
