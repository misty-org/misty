import {expect,it,vi} from "vitest";
import {createMistyAppSDK} from "../packages/sdk/src/index.js";
const bookmarkId="11111111-1111-4111-8111-111111111111";
it("remembers/reopens/forgets opaque folders with bounded typed receipts",async()=>{
 const request=vi.fn(async({method}:{method:string})=>method==="files.rememberDirectory"?{bookmarkId,name:"Project",writable:true}:method==="files.reopenDirectory"?{handle:"fresh",name:"Project",writable:false}:null);
 const sdk=createMistyAppSDK({request});
 expect(await sdk.files.rememberDirectory("chosen",{write:true})).toEqual({bookmarkId,name:"Project",writable:true});
 expect(await sdk.files.reopenDirectory(bookmarkId)).toEqual({handle:"fresh",name:"Project",writable:false});
 await sdk.files.forgetDirectory(bookmarkId);
 expect(request.mock.calls.slice(1).map(([message])=>message)).toEqual([
  {method:"files.rememberDirectory",params:{directory:"chosen",write:true}},
  {method:"files.reopenDirectory",params:{bookmarkId,write:false}},
  {method:"files.forgetDirectory",params:{bookmarkId}},
 ]);
});
it("rejects ambient IDs and native bookmark material in responses",async()=>{
 const request=vi.fn(async()=>null),sdk=createMistyAppSDK({request});
 await expect(sdk.files.reopenDirectory("/Users/private")).rejects.toThrow();
 await expect(sdk.files.forgetDirectory("")).rejects.toThrow();
 expect(request).toHaveBeenCalledTimes(1);
 request.mockResolvedValueOnce({bookmarkId,name:"P",writable:true,bookmarkBytes:"private"} as never);
 await expect(sdk.files.rememberDirectory("h")).rejects.toThrow();
});

it("lists only bounded public folder receipts and sends no ambient selection",async()=>{
 const saved={bookmarkId,name:"Project",writable:false};
 const request=vi.fn(async()=>[saved]), sdk=createMistyAppSDK({request});
 expect(await sdk.files.listSavedDirectories()).toEqual([saved]);
 expect(request).toHaveBeenLastCalledWith({method:"files.listSavedDirectories",params:{}});
 request.mockResolvedValueOnce([{...saved,identity:{inode:99}}] as never);
 await expect(sdk.files.listSavedDirectories()).rejects.toThrow();
 request.mockResolvedValueOnce(Array(33).fill(saved));
 await expect(sdk.files.listSavedDirectories()).rejects.toThrow();
 request.mockResolvedValueOnce([{...saved,bookmarkId:"/Users/private"}]);
 await expect(sdk.files.listSavedDirectories()).rejects.toThrow();
});
