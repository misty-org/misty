import { describe, expect, it } from "vitest";
import { accessFor, accessLine } from "./integration_access";

describe("integration access", () => {
  it("asks for rooms read, and write only on top of read", () => {
    expect(accessFor("read")).toEqual(["rooms.read"]);
    expect(accessFor("write")).toEqual(["rooms.read", "rooms.write"]);
  });

  it("says in plain words what an integration may reach", () => {
    expect(accessLine(["rooms.read"])).toBe("Reads rooms");
    expect(accessLine(["rooms.read", "rooms.write"], "notes/")).toBe(
      "Reads and writes rooms starting with notes/",
    );
    expect(accessLine(["rooms.read"], "  ")).toBe("Reads rooms");
    expect(accessLine(undefined)).toBe("");
  });
});
