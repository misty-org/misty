import { beforeEach, expect, it, vi } from "vitest";
import { withNativeDocumentService } from "./nativeDocumentService";
const f = vi.hoisted(() => ({
  invoke:vi.fn(), installations:vi.fn(), session:vi.fn(), ready:vi.fn(), install:vi.fn(),
  account:vi.fn(), listener:undefined as undefined | ((s:any)=>void), unsubscribe:vi.fn(),
}));
vi.mock("@tauri-apps/api/core",()=>({invoke:f.invoke}));
vi.mock("@/api/apps",()=>({appsApi:{installations:f.installations,createSession:f.session}}));
vi.mock("@/api/deployment/api",()=>({resolveApiBase:async()=>"https://api.test/v1"}));
vi.mock("@/api/client",()=>({readApiSessionGeneration:()=>1,assertStableApiSession:()=>{}}));
vi.mock("@/features/auth/runtimeSession",()=>({readActiveSavedAccountSession:f.account,accountScopeResetEvent:"test-reset"}));
vi.mock("./desktopPackages",()=>({officialDesktopPackageReady:f.ready,installOfficialDesktopPackage:f.install}));
vi.mock("./useAppsStore",()=>({useAppsStore:{getState:()=>({catalog:[]}),subscribe:(listener:any)=>{f.listener=listener;return f.unsubscribe;}}}));
const app = {id:"library",version:"1",scopes:["files.read"],desktop:{sha256:"hash"}};
const installed = {app_id:"library",space_id:"space",state:"installed",installed_version:"1",authority_generation:2,granted_scopes:["files.read"],release_metadata:app};
beforeEach(()=>{
  vi.clearAllMocks();
  f.account.mockReturnValue({id:"member"});
  f.installations.mockResolvedValue({apps:[installed]});
  f.session.mockResolvedValue({authority_generation:2,app_id:"library",space_id:"space",scopes:["files.read"],expires_at:new Date(Date.now()+60000).toISOString()});
  f.ready.mockResolvedValue(true);
  f.invoke.mockImplementation(async (method:string)=>method==="mini_widget_open"?"instance":method==="official_app_package_path"?"/verified":undefined);
});
it("uses the installed release and closes the native session after work",async()=>{
  const run=vi.fn(async()=>"document");
  expect(await withNativeDocumentService("library","space",run)).toBe("document");
  expect(run).toHaveBeenCalledWith("instance");
  expect(f.invoke).toHaveBeenCalledWith("mini_widget_open",{request:{root:"/verified",owner:{accountId:"member",spaceId:"space",deployment:"https://api.test/v1",authorityGeneration:2},scopeLimit:["files.read"]}});
  expect(f.invoke).toHaveBeenCalledWith("mini_app_close",{instance:"instance"});
  expect(f.install).not.toHaveBeenCalled();
  expect(f.unsubscribe).toHaveBeenCalled();
});
it("does not install an excluded app or accept another Space session",async()=>{
  f.installations.mockResolvedValueOnce({apps:[]});
  await expect(withNativeDocumentService("library","space",vi.fn())).rejects.toThrow("Add Library");
  expect(f.invoke).not.toHaveBeenCalled();
  f.session.mockResolvedValueOnce({app_id:"library",space_id:"other",scopes:["files.read"]});
  await expect(withNativeDocumentService("library","space",vi.fn())).rejects.toThrow("does not have file access");
  expect(f.invoke).not.toHaveBeenCalled();
});
it("fetches only the selected installed package and verifies it before opening",async()=>{
  f.ready.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  await withNativeDocumentService("library","space",async()=>"done");
  expect(f.install).toHaveBeenCalledWith(app, true);
  expect(f.ready).toHaveBeenCalledTimes(2);
});
it("discards results when server authority changed during processing",async()=>{
  const run=async()=>{f.installations.mockResolvedValueOnce({apps:[{...installed,authority_generation:3}]});return "private text";};
  await expect(withNativeDocumentService("library","space",run)).rejects.toThrow("access changed");
  expect(f.invoke).toHaveBeenCalledWith("mini_app_close",{instance:"instance"});
});
it("stops in-flight native work on removal and caller cancellation",async()=>{
  await expect(withNativeDocumentService("library","space",async()=>{
    f.listener?.({bySpace:{space:[]}});
    return new Promise(()=>{});
  })).rejects.toThrow("access changed");
  expect(f.invoke).toHaveBeenCalledWith("mini_app_close",{instance:"instance"});
  const abort = new AbortController();
  await expect(withNativeDocumentService("library","space",async()=>{
    abort.abort(); return new Promise(()=>{});
  },abort.signal)).rejects.toThrow("access changed");
});
it("uses Files for background document work without an Agents installation",async()=>{
  const files = {...app,id:"files"};
  f.installations.mockResolvedValue({apps:[{...installed,app_id:"files",release_metadata:files}]});
  f.session.mockResolvedValue({app_id:"files",space_id:"space",scopes:["files.read"],expires_at:new Date(Date.now()+60000).toISOString()});
  expect(await withNativeDocumentService("files","space",async()=>"text")).toBe("text");
  expect(f.session).toHaveBeenCalledWith("files","space",2);
});

it("shares concurrent authority reads without caching the next operation", async () => {
  let resolve!: (value: unknown) => void;
  f.installations.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const operations = Array.from({ length: 10 }, () => withNativeDocumentService("library", "space", async () => "done"));
  await Promise.resolve();
  expect(f.installations).toHaveBeenCalledTimes(1);
  resolve({ apps: [installed] });
  await Promise.all(operations);
  const before = f.installations.mock.calls.length;
  await withNativeDocumentService("library", "space", async () => "done");
  expect(f.installations.mock.calls.length).toBeGreaterThan(before);
});
