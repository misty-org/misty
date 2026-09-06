import { expect, it } from "vitest";
import { socialApi, useSocialSpaces } from "../spaces/chat/socialRuntime";
import { libraryApi, useLibrarySpaces } from "../spaces/library/libraryRuntime";
import { runtimeAgentsApi, useAgentsSpaces } from "../agents/agentsRuntime";
it("allows React refresh to inspect lazy app services before initialization",()=>{
  for (const service of [socialApi, libraryApi, runtimeAgentsApi, useSocialSpaces, useLibrarySpaces, useAgentsSpaces]) {
    expect(()=>Object.prototype.toString.call(service)).not.toThrow();
    for (const key of ["$$typeof","displayName","name","prototype"]) {
      if (key === "name" || key === "prototype") { if (typeof service !== "function") continue; }
      expect(()=>Reflect.get(service,key)).not.toThrow();
    }
  }
  expect(()=>useLibrarySpaces.getState()).toThrow(/not been mounted/);
});
