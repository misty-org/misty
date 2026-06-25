import { expect, it, vi } from "vitest";
import { createMistyAppSDK } from "@misty/sdk";
it("processes owned handles and rejects ambient paths and malformed output", async () => {
  const document = {documentId:"id",displayName:"Notes.txt",mimeType:"text/plain",sizeBytes:4,sections:[{kind:"text",locator:"L1",text:"note"}],truncated:false};
  const request = vi.fn(async () => document);
  const sdk = createMistyAppSDK({request});
  const options = {handle:"owned",displayName:"Notes.txt",extension:"txt"};
  expect(await sdk.documents.prepare(options)).toEqual(document);
  expect(request).toHaveBeenCalledWith({method:"documents.prepare",params:options});
  const calls = request.mock.calls.length;
  await expect(sdk.documents.prepare({...options,extension:"../txt"})).rejects.toThrow();
  await expect(sdk.documents.prepare({...options,displayName:"/etc/passwd"})).rejects.toThrow();
  expect(request).toHaveBeenCalledTimes(calls);
  request.mockResolvedValueOnce({...document,privatePath:"/private"} as typeof document);
  await expect(sdk.documents.prepare(options)).rejects.toThrow();
});
