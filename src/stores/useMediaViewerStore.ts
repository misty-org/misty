import { create } from "zustand";
import type { SearchResult } from "../api/types";
interface MediaViewerState { result:SearchResult|null;open:(result:SearchResult)=>void;close:()=>void; }
export const useMediaViewerStore=create<MediaViewerState>((set)=>({result:null,open:(result)=>set({result}),close:()=>set({result:null})}));
