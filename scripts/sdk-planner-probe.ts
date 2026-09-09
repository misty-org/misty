import { invoke } from "@tauri-apps/api/core";
import { loadDesktopApp } from "../src/features/apps/desktopAppLoader";
import { officialDesktopPackageReady, uninstallOfficialDesktopPackage } from "../src/features/apps/desktopPackages";
import { executeAppCapability } from "../src/features/apps/appCapabilityGateway";
import { createAppRpcScope } from "../src/features/apps/rpc/session";
import { createServerRpc } from "../src/features/apps/rpc/server";
import { createAppUiRpc } from "../src/features/apps/rpc/appUi";
import { createAppSurfaceBridge } from "../src/features/apps/rpc/surface";
import { subscribeAppDataChanges } from "../src/features/apps/rpc/dataEvents";
import { mountAppComponent } from "../src/features/apps/rpc/component";
import { isMistyServerMethod, type MistyComponentContext, type MistySurfaceAdapter, type SpaceTask, type SpaceRoadmapSnapshot } from "@misty/sdk";
import type { OfficialApp } from "../src/api/apps/api";

const params = new URLSearchParams(location.search);
const catalog = await fetch(params.get("catalog") || "/official-apps/catalog.json").then(response => response.json());
const app: OfficialApp = catalog.apps.find((item: OfficialApp) => item.id === "planner");
if (app?.desktop.runtime !== "downloaded") throw new Error("The candidate Planner package is unavailable");
const definition = await loadDesktopApp(app);
const errors: string[] = [];
const mounts: ReturnType<typeof instance>[] = [];
function instance(id: string) {
  const root = document.getElementById(id)!;
  const spaceId = `space-${id}`;
  const scope = createAppRpcScope({identity:{appId:"planner", accountId:"sdk-probe", spaceId, instanceId:id},scopes:app.scopes,expiresAt:new Date(Date.now()+60000).toISOString(),isCurrentAccount:()=>true});
  const timestamp = new Date().toISOString();
  const space = {id:spaceId,security_domain_id:"probe-domain",owner_user_id:"sdk-probe",name:spaceId,is_default:false,role:"owner",member_count:1,pending_count:0,is_shared:false,permissions:{"tasks.manage":true},created_at:timestamp,updated_at:timestamp};
  const task = (title:string):SpaceTask => ({id:`task-${id}-${tasks.length}`,space_id:spaceId,task_number:tasks.length+1,task_key:`TASK-${tasks.length+1}`,title,notes:"",status:"todo",priority:"medium",rank:1024,due_timezone:"UTC",source_refs:[],audience_kind:"space",version:1,created_at:timestamp,updated_at:timestamp});
  const tasks: SpaceTask[] = [];
  tasks.push(task(`Task for ${spaceId}`));
  const graph:SpaceRoadmapSnapshot = {roadmap:{id:`map-${id}`,space_id:spaceId,name:`Roadmap for ${spaceId}`,description:"SDK fixture",graph_version:1,created_by_user_id:"sdk-probe",audience_kind:"space",created_at:timestamp,updated_at:timestamp},milestones:[],goals:[],nodes:[],node_definitions:[],edges:[],goal_total:0,goal_done:0,milestone_total:0,milestone_done:0,progress_percentage:0};
  let loads = 0;
  const server = createServerRpc(scope,{serverBase:location.origin+"/sdk-probe",readAppSession:()=>({appId:"planner",spaceId,token:"host-only-probe"}),fetch:async (_url,init)=>{
    const {method,params:input}=JSON.parse(String(init?.body));
    let result:unknown;
    if(method==="spaces.get") result=space;
    else if(method==="spaces.members.list") result={members:[],agents:[]};
    else if(method==="tasks.list") {loads++;result={tasks,status_totals:{todo:tasks.length,in_progress:0,done:0,canceled:0}};}
    else if(method==="tasks.create") {const next=task(input.body.title);tasks.push(next);result=next;}
    else if(method==="agenda.list") result={entries:[]};
    else if(method==="calendar.sources.list") result={sources:[]};
    else if(method==="integrations.list") result={integrations:[]};
    else if(method==="connections.list") result={connections:[]};
    else if(method==="roadmaps.list") result={roadmaps:[graph.roadmap]};
    else if(method==="roadmaps.get") result=graph;
    else throw new Error(`Unexpected fixture method: ${method}`);
    return new Response(JSON.stringify(result));
  }});
  const commands=new Map<string,()=>void>();
  let title="";
  let surface:MistySurfaceAdapter|null=null;
  const surfaces=createAppSurfaceBridge(scope,value=>{surface=value;});
  const ui=createAppUiRpc(scope,{settings:()=>({shortcutLabels:{"planner.create":"C","roadmap.undo":"⌘Z"}}),setTitle:value=>{title=value;},subscribeSettings:()=>()=>{},registerShortcut:(command,listener)=>{commands.set(command,listener);return()=>commands.delete(command);},subscribeData:(domain,listener)=>subscribeAppDataChanges(scope,domain,listener),reportError:message=>errors.push(message),openExternal:async()=>{throw new Error("Probe cannot open external links");},confirm:async()=>false});
  let context:MistyComponentContext={instanceId:id,active:true,focused:id==="a",appearance:{mode:"dark"},route:`/apps/planner?space=${spaceId}&view=tasks&taskView=list`};
  const session={app_id:"planner",space_id:spaceId,scopes:app.scopes,token:"host-only-probe",expires_at:"2099-01-01T00:00:00Z",sdk_base_url:"/app-runtime"};
  const mounted=mountAppComponent({definition,root,scope,context,release:()=>{ui.close();server.close();surfaces.close();},transport:{registerSurface:surfaces.register,subscribe:ui.subscribe,request(message){
    if(message.method==="lifecycle.ready")return Promise.resolve();
    if(isMistyServerMethod(message.method))return server.request(message);
    if(message.method==="context.get"||message.method.startsWith("storage.")||message.method.startsWith("navigation."))return executeAppCapability({app,session,space:space as never,user:{id:"sdk-probe",name:"SDK Probe",email:"probe@invalid"},serverBase:location.origin+"/sdk-probe",platform:"desktop",signal:scope.signal,navigate:route=>{context={...context,route};mounted.update(context);}},message.method,message.params);
    return ui.request(message);
  }}});
  const item={root,scope,mounted,commands,tasks,loads:()=>loads,title:()=>title,surface:()=>surface,route:(view:string,extra="")=>{context={...context,route:`/apps/planner?space=${spaceId}&view=${view}${extra}`};mounted.update(context);}};
  mounts.push(item);return item;
}
async function until(check:()=>boolean,message:string){const end=Date.now()+10000;while(!check()){if(errors.length)throw new Error(errors.join("; "));if(Date.now()>end)throw new Error(message);await new Promise(resolve=>setTimeout(resolve,40));}}
let success=false,message="";
try {
  const a=instance("a"),b=instance("b");
  await Promise.all([a.mounted.ready,b.mounted.ready]);
  await until(()=>a.root.textContent!.includes("Task for space-a")&&b.root.textContent!.includes("Task for space-b"),"Task screens did not render SDK data");
  if(a.root.textContent!.includes("Task for space-b"))throw new Error("Task data crossed Space roots");
  a.commands.get("planner.create")?.();
  await until(()=>Boolean(document.getElementById("space-task-title")),"Planner shortcut did not open task creation");
  const input=document.getElementById("space-task-title") as HTMLInputElement;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,"Created through downloaded SDK");
  input.dispatchEvent(new Event("input",{bubbles:true}));
  await until(()=>!input.closest("form")!.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled,"Task title did not update");
  input.closest("form")!.requestSubmit();
  await until(()=>a.root.textContent!.includes("Created through downloaded SDK"),"Downloaded UI did not create a task through RPC");
  if(b.tasks.length!==1)throw new Error("Task creation changed the other Space");
  a.route("agenda","&agendaView=month");
  await until(()=>Boolean(a.root.querySelector('main[aria-label="month agenda"]')),"Agenda did not open");
  a.route("roadmaps");
  await until(()=>a.root.textContent!.includes("My Roadmaps"),"Roadmap home did not open");
  a.route("roadmaps","&roadmap=map-a");
  await until(()=>Boolean(a.root.querySelector(".react-flow"))&&a.title()==="Roadmap for space-a","Roadmap canvas did not mount");
  if(a.root.querySelector("iframe")||b.root.querySelector("iframe"))throw new Error("Planner used an iframe");
  await a.mounted.close();
  if(a.root.childElementCount||a.commands.size)throw new Error("Closing Planner left DOM or shortcuts");
  const before=b.loads();
  window.dispatchEvent(new CustomEvent("misty:space-coordination-event",{detail:{space_id:"space-b",type:"task.updated"}}));
  await until(()=>b.loads()>before,"The other Planner stopped receiving updates");
  await b.mounted.close();
  await invoke("sdk_probe_tamper",{nonce:params.get("nonce")});
  if(await officialDesktopPackageReady(app))throw new Error("Modified Planner code passed verification");
  await loadDesktopApp(app);
  if(!await officialDesktopPackageReady(app))throw new Error("Planner package repair failed");
  const reopened=instance("a");await reopened.mounted.ready;
  await until(()=>reopened.root.textContent!.includes("Task for space-a"),"Planner did not reopen after repair");
  await reopened.mounted.close();
  await uninstallOfficialDesktopPackage(app.id);
  if(await officialDesktopPackageReady(app))throw new Error("Planner uninstall left a verified package");
  if(errors.length)throw new Error(errors.join("; "));
  success=true;message="PASS: signed Planner download/install/import on macOS; two isolated Space roots, SDK task creation, Agenda, Roadmap canvas, shortcuts/titles, live refresh, cleanup, tamper rejection/repair, reopen and uninstall. Business responses use an isolated RPC fixture.";
}catch(error){message=error instanceof Error?error.message:String(error);}
finally{await Promise.allSettled(mounts.map(item=>item.mounted.close()));}
document.getElementById("result")!.textContent=message;
await invoke("sdk_probe_complete",{nonce:params.get("nonce"),success,message});
