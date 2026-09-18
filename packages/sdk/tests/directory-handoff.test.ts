import { expect, it, vi } from "vitest";
import { createMistyAppSDK } from "../src/index.js";
const ticket = "11111111-1111-4111-8111-111111111111";
it("dispatches bounded directory handoffs without exposing host paths", async () => {
  const request = vi.fn(async ({method}: {method:string}) => method === "files.shareDirectory" ? {ticket,expiresInMs:60000} : method === "files.adoptDirectory" ? {handle:"new-handle",name:"Project",writable:true} : null);
  const sdk = createMistyAppSDK({request});
  expect(await sdk.files.shareDirectory("directory",{write:true})).toEqual({ticket,expiresInMs:60000});
  expect(await sdk.files.adoptDirectory(ticket,{write:true})).toEqual({handle:"new-handle",name:"Project",writable:true});
  await sdk.files.cancelDirectoryShare(ticket);
  expect(request.mock.calls.slice(1).map(([message]) => message)).toEqual([
    {method:"files.shareDirectory",params:{directory:"directory",write:true}},
    {method:"files.adoptDirectory",params:{ticket,write:true}},
    {method:"files.cancelDirectoryShare",params:{ticket}},
  ]);
});
it("rejects invalid tickets, ambient paths and malformed receipts", async () => {
  const request = vi.fn(async()=>null), sdk=createMistyAppSDK({request});
  await expect(sdk.files.adoptDirectory("/private/project")).rejects.toThrow();
  await expect(sdk.files.cancelDirectoryShare("")).rejects.toThrow();
  expect(request).toHaveBeenCalledTimes(1);
  request.mockResolvedValueOnce({handle:"h",name:"P",writable:true,nativePath:"/private"} as never);
  await expect(sdk.files.adoptDirectory(ticket)).rejects.toThrow();
});
