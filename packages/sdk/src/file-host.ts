import { mistyFileHostContracts, MistyFileDropEventSchema, type MistyFileDropEvent, type MistyFileSource } from "@misty/contracts";
import type { MistyCall, MistyAppTransport } from "./transport.js";
export interface MistyFileHostSDK {
  subscribeDrop(listener:(event:MistyFileDropEvent)=>void):Promise<()=>void>;
  importDrop(tokens:string[],directory:string,operation?:"copy"|"move"):Promise<void>;
  sources(): Promise<readonly MistyFileSource[]>;
  openSource(sourceId: string, options?: {write?: boolean}): Promise<{handle: string; name: string; writable: boolean}>;
  manageSources(kind: "remote" | "device"): Promise<void>;
  unmountSource(sourceId: string): Promise<void>;
  previewImage(handle: string, maxDimension?: number): Promise<ArrayBuffer>;
  startDrag(handles: string[], mode?: "copy" | "move"): Promise<{dropped: boolean}>;
}
export function createFileHostSDK(call: MistyCall, transport: MistyAppTransport): MistyFileHostSDK {
  return Object.freeze({
    async subscribeDrop(listener:(event:MistyFileDropEvent)=>void) { if (!transport.subscribe) throw new Error("This runtime does not support file drops."); return transport.subscribe("files:drop",event=>listener(MistyFileDropEventSchema.parse(event))); },
    async importDrop(tokens:string[],directory:string,operation:"copy"|"move"="copy") { const c=mistyFileHostContracts["files.drop.import"]; return c.result.parse(await call("files.drop.import",c.params.parse({tokens,directory,operation}))); },
    async sources() { const c = mistyFileHostContracts["files.sources.list"]; return c.result.parse(await call("files.sources.list", c.params.parse({}))); },
    async openSource(sourceId: string, options: {write?: boolean} = {}) { const c = mistyFileHostContracts["files.sources.open"]; return c.result.parse(await call("files.sources.open", c.params.parse({sourceId, ...options}))); },
    async manageSources(kind: "remote" | "device") { const c = mistyFileHostContracts["files.sources.manage"]; return c.result.parse(await call("files.sources.manage", c.params.parse({kind}))); },
    async unmountSource(sourceId: string) { const c = mistyFileHostContracts["files.sources.unmount"]; return c.result.parse(await call("files.sources.unmount", c.params.parse({sourceId}))); },
    async previewImage(handle: string, maxDimension = 1024) { const c = mistyFileHostContracts["files.previewImage"]; return c.result.parse(await call("files.previewImage", c.params.parse({handle, maxDimension}))); },
    async startDrag(handles: string[], mode: "copy" | "move" = "copy") { const c = mistyFileHostContracts["files.drag.start"]; return c.result.parse(await call("files.drag.start", c.params.parse({handles, mode}))); },
  });
}
