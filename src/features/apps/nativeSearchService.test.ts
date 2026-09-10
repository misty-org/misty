import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {invokeFilesSearch} from "./nativeSearchService";
const f=vi.hoisted(()=>({invoke:vi.fn(),service:vi.fn(),space:"family",closed:false}));
vi.mock("@tauri-apps/api/core",()=>({invoke:f.invoke}));
vi.mock("./useAppsStore",()=>({useAppsStore:{getState:()=>({spaceId:f.space})}}));
vi.mock("./nativeDocumentService",()=>({withNativeDocumentService:f.service}));
beforeEach(()=>{
 vi.useFakeTimers();vi.clearAllMocks();f.space="family";f.closed=false;
 f.service.mockImplementation(async (_app:string,_space:string,run:(instance:string)=>Promise<unknown>)=>{try{return await run("owned");}finally{f.closed=true;}});
});
afterEach(()=>vi.useRealTimers());
it("keeps originating Space authority until the background scan completes",async()=>{
 f.invoke.mockResolvedValueOnce({scanInProgress:true}).mockResolvedValueOnce({scanInProgress:true}).mockResolvedValueOnce({scanInProgress:false});
 expect(await invokeFilesSearch("search_start_scan",{request:{roots:["/approved"]}})).toEqual({scanInProgress:true});
 expect(f.closed).toBe(false);f.space="work";
 await vi.advanceTimersByTimeAsync(500);expect(f.closed).toBe(false);
 await vi.advanceTimersByTimeAsync(500);expect(f.closed).toBe(true);
 expect(f.service).toHaveBeenCalledWith("files","family",expect.any(Function),undefined,"search");
 expect(f.invoke).toHaveBeenLastCalledWith("search_get_status",{instance:"owned"});
});
it("rejects startup failures and scopes queries through the installed app",async()=>{
 f.invoke.mockRejectedValueOnce(new Error("Missing signed worker"));
 await expect(invokeFilesSearch("search_start_scan")).rejects.toThrow("Missing signed worker");
 f.invoke.mockResolvedValueOnce([]);
 expect(await invokeFilesSearch("search_query",{request:{query:"photo"}})).toEqual([]);
 expect(f.invoke).toHaveBeenLastCalledWith("search_query",{request:{query:"photo"},instance:"owned"});
});
