import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadOfficialAppCatalog, officialAppRuntimeRequest, type OfficialApp } from "./api";
import { apiRequest } from "@/api/client";
import type * as ApiClient from "@/api/client";

vi.mock("@/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));

describe("officialAppRuntimeRequest", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("routes private app records through the scoped runtime endpoint", async () => {
    const request = vi.fn(
      async () =>
        new Response(JSON.stringify({ records: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", request);

    const response = await officialAppRuntimeRequest({
      appRuntimeBase: "https://api.mistysys.com/v1/app-runtime",
      path: "/app-runtime/records",
      token: "app-session-token",
      method: "GET",
    });

    expect(request).toHaveBeenCalledWith(
      "https://api.mistysys.com/v1/app-runtime/records",
      expect.objectContaining({
        credentials: "omit",
        headers: { Authorization: "Bearer app-session-token" },
        method: "GET",
      }),
    );
    expect(response).toEqual({ ok: true, status: 200, data: { records: [] } });
  });

  it("routes Space APIs through the server base without forwarding account cookies", async () => {
    const request = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", request);

    const response = await officialAppRuntimeRequest({
      appRuntimeBase: "https://api.mistysys.com/v1/app-runtime",
      path: "/spaces/space-1/messages",
      token: "app-session-token",
      method: "POST",
      body: JSON.stringify({ content: "Hello" }),
    });

    expect(request).toHaveBeenCalledWith(
      "https://api.mistysys.com/v1/spaces/space-1/messages",
      expect.objectContaining({
        body: JSON.stringify({ content: "Hello" }),
        credentials: "omit",
        headers: {
          Authorization: "Bearer app-session-token",
          "Content-Type": "application/json",
        },
        method: "POST",
      }),
    );
    expect(response).toEqual({ ok: true, status: 204, data: null });
  });
});

describe("loadOfficialAppCatalog", () => {
  const serverApp: OfficialApp = {
    id: "journal",
    name: "Journal",
    publisher: "Misty",
    description: "Notes",
    version: "1.0.0",
    permission_version: 2,
    minimum_host_protocol: 2,
    official: true,
    age_rating: "4+",
    scopes: ["notes.read", "notes.write"],
    desktop: { runtime: "embedded" },
    mobile: { runtime: "unsupported" },
  };
  const serverCatalog = { apps: [serverApp], host_protocol_version: 2 };
  const localApp: OfficialApp = {
    ...serverApp,
    desktop: { runtime: "downloaded", entry: "/official-apps/journal.zip", sha256: "local-hash" },
  };
  const localResponse = (apps: OfficialApp[]) =>
    new Response(JSON.stringify({ apps, host_protocol_version: 3 }));

  beforeEach(() => {
    vi.mocked(apiRequest).mockReset().mockResolvedValue(serverCatalog);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("uses the server's grants and matching local artifacts without changing protocol or metadata", async () => {
    const request = vi.fn(async () =>
      localResponse([{ ...localApp, name: "Local label", scopes: ["notes.write", "notes.read"] }]),
    );
    vi.stubGlobal("fetch", request);
    await expect(loadOfficialAppCatalog(true)).resolves.toEqual({
      ...serverCatalog,
      apps: [{ ...serverApp, desktop: localApp.desktop }],
    });
    expect(apiRequest).toHaveBeenCalledWith("/apps", undefined);
    expect(request).toHaveBeenCalledWith(
      "/official-apps/catalog.json",
      expect.objectContaining({ cache: "no-store", credentials: "omit" }),
    );
  });

  it.each([
    { permission_version: 3 },
    { version: "1.1.0" },
    { scopes: ["notes.read", "notes.write", "files.write"] },
    { network_origins: ["https://new-provider.example"] },
    { minimum_host_protocol: 3 },
  ])("retains the server release when the local contract differs: %j", async (change) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => localResponse([{ ...localApp, ...change }])),
    );
    await expect(loadOfficialAppCatalog(true)).resolves.toEqual(serverCatalog);
  });

  it("does not introduce local-only apps or enable unsupported platforms", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        localResponse([
          { ...localApp, mobile: { runtime: "downloaded" } },
          { ...localApp, id: "new-app" },
        ]),
      ),
    );
    const result = await loadOfficialAppCatalog(true);
    expect(result.apps).toHaveLength(1);
    expect(result.apps[0].mobile).toEqual(serverApp.mobile);
  });

  it.each([404, 500])(
    "falls back to the server release if local assets are unavailable (%s)",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(null, { status })),
      );
      await expect(loadOfficialAppCatalog(true)).resolves.toEqual(serverCatalog);
    },
  );

  it("does not substitute local permissions when the server catalog request fails", async () => {
    vi.mocked(apiRequest).mockRejectedValue(new Error("Server unavailable"));
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    await expect(loadOfficialAppCatalog(true)).rejects.toThrow("Server unavailable");
    expect(request).not.toHaveBeenCalled();
  });

  it("uses only the server catalog outside local development", async () => {
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    await expect(loadOfficialAppCatalog(false)).resolves.toEqual(serverCatalog);
    expect(request).not.toHaveBeenCalled();
  });
});
