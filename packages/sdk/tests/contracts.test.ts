import { describe, expect, it } from "vitest";
import {
  mistyServerContracts,
  mistyServerMethods,
  parseAppRpcRequest,
  parseMethodParams,
  parseMethodResult,
  SpaceNoteSchema,
  MistyActivityOperationSchema,
  AppRpcErrorSchema,
} from "@misty/contracts";
import { createMistyAppSDK, defineComponentApp } from "@misty/sdk";

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
describe("public app contracts", () => {
  it("preserves named protocol 2 methods and binds the Space on the server", () => {
    expect(Object.keys(mistyServerMethods)).toHaveLength(82);
    expect(Object.keys(mistyServerMethods).some((method) => method.startsWith("sources."))).toBe(false);
    expect(
      parseAppRpcRequest(
        {
          protocol: 2,
          method: "notes.get",
          params: { path: { noteID: "note-a" } },
        },
        "space-a",
      ),
    ).toEqual({
      protocol: 2,
      method: "notes.get",
      params: { path: { noteID: "note-a", spaceID: "space-a" } },
    });
    expect(() =>
      parseAppRpcRequest(
        {
          protocol: 2,
          method: "notes.list",
          params: { path: { spaceID: "space-b" } },
        },
        "space-a",
      ),
    ).toThrow(expect.objectContaining({ code: "space_mismatch" }));
  });
  it("rejects unknown methods, privileged routes, malformed inputs and protocol changes", () => {
    for (const method of [
      "constructor",
      "__proto__",
      "billing.checkout",
      "account.delete",
      "https://outside.invalid",
    ]) {
      expect(() =>
        parseAppRpcRequest({ protocol: 2, method }, "space-a"),
      ).toThrow(expect.objectContaining({ code: "unsupported_method" }));
    }
    expect(() =>
      parseAppRpcRequest({ protocol: 3, method: "notes.list" }, "space-a"),
    ).toThrow(expect.objectContaining({ code: "unsupported_protocol" }));
    expect(() =>
      parseMethodParams("notes.get", { path: { noteID: "../me" } }),
    ).toThrow();
    expect(() =>
      parseMethodParams("notes.update", {
        path: { noteID: "note-a" },
        body: { title: "Wrong endpoint" },
      }),
    ).toThrow();
    expect(() => parseMethodParams("notes.list", { url: "/me" })).toThrow();
    expect(() =>
      parseMethodParams("tasks.delete", { path: { taskID: "task-a" } }),
    ).toThrow();
  });
  it("retains omitted fields, null lists, and additive response data", () => {
    expect(
      SpaceNoteSchema.parse({ ...note, future_field: "retained" }),
    ).toEqual({ ...note, future_field: "retained" });
    expect(parseMethodResult("notes.list", { notes: null })).toEqual({
      notes: null,
    });
    expect(parseMethodResult("notes.delete", undefined)).toBeUndefined();
    expect(() => parseMethodResult("notes.get", { id: "incomplete" })).toThrow(
      expect.objectContaining({ code: "invalid_response" }),
    );
    expect(
      AppRpcErrorSchema.parse({ code: "space_conflict", revision: 2 }),
    ).toEqual({ code: "space_conflict", revision: 2 });
  });
  it("maintains archive semantics and version parameters", () => {
    expect(mistyServerContracts["tasks.delete"].result).toBe(
      mistyServerContracts["tasks.update"].result,
    );
    expect(
      parseMethodParams("tasks.delete", {
        path: { taskID: "task-a" },
        query: { version: "2" },
      }).query.version,
    ).toBe("2");
    expect(
      parseMethodParams("calendar.events.delete", {
        path: { eventID: "event-a" },
        query: { version: 2 },
      }).query.version,
    ).toBe(2);
    expect(() =>
      parseMethodParams("calendar.events.list", {
        query: { from: "2026-09-05T00:00:00Z", to: "2026-09-04T00:00:00Z" },
      }),
    ).toThrow();
  });
  it("validates SDK requests before transport and results after transport", async () => {
    const calls: unknown[] = [];
    const sdk = createMistyAppSDK({
      request: async (message) => {
        calls.push(message);
        if (message.method === "notes.get") return note;
        if (message.method === "notes.list") return { notes: null };
        return undefined;
      },
    });
    expect(
      (await sdk.server.call("notes.get", { path: { noteID: "note-a" } }))
        .title,
    ).toBe("Notes");
    expect(await sdk.notes.list()).toEqual([]);
    const before = calls.length;
    await expect(sdk.notes.get("../wrong")).rejects.toMatchObject({
      code: "invalid_params",
    });
    expect(calls).toHaveLength(before);
    await expect(
      sdk.notes.create({ title: "Missing server result" }),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });
  it("keeps component exports inert until the host mounts them", async () => {
    let mounts = 0;
    const app = defineComponentApp({
      appId: "journal",
      protocol: 2,
      mount: () => {
        mounts++;
        return { update() {}, unmount() {} };
      },
    });
    expect(mounts).toBe(0);
    expect(Object.isFrozen(app)).toBe(true);
  });
});

describe("shared terminal contracts", () => {
  it("supports terminal control bytes and strips private native response fields", async () => {
    const calls: unknown[] = [];
    const sdk = createMistyAppSDK({
      request: async (message) => {
        calls.push(message);
        if (message.method === "terminal.environments")
          return [
            {
              id: "dev",
              label: "dev",
              host: "localhost",
              user: null,
              port: 22,
              deviceLocal: true,
              agentTools: "device_local",
              configPath: "/private/config",
            },
          ];
        if (message.method === "terminal.create")
          return { handle: "terminal-a" };
        return null;
      },
    });
    expect(await sdk.terminal.environments()).toEqual([
      {
        id: "dev",
        label: "dev",
        host: "localhost",
        user: null,
        port: 22,
        deviceLocal: true,
        agentTools: "device_local",
      },
    ]);
    const session = await sdk.terminal.create();
    await sdk.terminal.write(session.handle, "\0\u001b[31m\r");
    expect(calls).toContainEqual({
      method: "terminal.write",
      params: { handle: "terminal-a", data: "\0\u001b[31m\r" },
    });
  });
  it("rejects invalid dimensions and native results", async () => {
    const sdk = createMistyAppSDK({
      request: async () => ({ nativeId: "must-not-leak" }),
    });
    await expect(sdk.terminal.create({ cols: 1 })).rejects.toMatchObject({
      code: "invalid_params",
    });
    await expect(sdk.terminal.create()).rejects.toMatchObject({
      code: "invalid_response",
    });
  });
});

describe("Planner method coverage", () => {
  it("keeps connection credentials private and binds calendar connections to the session Space", () => {
    expect(parseMethodParams("connections.remove", {path:{connectionID:"connection-a"}})).toEqual({path:{connectionID:"connection-a"}});
    expect(() => parseMethodParams("connections.remove", {path:{connectionID:"../other"}})).toThrow();
    expect(parseMethodResult("connections.remove", undefined)).toBeUndefined();
    expect(
      parseMethodResult("connections.list", {
        connections: [
          {
            id: "account-a",
            provider: "google",
            account_id: "google-a",
            account_display: "Calendar",
            capabilities: null,
            granted_scopes: null,
            status: "active",
            access_token: "private",
            credential_reference: "private",
          },
        ],
      }),
    ).toEqual({
      connections: [
        {
          id: "account-a",
          provider: "google",
          account_id: "google-a",
          account_display: "Calendar",
          capabilities: null,
          granted_scopes: null,
          status: "active",
        },
      ],
    });
    expect(() =>
      parseAppRpcRequest(
        {
          protocol: 2,
          method: "integrations.bind",
          params: {
            path: { spaceID: "space-b", provider: "google" },
            body: { connection_id: "account-a", capability: "calendar_read" },
          },
        },
        "space-a",
      ),
    ).toThrow();
    for (const return_to of [
      "https://other.example",
      "//other.example",
      "/\\other.example",
      "/\nother",
    ]) {
      expect(() =>
        parseMethodParams("connections.authorize", {
          path: { provider: "google" },
          body: { capabilities: ["calendar_read"], return_to },
        }),
      ).toThrow();
    }
    expect(() =>
      parseMethodParams("connections.authorize", {
        path: { provider: "../admin" },
        body: { capabilities: ["calendar_read"], return_to: "/apps/planner" },
      }),
    ).toThrow();
    expect(
      parseAppRpcRequest(
        {
          protocol: 2,
          method: "connections.authorize",
          params: {
            path: { provider: "google" },
            body: {
              capabilities: ["calendar_read"],
              return_to: "/apps/planner?space=space-a",
            },
          },
        },
        "space-a",
      ),
    ).toMatchObject({
      params: { path: { spaceID: "space-a", provider: "google" } },
    });
  });
  it("preserves roadmap graph versions and validates task replacements", () => {
    expect(
      parseAppRpcRequest(
        {
          protocol: 2,
          method: "roadmaps.goals.setTasks",
          params: {
            path: { roadmapID: "roadmap-a", goalID: "goal-a" },
            body: { task_ids: ["task-a"], expected_version: 4 },
          },
        },
        "space-a",
      ),
    ).toMatchObject({
      params: { path: { spaceID: "space-a" }, body: { expected_version: 4 } },
    });
    expect(mistyServerMethods["roadmaps.goals.setTasks"].verb).toBe("PUT");
    expect(() =>
      parseMethodParams("roadmaps.goals.setTasks", {
        path: { roadmapID: "roadmap-a", goalID: "goal-a" },
        body: { task_ids: ["task-a"] },
      }),
    ).toThrow();
    expect(() =>
      parseMethodParams("roadmaps.nodes.update", {
        path: { roadmapID: "roadmap-a", nodeID: "../node-b" },
        body: { title: "Risk", expected_version: 4 },
      }),
    ).toThrow();
    expect(parseMethodResult("roadmaps.delete", { graph_version: 5 })).toEqual({
      graph_version: 5,
    });
  });
  it("requires bounded calendar intervals and explicit connection references", () => {
    expect(() =>
      parseMethodParams("agenda.list", {
        query: { from: "2026-01-01T00:00:00Z", to: "2028-01-01T00:00:00Z" },
      }),
    ).toThrow();
    expect(
      parseMethodParams("calendar.sources.create", {
        body: {
          integration_id: "connection-a",
          external_calendar_id: "calendar@example.com",
        },
      }),
    ).toEqual({
      body: {
        integration_id: "connection-a",
        external_calendar_id: "calendar@example.com",
      },
    });
    expect(() =>
      parseMethodParams("calendar.sources.create", {
        body: {
          integration_id: "connection-a",
          external_calendar_id: "calendar@example.com",
          access_token: "host-only",
        },
      }),
    ).toThrow();
    expect(
      parseMethodResult("calendar.sync", {
        tasks: [],
        sources: null,
        synced_at: "2026-09-04T00:00:00Z",
      }),
    ).toEqual({ tasks: [], sources: null, synced_at: "2026-09-04T00:00:00Z" });
  });
  it("exposes explicit host UI methods and reports unsupported callback runtimes", async () => {
    const calls: string[] = [];
    const sdk = createMistyAppSDK({
      request: async ({ method }) => {
        calls.push(method);
        return method === "settings.snapshot" ? {} : undefined;
      },
    });
    await sdk.workspace.setTitle("Terminal");
    expect(await sdk.settings.snapshot()).toEqual({});
    await expect(
      sdk.links.openExternal("javascript:alert(1)"),
    ).rejects.toThrow();
    await expect(
      sdk.surfaces.register({
        surfaceId: "terminal",
        label: "Terminal",
        getContext: () => [],
      }),
    ).rejects.toMatchObject({ code: "unsupported_transport" });
    expect(calls).toEqual([
      "lifecycle.ready",
      "workspace.title.set",
      "settings.snapshot",
    ]);
  });
});


describe("structured Activity operation contract", () => {
  const event = { operationId: "export-1", revision: 1, status: "completed", title: "Export ready", route: "/apps/journal" };
  it("accepts explicit states and rejects forged authority or invalid revisions", () => {
    expect(MistyActivityOperationSchema.parse(event)).toEqual(event);
    for (const extra of [{source: "other"}, {appId: "other"}, {spaceId: "other"}, {notify: true}, {attention: true}, {revision: 0}, {revision: 1.5}, {status: "approval"}, {title: ""}])
      expect(() => MistyActivityOperationSchema.parse({...event, ...extra})).toThrow();
  });
});
