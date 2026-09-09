import {expect,it,vi} from "vitest";
const f=vi.hoisted(()=>({listener:undefined as undefined|((s:any,p:any)=>void),query:vi.fn()}));
vi.mock("@/features/apps/useAppsStore",()=>({useAppsStore:{subscribe:(listener:any)=>{f.listener=listener;return ()=>{};}}}));
vi.mock("@/features/files/explorer",()=>({
 clearSemanticExplorerSearchCache:vi.fn(),mergeHybridSearchResults:(a:any)=>a,mergeLibrarySearchResults:(a:any)=>a,
 queryIndexedExplorerSearch:f.query,querySemanticExplorerSearch:vi.fn().mockResolvedValue([]),semanticQueryMinimumCharacters:100,
 semanticSearchDebounceMs:10,useExplorerStore:{getState:()=>({})}
}));
vi.mock("@/features/files/native",()=>({searchCancelScan:vi.fn(),searchGetStatus:vi.fn(),searchInit:vi.fn(),searchStartScan:vi.fn()}));
vi.mock("@/features/settings",()=>({selectSearchMaintenancePreferences:vi.fn(),useSettingsStore:{getState:()=>({})}}));
import {useSearchStore} from "../../../../misty-apps/apps/files/workspace/search/store/useSearchStore";
it("clears retained results and rejects a late query after changing Space",async()=>{
 let resolve!:(results:any[])=>void;
 f.query.mockImplementation(()=>new Promise(done=>{resolve=done;}));
 useSearchStore.setState({open:true,query:"family",results:[{entry:{name:"private"}}] as any,initialized:true,status:{indexedItemCount:1} as any});
 const pending=useSearchStore.getState().executeSearch();
 f.listener?.({spaceId:"work"},{spaceId:"family"});
 expect(useSearchStore.getState()).toMatchObject({open:false,query:"",results:[],initialized:false,status:null});
 resolve([{entry:{name:"private"}}]);await pending;
 expect(useSearchStore.getState().results).toEqual([]);
});
