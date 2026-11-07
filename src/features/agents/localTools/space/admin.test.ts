import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalToolRejected } from "../host";
import { spaceTools } from "../spaceTools";
import { LocalToolUncertain } from "../host";
import { SPACES, call, refusedWith, serve } from "./testRoutes";

vi.mock("@/api/client", async (original) => ({
  ...(await original<object>()),
  apiRequest: vi.fn(),
}));

const tool = (name: string) => spaceTools[name];
const refusal = (error: unknown) => (error as LocalToolRejected).message;

beforeEach(() => vi.clearAllMocks());

describe("item.delete", () => {
  it("finds a note by id in whichever Space holds it", async () => {
    serve({
      ...SPACES,
      "GET /spaces/s1/notes/n": refusedWith(404, "not_found"),
      "GET /spaces/s0/notes/n": { title: "Old" },
      "DELETE /spaces/s0/notes/n": undefined,
    });
    await expect(call(tool("item.delete"), { kind: "note", id: "n" })).resolves.toEqual({
      deleted: "note",
      id: "n",
      title: "Old",
      space_id: "s0",
    });
  });

  it("deletes a drawing, naming one with no title", async () => {
    serve({
      ...SPACES,
      "GET /spaces/s1/drawings/d": { title: " " },
      "DELETE /spaces/s1/drawings/d": undefined,
    });
    await expect(call(tool("item.delete"), { kind: "drawing", id: "d" })).resolves.toMatchObject({
      title: "Untitled drawing",
    });
  });

  it("deletes a thread and a shared file in the Space it's told", async () => {
    serve({
      ...SPACES,
      "GET /spaces/s1/conversations": { conversations: [{ id: "t", title: "Plan" }] },
      "DELETE /spaces/s1/conversations/t": undefined,
      "GET /spaces/s1/nodes": { nodes: [{ id: "f", display_name: "a.pdf" }] },
      "DELETE /spaces/s1/nodes/f": undefined,
    });
    await expect(
      call(tool("item.delete"), { kind: "thread", id: "t", space: "s1" }),
    ).resolves.toMatchObject({ title: "Plan", space_id: "s1" });
    await expect(
      call(tool("item.delete"), { kind: "shared_file", id: "f", space: "s1" }),
    ).resolves.toMatchObject({ title: "a.pdf" });
    await expect(
      call(tool("item.delete"), { kind: "thread", id: "t" }).catch(refusal),
    ).resolves.toBe("pass space; call space_list for names and ids");
  });

  it("moves a Library item to the trash rather than deleting it", async () => {
    const calls = serve({
      ...SPACES,
      "GET /spaces/s1/library/items/i": { display_name: "a.png" },
      "POST /spaces/s1/library/items/i/trash": { id: "i" },
    });
    await expect(
      call(tool("item.delete"), { kind: "library_item", id: "i", space: "s1" }),
    ).resolves.toMatchObject({ deleted: "library_item", title: "a.png" });
    expect(calls[calls.length - 1].method).toBe("POST");
  });

  it("says what it couldn't find or may not delete", async () => {
    serve({
      ...SPACES,
      "GET /spaces/s1/notes/n": refusedWith(404),
      "GET /spaces/s0/notes/n": refusedWith(404),
    });
    await expect(call(tool("item.delete"), { kind: "note", id: "n" }).catch(refusal)).resolves.toBe(
      "no note n that you can delete",
    );
    serve({ ...SPACES, "GET /spaces/s1/conversations": { conversations: [] } });
    await expect(
      call(tool("item.delete"), { kind: "thread", id: "t", space: "s1" }).catch(refusal),
    ).resolves.toBe("no thread t that you can delete");
    serve({
      ...SPACES,
      "GET /spaces/s1/notes/n": { title: "T" },
      "DELETE /spaces/s1/notes/n": refusedWith(403, "forbidden"),
    });
    await expect(call(tool("item.delete"), { kind: "note", id: "n" }).catch(refusal)).resolves.toBe(
      "you do not have permission to delete that note",
    );
    await expect(call(tool("item.delete"), { kind: "task", id: "n" }).catch(refusal)).resolves.toBe(
      "The arguments do not match this tool's input schema.",
    );
  });

  it("doesn't call a failed delete a refusal when nobody answered", async () => {
    serve({
      ...SPACES,
      "GET /spaces/s1/notes/n": { title: "T" },
      "DELETE /spaces/s1/notes/n": new Error("Load failed"),
    });
    await expect(call(tool("item.delete"), { kind: "note", id: "n" })).rejects.toBeInstanceOf(
      LocalToolUncertain,
    );
  });
});

