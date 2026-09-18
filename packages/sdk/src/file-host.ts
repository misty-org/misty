import type {MistyFileIndexRequest, MistyFileIndexResult} from "@misty/contracts";
export type {MistyFileIndexRequest, MistyFileIndexResult, MistyFileIndexDocument} from "@misty/contracts";
import { mistyFileHostContracts, MistyFileDropEventSchema, type MistyFileDropEvent, type MistyFileSource } from "@misty/contracts";
import type { MistyCall, MistyAppTransport } from "./transport.js";
export interface MistyFileHostSDK {
  shareSource(directory: string, shared: boolean): Promise<void>;
  index(request: MistyFileIndexRequest): Promise<MistyFileIndexResult>;
  subscribeDrop(listener:(event:MistyFileDropEvent)=>void):Promise<()=>void>;
  importDrop(tokens:string[],directory:string,operation?:"copy"|"move"):Promise<void>;
  restoreLocation(): Promise<{sourceId: string; relative: string[]} | {unavailable: true} | {virtual: "trash" | "recent" | "starred"} | null>;
  resolveLocation(path: string): ReturnType<MistyFileHostSDK["restoreLocation"]>;
  sources(): Promise<readonly MistyFileSource[]>;
  openSource(sourceId: string, options?: {write?: boolean}): Promise<{handle: string; name: string; writable: boolean}>;
  manageSources(kind: "remote" | "device"): Promise<void>;
  unmountSource(sourceId: string): Promise<void>;
  /** A host-resolved media URL for a file owned by this app instance. */
  previewUrl(handle: string): Promise<string>;
  previewImage(handle: string, maxDimension?: number): Promise<ArrayBuffer>;
  startDrag(handles: string[], mode?: "copy" | "move"): Promise<{dropped: boolean}>;
}
export function createFileHostSDK(call: MistyCall, transport: MistyAppTransport): MistyFileHostSDK {
  return Object.freeze({
    async shareSource(directory: string, shared: boolean) { const c=mistyFileHostContracts["files.sources.share"]; c.result.parse(await call("files.sources.share", c.params.parse({directory, shared}))); },
    async index(request: MistyFileIndexRequest) { const c=mistyFileHostContracts["files.index"]; return c.result.parse(await call("files.index", c.params.parse(request))); },
    async subscribeDrop(listener:(event:MistyFileDropEvent)=>void) { if (!transport.subscribe) throw new Error("This runtime does not support file drops."); return transport.subscribe("files:drop",event=>listener(MistyFileDropEventSchema.parse(event))); },
    async importDrop(tokens:string[],directory:string,operation:"copy"|"move"="copy") { const c=mistyFileHostContracts["files.drop.import"]; return c.result.parse(await call("files.drop.import",c.params.parse({tokens,directory,operation}))); },
    async restoreLocation() { const c = mistyFileHostContracts["files.sources.restoreLocation"]; return c.result.parse(await call("files.sources.restoreLocation", c.params.parse({}))); },
    async resolveLocation(path: string) { const c = mistyFileHostContracts["files.sources.resolveLocation"]; return c.result.parse(await call("files.sources.resolveLocation", c.params.parse({path}))); },
    async sources() { const c = mistyFileHostContracts["files.sources.list"]; return c.result.parse(await call("files.sources.list", c.params.parse({}))); },
    async openSource(sourceId: string, options: {write?: boolean} = {}) { const c = mistyFileHostContracts["files.sources.open"]; return c.result.parse(await call("files.sources.open", c.params.parse({sourceId, ...options}))); },
    async manageSources(kind: "remote" | "device") { const c = mistyFileHostContracts["files.sources.manage"]; return c.result.parse(await call("files.sources.manage", c.params.parse({kind}))); },
    async unmountSource(sourceId: string) { const c = mistyFileHostContracts["files.sources.unmount"]; return c.result.parse(await call("files.sources.unmount", c.params.parse({sourceId}))); },
    async previewUrl(handle: string) { const c = mistyFileHostContracts["files.previewUrl"]; return c.result.parse(await call("files.previewUrl", c.params.parse({handle}))); },
    async previewImage(handle: string, maxDimension = 1024) { const c = mistyFileHostContracts["files.previewImage"]; return c.result.parse(await call("files.previewImage", c.params.parse({handle, maxDimension}))); },
    async startDrag(handles: string[], mode: "copy" | "move" = "copy") { const c = mistyFileHostContracts["files.drag.start"]; return c.result.parse(await call("files.drag.start", c.params.parse({handles, mode}))); },
  });
}
