import { beforeEach, expect, it, vi } from "vitest";
import { useSmartLibraryStore } from "./useSmartLibraryStore";
const f = vi.hoisted(()=>({space:"family",previews:vi.fn(),prepare:vi.fn(),plan:vi.fn()}));
vi.mock("@/features/apps/useAppsStore",()=>({useAppsStore:{getState:()=>({spaceId:f.space})}}));
vi.mock("@/features/files/explorer",()=>({clearSemanticExplorerSearchCache:vi.fn()}));
vi.mock("@/features/files/native",()=>({smartLibraryPreparePreviews:f.previews}));
vi.mock("./smartLibraryHelpers",()=>({
  bytesToBase64:()=>"",
  loadAssetsByIds:async()=>[{assetId:"asset",status:"pending"}],
  prepareSemanticReindexInputs:f.prepare,
}));
vi.mock("./useSmartLibraryServerStore",()=>({
  fetchSmartLibraryProgress:async()=>{f.space="work";return {sampleAssetIds:["asset"],phase:"complete"};},
  candidatesFromAssets:(assets:unknown)=>assets,
  createSmartLibrarySample:async()=>({assetIds:["asset"]}),
  approveSmartLibrarySample:async()=>({phase:"complete"}),
  planSemanticReindex:f.plan,
  completeSemanticReindex:async()=>{},
}));
beforeEach(()=>{
  vi.clearAllMocks();f.space="family";
  f.previews.mockResolvedValue([{assetId:"asset",bytes:[],metadata:{},truncated:false}]);
  f.prepare.mockResolvedValue([{assetId:"asset"}]);
  useSmartLibraryStore.setState({library:{serverFolderId:"folder",preflight:{sampleAssetIds:["asset"]}} as never,refreshProgress:async()=>{},reindexPlan:null,error:null});
});
it("keeps the initiating Space while preparing a Library sample",async()=>{
  await useSmartLibraryStore.getState().trySample();
  expect(useSmartLibraryStore.getState().error).toBeNull();
  expect(f.space).toBe("work");
  expect(f.previews).toHaveBeenCalledWith(["asset"],512,"family");
});
it("keeps the initiating Space through asynchronous reindex planning",async()=>{
  f.plan.mockImplementation(async()=>{f.space="work";return {jobId:"job",assets:[{assetId:"asset"}]};});
  await useSmartLibraryStore.getState().upgradeIndex();
  expect(useSmartLibraryStore.getState().error).toBeNull();
  expect(f.prepare.mock.calls[0][2]).toBe("family");
});
