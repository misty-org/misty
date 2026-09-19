import { expect, it, vi } from "vitest";
import { defineComponentApp, type MistyComponentSession } from "../src/index.js";
it("accepts an optional app-session factory without giving it a shared SDK", async () => {
 const signal=new AbortController().signal;
 const mount=vi.fn(), close=vi.fn();
 const factory=vi.fn(():MistyComponentSession=>({mount,close}));
 const definition=defineComponentApp({appId:"code",protocol:2,mount,createSession:factory});
 const session=await definition.createSession!({signal});
 expect(factory).toHaveBeenCalledWith({signal});expect(session.mount).toBe(mount);expect(Object.isFrozen(definition)).toBe(true);
 expect(()=>defineComponentApp({...definition,createSession:42 as never})).toThrow("Invalid Misty component");
});
