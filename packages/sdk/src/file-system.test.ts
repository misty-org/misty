import { expect, it, vi } from "vitest";
import { createFileSystemSDK } from "./file-system.js";
import type { MistyCall } from "./transport.js";
it("exposes native file and durable transfer operations through named SDK methods",async()=>{
 const request=vi.fn(async()=>({rows:[],totalCount:0,dbPath:"fixture"}));const files=createFileSystemSDK(request as MistyCall,{request});
 await files.transfers({limit:10});expect(request).toHaveBeenLastCalledWith("fileSystem.transfers",{filter:{limit:10}});
 await files.listDirectory({path:"/Volumes/Test",showHidden:false});expect(request).toHaveBeenLastCalledWith("fileSystem.listDirectory",{request:{path:"/Volumes/Test",showHidden:false}});
 await files.cancel(7);expect(request).toHaveBeenLastCalledWith("fileSystem.cancel",{operationId:7});
});
it("reports an unsupported host clearly instead of falling back to a reduced Files implementation",async()=>{
 const request=vi.fn();const files=createFileSystemSDK(request as MistyCall,{request});
 await expect(files.mountWorkspace({} as HTMLElement,{view:"explorer"})).rejects.toThrow("Update Misty");expect(request).not.toHaveBeenCalled();
});
