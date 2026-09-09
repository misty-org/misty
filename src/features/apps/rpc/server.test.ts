import { createMistyAppSDK } from "@misty/sdk";
import { describe, expect, it, vi } from "vitest";
import { createServerRpc } from "./server";
import { createAppRpcScope } from "./session";

const note = {
  id: "note-a",
  space_id: "space-a",
  creator_user_id: "user-a",
  title: "Notes",
  lifecycle_state: "active",
  collaboration_revision: 0,
  acl_version: 1,
  audience_kind: "space",
  created_at: "2026-09-04T00:00:00Z",
  updated_at: "2026-09-04T00:00:00Z",
  role: "creator",
  can_delete: true,
  backlink_count: 0,
};

function fixture() {
  let account = "account-a";
  const scope = createAppRpcScope({
    identity: { appId: "journal", accountId: account, spaceId: "space-a", instanceId: "tab-a" },
    scopes: ["notes.read", "notes.write"],
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    isCurrentAccount: (id) => id === account,
  });
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(JSON.stringify({ notes: [note] }), {
      headers: { "Content-Type": "application/json" },
    }),
  );
  const rpc = createServerRpc(scope, {
    serverBase: "https://misty.example/v1",
    readAppSession: () => ({
      appId: "journal",
      spaceId: "space-a",
      token: "host-only-app-session",
    }),
    fetch: fetcher,
  });
  const sdk = createMistyAppSDK({
    request: (request) =>
      request.method === "lifecycle.ready" ? Promise.resolve() : rpc.request(request),
  });
  return {
    sdk,
    rpc,
    scope,
    fetcher,
    switchAccount: () => {
      account = "account-b";
    },
  };
}

describe("SDK/server method transport", () => {
  it("forwards only a host-provided finalize credential on the two asset finalize methods", async () => {
    const f = fixture();
    f.fetcher.mockImplementation(async () => new Response(null, { status: 204 }));
    const message = {
      method: "notes.assets.finalize",
      params: { path: { noteID: "note-a", uploadID: "upload-a" } },
    };
    await expect(f.rpc.request(message)).rejects.toMatchObject({
      code: "upload_credential_required",
    });
    for (const token of ["bad token", "a,b", "a\r\nb", "x".repeat(1025)])
      await expect(f.rpc.request(message, { journalUploadToken: token })).rejects.toMatchObject({
        code: "invalid_upload_credential",
      });
    await expect(
      f.rpc.request({ method: "notes.list" }, { journalUploadToken: "private" }),
    ).rejects.toMatchObject({ code: "invalid_upload_credential" });
    expect(f.fetcher).not.toHaveBeenCalled();
    await f.rpc.request(message, { journalUploadToken: "private-finalize" });
    const init = f.fetcher.mock.calls[0][1]!;
    expect(new Headers(init.headers).get("X-Misty-Library-Upload-Token")).toBe("private-finalize");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer host-only-app-session");
    expect(init.body).not.toContain("private-finalize");
    f.scope.close();
  });
  it("cancels one host request without closing the App's other server requests", async () => {
    const f = fixture();
    const controller = new AbortController();
    let finish!: () => void;
    f.fetcher.mockImplementationOnce(async () => {
      await new Promise<void>((done) => {
        finish = done;
      });
      return new Response(JSON.stringify({ notes: [note] }));
    });
    const pending = f.rpc.request({ method: "notes.list" }, { signal: controller.signal });
    const cancelled = expect(pending).rejects.toMatchObject({ code: "request_cancelled" });
    controller.abort();
    expect(f.fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
    finish();
    await cancelled;
    expect(await f.sdk.notes.list()).toEqual([note]);
    f.scope.close();
  });
  it("sends an explicit protocol method using a host-owned App session", async () => {
    const f = fixture();
    expect(await f.sdk.server.call("notes.list")).toEqual({ notes: [note] });
    const [url, init] = f.fetcher.mock.calls[0];
    expect(String(url)).toBe("https://misty.example/v1/app-runtime/rpc");
    expect(init).toMatchObject({
      method: "POST",
      credentials: "omit",
      redirect: "error",
      headers: { Authorization: "Bearer host-only-app-session" },
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      protocol: 2,
      method: "notes.list",
      params: {},
    });
    expect(JSON.stringify(f.sdk)).not.toContain("host-only-app-session");
  });

  it("does not permit arbitrary server URLs, HTTP verbs, or method names", async () => {
    const f = fixture();
    for (const method of [
      "__proto__",
      "constructor",
      "account.delete",
      "https://evil.invalid",
      "notes.list/../../me",
    ]) {
      await expect(f.rpc.request({ method, params: {} })).rejects.toMatchObject({
        code: "unsupported_method",
      });
    }
    await expect(
      f.rpc.request({ method: "server.fetch", params: { url: "/me" } }),
    ).rejects.toMatchObject({ code: "unsupported_method" });
    expect(f.fetcher).not.toHaveBeenCalled();
  });

  it("preserves permission errors returned by the server", async () => {
    const f = fixture();
    f.fetcher.mockResolvedValue(
      new Response(JSON.stringify({ code: "app_scope_forbidden", message: "Permission denied" }), {
        status: 403,
      }),
    );
    await expect(
      f.sdk.server.call("notes.create", { body: { title: "New" } }),
    ).rejects.toMatchObject({ code: "app_scope_forbidden", message: "Permission denied" });
  });

  it("aborts requests on close and refuses late results after account changes", async () => {
    const f = fixture();
    let respond!: (response: Response) => void;
    f.fetcher.mockImplementation(
      () =>
        new Promise((resolve) => {
          respond = resolve;
        }),
    );
    const pending = f.sdk.server.call("notes.list");
    const rejected = expect(pending).rejects.toMatchObject({ code: "account_changed" });
    f.switchAccount();
    f.rpc.close();
    expect(f.fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
    respond(new Response('{"notes":[]}'));
    await rejected;
  });

  it("rejects a session issued for another App or Space", async () => {
    const f = fixture();
    const wrong = createServerRpc(f.scope, {
      serverBase: "https://misty.example/v1",
      readAppSession: () => ({ appId: "planner", spaceId: "space-b", token: "wrong" }),
      fetch: f.fetcher,
    });
    await expect(wrong.request({ method: "notes.list", params: {} })).rejects.toMatchObject({
      code: "session_mismatch",
    });
    expect(f.fetcher).not.toHaveBeenCalled();
  });
  it("rejects invalid or cross-Space calls before sending them to the server", async () => {
    const f = fixture();
    await expect(
      f.rpc.request({ method: "notes.list", params: { path: { spaceID: "space-b" } } }),
    ).rejects.toMatchObject({ code: "space_mismatch" });
    await expect(
      f.rpc.request({
        method: "notes.update",
        params: { path: { noteID: "note-a" }, body: { title: "Invalid channel" } },
      }),
    ).rejects.toMatchObject({ code: "invalid_params" });
    expect(f.fetcher).not.toHaveBeenCalled();
    f.scope.close();
  });
  it("handles malformed error bodies without exposing transport internals", async () => {
    const f = fixture();
    for (const body of ["null", "[]", '{"code":42}', "not JSON"]) {
      f.fetcher.mockResolvedValue(new Response(body, { status: 502 }));
      await expect(f.sdk.server.call("notes.list")).rejects.toMatchObject({ code: "server_error" });
    }
    f.scope.close();
  });
});