describe("item.rename", () => {
  it("renames a drawing wherever it is, and a thread in its Space", async () => {
    const calls = serve({
      ...SPACES,
      "GET /spaces/s1/drawings/d": { title: "Old" },
      "PATCH /spaces/s1/drawings/d": { id: "d", title: "New" },
      "GET /spaces/s1/conversations": { conversations: [{ id: "t", title: "Old" }] },
      "PATCH /spaces/s1/conversations/t": { id: "t", title: "New" },
    });
    await expect(
      call(tool("item.rename"), { kind: "drawing", id: "d", name: " New " }),
    ).resolves.toEqual({ renamed: "drawing", id: "d", name: "New" });
    expect(calls.find((request) => request.method === "PATCH")?.body).toEqual({ title: "New" });
    await expect(
      call(tool("item.rename"), { kind: "thread", id: "t", name: "New", space: "Work" }),
    ).resolves.toEqual({ renamed: "thread", id: "t", name: "New" });
  });

  it("says what it can't rename", async () => {
    serve({
      ...SPACES,
      "GET /spaces/s1/drawings/d": refusedWith(404),
      "GET /spaces/s0/drawings/d": refusedWith(404),
    });
    await expect(
      call(tool("item.rename"), { kind: "drawing", id: "d", name: "x" }).catch(refusal),
    ).resolves.toBe("no drawing d that you can rename");
    serve({
      ...SPACES,
      "GET /spaces/s1/drawings/d": { title: "T" },
      "PATCH /spaces/s1/drawings/d": refusedWith(403, "forbidden"),
    });
    await expect(
      call(tool("item.rename"), { kind: "drawing", id: "d", name: "x" }).catch(refusal),
    ).resolves.toBe("no drawing d that you can rename");
  });
});

describe("space.list", () => {
  it("marks the personal Space", async () => {
    serve(SPACES);
    await expect(call(tool("space.list"), {})).resolves.toEqual({
      spaces: [
        { id: "s1", name: "Work", personal: false, shared: true, agent_member: false },
        { id: "s0", name: "Home", personal: true, shared: false, agent_member: true },
      ],
    });
  });
});

describe("space.manage", () => {
  const manage = (input: Record<string, unknown>) => call(tool("space.manage"), input);

  it("creates once for a retried call", async () => {
    const calls = serve({ "POST /spaces": { space: { id: "s9", name: "New", role: "owner" } } });
    await expect(manage({ action: "create", name: "New" })).resolves.toEqual({
      space: { id: "s9", name: "New" },
    });
    expect(calls[0].headers).toEqual({ "Idempotency-Key": "agent:run-1:call-1" });
    await expect(manage({ action: "create" }).catch(refusal)).resolves.toBe("create needs a name");
  });

  it("renames, invites and resends", async () => {
    const calls = serve({
      ...SPACES,
      "PATCH /spaces/s1": { name: "Renamed" },
      "POST /spaces/s1/invitations": { id: "i", link: "misty://x", emailed: true },
      "POST /spaces/s1/invitations/i/resend": { id: "i", link: "misty://y" },
      "GET /spaces/s1/invitations": { invitations: [{ id: "i" }] },
    });
    await expect(manage({ action: "rename", space: "s1", name: "Renamed" })).resolves.toEqual({
      space: { id: "s1", name: "Renamed" },
    });
    await expect(manage({ action: "invite", space: "s1", email: "a@b.test" })).resolves.toEqual({
      invited: "a@b.test",
      invitation_id: "i",
      link: "misty://x",
      emailed: true,
    });
    expect(calls[calls.length - 1].body).toEqual({ email: "a@b.test" });
    await expect(
      manage({ action: "resend_invitation", space: "s1", invitation_id: "i" }),
    ).resolves.toEqual({ resent: "i", link: "misty://y", emailed: false });
    await expect(manage({ action: "list_invitations", space: "s1" })).resolves.toEqual({
      invitations: [{ id: "i" }],
    });
  });

  it("cancels, removes and leaves", async () => {
    serve({
      ...SPACES,
      "DELETE /spaces/s1/invitations/i": undefined,
      "DELETE /spaces/s1/members/u": undefined,
      "POST /spaces/s1/leave": undefined,
    });
    await expect(
      manage({ action: "cancel_invitation", space: "s1", invitation_id: "i" }),
    ).resolves.toEqual({ canceled: "i" });
    await expect(manage({ action: "remove_member", space: "s1", member_id: "u" })).resolves.toEqual(
      { removed: "u", space: "Work" },
    );
    await expect(manage({ action: "leave", space: "s1" })).resolves.toEqual({ left: "Work" });
  });

  it("refuses in words the model can act on", async () => {
    serve(SPACES);
    await expect(
      manage({ action: "invite", space: "s1", email: "nope" }).catch(refusal),
    ).resolves.toBe("invite needs the person's email address");
    await expect(manage({ action: "remove_member", space: "s1" }).catch(refusal)).resolves.toBe(
      "remove_member needs member_id from space_member_list",
    );
    await expect(manage({ action: "rename", name: "x" }).catch(refusal)).resolves.toBe(
      "pass space; call space_list for names and ids",
    );
    await expect(manage({ action: "explode", space: "s1" }).catch(refusal)).resolves.toBe(
      "The arguments do not match this tool's input schema.",
    );
    for (const [status, code, message] of [
      [403, "forbidden", "only the Space owner can do that"],
      [404, "not_found", "that Space, member or invitation was not found"],
      [400, "invalid_request", "those values are not valid for this action"],
      [409, "default_space_protected", "the personal Space cannot be left or shared that way"],
      [409, "space_people_limit_reached", "this account has reached its plan limit for that"],
    ] as const) {
      serve({ ...SPACES, "POST /spaces/s1/leave": refusedWith(status, code) });
      await expect(manage({ action: "leave", space: "s1" }).catch(refusal)).resolves.toBe(message);
    }
  });
});
