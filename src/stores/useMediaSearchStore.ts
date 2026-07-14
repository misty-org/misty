import { create } from "zustand";
import { mediaSearchComplete, mediaSearchPrepareChunk, mediaSearchScanMovies, mediaSearchSnapshot } from "../api/misty";
import type { MediaAsset, MediaSearchSnapshot } from "../api/types";
import { clearSemanticExplorerSearchCache } from "../pages/Files/utils/globalSearch";
import { indexMediaChunk } from "./mediaSearchServerApi";

interface MediaSearchState { loaded:boolean;loading:boolean;indexingAssetId:string|null;progress:number;error:string|null;snapshot:MediaSearchSnapshot|null;load:()=>Promise<void>;scan:()=>Promise<void>;indexAsset:(asset:MediaAsset)=>Promise<void>;indexEligible:()=>Promise<void>; }
export const useMediaSearchStore=create<MediaSearchState>((set,get)=>({loaded:false,loading:false,indexingAssetId:null,progress:0,error:null,snapshot:null,
  load:async()=>{try{set({loading:true,error:null});const snapshot=await mediaSearchSnapshot();set({snapshot,loaded:true,loading:false});}catch(reason){set({loaded:true,loading:false,error:errorText(reason)});}},
  scan:async()=>{try{set({loading:true,error:null});const snapshot=await mediaSearchScanMovies();set({snapshot,loaded:true,loading:false});}catch(reason){set({loading:false,error:errorText(reason)});}},
  indexAsset:async(asset)=>{if(asset.status==="unsupported")return;const chunks=mediaChunkCount(asset.durationMs);try{set({indexingAssetId:asset.assetId,progress:0,error:null});for(let index=0;index<chunks;index+=1){const chunk=await mediaSearchPrepareChunk(asset.assetId,index);await indexMediaChunk(chunk);set({progress:(index+1)/chunks});}const snapshot=await mediaSearchComplete(asset.assetId,asset.fingerprint);clearSemanticExplorerSearchCache();set({snapshot,indexingAssetId:null,progress:1});}catch(reason){try{const snapshot=await mediaSearchComplete(asset.assetId,asset.fingerprint,"index_failed");set({snapshot});}catch{}set({indexingAssetId:null,error:errorText(reason)});throw reason;}},
  indexEligible:async()=>{for(const asset of get().snapshot?.assets??[]){if(asset.status!=="unsupported"&&asset.indexedFingerprint!==asset.fingerprint)await get().indexAsset(asset);}},
}));
function errorText(reason:unknown){return reason instanceof Error?reason.message:String(reason);}
function mediaChunkCount(durationMs:number){const full=Math.floor(durationMs/30_000);const remainder=durationMs%30_000;return remainder===0?full:remainder<5_000&&full>0?full:full+1;}
