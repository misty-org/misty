import type { PreparedMediaChunk } from "../api/types";
import { managedAiRequest } from "./aiServerApi";

export interface MediaSearchHit { segmentId:string;assetId:string;mediaType:"audio"|"video";kind:"spoken"|"visual";content:string;transcript:string;visualDescription:string;startMs:number;endMs:number;visibleText:string[];score:number;semanticScore:number;lexicalScore:number; }
export interface MediaSearchResponse { hits: MediaSearchHit[]; }
export interface MediaChunkIndexResponse { status:"indexed";chunkIndex:number;segmentCount?:number;indexedThroughMs?:number;creditsUsed?:number;alreadyIndexed?:boolean; }

const basePath="/ai/media-search";
export function indexMediaChunk(chunk:PreparedMediaChunk):Promise<MediaChunkIndexResponse>{return managedAiRequest(`${basePath}/chunks`,{method:"POST",body:JSON.stringify(chunk)});}
export function searchMedia(query:string,limit=20):Promise<MediaSearchResponse>{return managedAiRequest(`${basePath}/search`,{method:"POST",body:JSON.stringify({query,limit})});}
export function fetchMediaSearchStatus():Promise<{assets:Array<{assetId:string;status:string;indexedThroughMs:number}>;maxDurationMinutes:number;totalDurationLimitMinutes:null}>{return managedAiRequest(`${basePath}/status`);}
