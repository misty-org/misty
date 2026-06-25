import { expect, it, vi } from "vitest";
import { createMistyAppSDK, commandsForApp } from "@misty/sdk";
it("validates Code controls and unsaved state before crossing the host boundary", async () => {
  const request = vi.fn(async ({method}:{method:string}) => method === "code.rewrite" ? "replacement" : undefined);
  const sdk = createMistyAppSDK({request});
  await sdk.workspace.setUnsavedChanges(true);
  expect(request).toHaveBeenLastCalledWith({method:"workspace.dirty.set",params:{dirty:true}});
  await expect(sdk.code.updatePreference({key:"font_size",value:100})).rejects.toThrow();
  await expect(sdk.code.rewrite({requestId:"bad",instruction:"change",selection:"code",filename:"a.ts",language:"ts"})).rejects.toThrow();
  expect(commandsForApp("code")).toContain("code.save");
  await sdk.code.toggleTerminal("down");
  expect(request).toHaveBeenLastCalledWith({method:"code.terminal.toggle",params:{placement:"down"}});
});
