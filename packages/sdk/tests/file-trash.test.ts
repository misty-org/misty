import { expect, it, vi } from "vitest";
import { createMistyAppSDK } from "@misty/sdk";
import { mistyDirectoryContracts } from "@misty/contracts";
it("opens only the host-scoped persistent Trash and validates its directory grant", async () => {
  const request = vi.fn(async ({method}: {method: string}): Promise<unknown> => method === "lifecycle.ready" ? undefined : {handle:"trash-grant", name:"Trash", writable:true});
  const sdk = createMistyAppSDK({request});
  expect(await sdk.files.openTrash()).toEqual({handle:"trash-grant", name:"Trash", writable:true});
  expect(request.mock.calls.some(([call]) => call.method === "files.openTrash")).toBe(true);
  expect(mistyDirectoryContracts["files.openTrash"].params.safeParse({owner:"another-user"}).success).toBe(false);
  request.mockImplementation(async () => ({handle:"wrong", name:"Trash", writable:false}));
  await expect(sdk.files.openTrash()).rejects.toThrow();
});
