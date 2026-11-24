import { describe, expect, it } from "vitest";
import type { AccountSession } from "./device_sign_in_api";
import { sessionLine, sessionName, sortSessions } from "./session_lines";

const now = Date.parse("2026-11-23T12:00:00Z");

function session(patch: Partial<AccountSession>): AccountSession {
  return {
    id: "s",
    name: "misty-cli on studio-mac",
    created_at: "2026-11-01T12:00:00Z",
    current: false,
    ...patch,
  };
}

describe("session lines", () => {
  it("marks this device and says when the others were last used", () => {
    expect(sessionLine(session({ current: true }), now)).toBe("This device");
    expect(sessionLine(session({ last_used_at: "2026-11-23T09:00:00Z" }), now)).toMatch(
      /^Last used 3 hours ago$/,
    );
    expect(sessionLine(session({ last_used_at: null }), now)).toMatch(/^Signed in /);
  });

  it("names a session with no name", () => {
    expect(sessionName(session({ name: "  " }))).toBe("Unnamed device");
  });

  it("lists this device first, then the most recently used", () => {
    const sorted = sortSessions([
      session({ id: "old", last_used_at: "2026-11-02T12:00:00Z" }),
      session({ id: "new", last_used_at: "2026-11-22T12:00:00Z" }),
      session({ id: "here", current: true, last_used_at: "2026-11-01T12:00:00Z" }),
    ]);
    expect(sorted.map((item) => item.id)).toEqual(["here", "new", "old"]);
  });
});
