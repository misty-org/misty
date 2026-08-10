import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as Backend from "@/services/backend";

const accountSession = vi.hoisted(() => ({ transitioning: false, generation: 0 }));

vi.mock("@/features/auth", () => ({
  isAccountSessionTransitioning: () => accountSession.transitioning,
  readAccountSessionGeneration: () => accountSession.generation,
  readAccountAuthToken: vi.fn().mockResolvedValue("signed-in-token"),
}));

vi.mock("@/services/backend", async (importOriginal) => ({
  ...(await importOriginal<typeof Backend>()),
  appSnapshot: vi.fn().mockRejectedValue(new Error("not running in Tauri")),
}));

import { spaceErrorMessage, spaceRequest, spacesApi } from "@/services/spaces/api";
import { isSpaceReferenceOnly, setSpaceReferenceOnly } from "@/services/spaces/connectivity";
import { fileNameFromPath, maxWebviewUploadBytes } from "@/services/spaces/library-upload";
import { configureSpaceSession } from "@/services/spaces/session";

beforeEach(() => {
  accountSession.transitioning = false;
  accountSession.generation = 0;
  configureSpaceSession({
    isTransitioning: () => accountSession.transitioning,
    readGeneration: () => accountSession.generation,
    readToken: async () => "signed-in-token",
  });
  setSpaceReferenceOnly(false);
});

describe("fileNameFromPath", () => {
  it("keeps the selected filename for Unix and Windows paths", () => {
    expect(fileNameFromPath("/Users/misty/Pictures/library photo.jpg")).toBe("library photo.jpg");
    expect(fileNameFromPath("C:\\Users\\misty\\Pictures\\library photo.jpg")).toBe(
      "library photo.jpg",
    );
  });
});

describe("spaceErrorMessage", () => {
  it("does not expose raw provider OAuth errors to members", () => {
    expect(
      spaceErrorMessage(
        "provider_not_configured",
        '{"code":"provider_not_configured","provider":"google"}',
      ),
    ).toBe("This provider’s sign-in is not available on the current Misty server.");
  });

  it("describes storage quota errors as an owner-pooled limit", () => {
    const expected =
      "This upload would exceed the Space owner’s shared storage pool. Existing files remain available.";

    expect(spaceErrorMessage("owner_storage_quota_exceeded", "fallback")).toBe(expected);
    expect(spaceErrorMessage("space_storage_quota_exceeded", "fallback")).toBe(expected);
    expect(expected).not.toContain("1 GB");
  });
});

describe("spaceRequest account isolation", () => {
  it("blocks writes without touching the network while Spaces are unavailable", async () => {
    setSpaceReferenceOnly(true);
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await expect(
      spaceRequest("/spaces/space-1/messages", { method: "POST", body: "{}" }),
    ).rejects.toMatchObject({
      status: 503,
      code: "offline_reference_only",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("locks Spaces after a network failure", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new TypeError("Failed to fetch"));

    await expect(spaceRequest("/spaces")).rejects.toThrow("Failed to fetch");
    expect(isSpaceReferenceOnly()).toBe(true);
  });

  it("uses encoded Planner expansion routes and optimistic versions", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ graph_version: 8 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    await spacesApi.agenda("space / one", "2026-08-01T00:00:00.000Z", "2026-09-01T00:00:00.000Z");
    await spacesApi.updateRoadmapLayout(
      "space / one",
      "map / one",
      { milestones: [], goals: [] },
      7,
    );
    await spacesApi.createRoadmapNodeDefinition("space / one", {
      name: "Experiment",
      icon: "sparkles",
      color: "cyan",
      field_schema: [],
    });

    expect(fetchMock.mock.calls[0]?.[0]).toContain(
      "/spaces/space%20%2F%20one/agenda?from=2026-08-01T00%3A00%3A00.000Z&to=2026-09-01T00%3A00%3A00.000Z",
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "http://localhost:8080/api/spaces/space%20%2F%20one/roadmaps/map%20%2F%20one/layout",
    );
    expect((fetchMock.mock.calls[1]?.[1] as RequestInit).method).toBe("PATCH");
    expect(JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body))).toEqual({
      milestones: [],
      goals: [],
      expected_version: 7,
    });
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      "http://localhost:8080/api/spaces/space%20%2F%20one/roadmap-node-definitions",
    );
    expect((fetchMock.mock.calls[2]?.[1] as RequestInit).method).toBe("POST");
  });

  it("reuses a creation key after a transient failure and clears it after success", async () => {
    const created = {
      space: {
        id: "space-1",
        security_domain_id: "domain-1",
        owner_user_id: "owner-1",
        name: "Research group",
        role: "owner",
        member_count: 1,
        pending_count: 0,
        is_shared: false,
        permissions: {},
        created_at: "2026-07-26T00:00:00Z",
        updated_at: "2026-07-26T00:00:00Z",
      },
      setup: {
        selected_providers: ["google", "notion"],
        completed_providers: [],
        pending_providers: ["google", "notion"],
      },
    };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: "temporary_failure" }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(created), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(created), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
      );
    const request: Parameters<typeof spacesApi.create>[0] = {
      name: "Research group",
      template_id: "research",
      integration_providers: ["google", "notion"],
    };

    await expect(spacesApi.create(request)).rejects.toMatchObject({ status: 503 });
    await expect(spacesApi.create(request)).resolves.toEqual(created);
    await expect(spacesApi.create(request)).resolves.toEqual(created);

    const calls = fetchMock.mock.calls;
    const firstInit = calls[0]?.[1] as RequestInit;
    const retryInit = calls[1]?.[1] as RequestInit;
    const afterSuccessInit = calls[2]?.[1] as RequestInit;
    const firstKey = new Headers(firstInit.headers).get("Idempotency-Key");
    expect(firstKey).toBeTruthy();
    expect(new Headers(retryInit.headers).get("Idempotency-Key")).toBe(firstKey);
    expect(new Headers(afterSuccessInit.headers).get("Idempotency-Key")).not.toBe(firstKey);
    expect(JSON.parse(String(firstInit.body))).toEqual(request);
  });

  it("blocks Space requests before network usage during an account switch", async () => {
    accountSession.transitioning = true;
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await expect(spaceRequest("/spaces")).rejects.toMatchObject({
      message: "Wait for the account switch to finish.",
      status: 409,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an old-account response that lands after the account generation changes", async () => {
    let releaseResponse!: (response: Response) => void;
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => new Promise<Response>((resolve) => (releaseResponse = resolve)));
    const request = spaceRequest("/spaces");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    accountSession.generation += 1;
    releaseResponse(
      new Response(JSON.stringify({ spaces: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(request).rejects.toMatchObject({ code: "account_changed", status: 409 });
  });

  it("rejects protected Space content whose body completes after an account switch", async () => {
    let releaseBlob!: (blob: Blob) => void;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      blob: () => new Promise<Blob>((resolve) => (releaseBlob = resolve)),
    } as Response);
    const request = spacesApi.libraryContent("space-a", "item-a");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    accountSession.generation += 1;
    releaseBlob(new Blob(["private account A data"]));

    await expect(request).rejects.toMatchObject({ code: "account_changed", status: 409 });
  });

  it("rejects oversized local uploads before buffering their body", async () => {
    const readBody = vi.fn();
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-length": String(maxWebviewUploadBytes + 1) }),
      blob: readBody,
    } as unknown as Response);

    await expect(
      spacesApi.uploadLibraryPath("space-a", "/tmp/too-large.mov", "library"),
    ).rejects.toThrow("up to 128 MB");
    expect(readBody).not.toHaveBeenCalled();
  });

  it("sends emoji reaction writes to encoded message reaction endpoints", async () => {
    const saved = {
      seq: 1,
      id: "message-a",
      space_id: "space-a",
      sender_user_id: "user-a",
      sender_name: "Misty",
      sender_kind: "person",
      content: [{ type: "text", text: "Nice work" }],
      file_node_ids: [],
      reactions: [{ emoji: "👍", count: 1, reacted_by_me: true }],
      created_at: "2026-07-26T00:00:00Z",
    };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify(saved), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    await expect(spacesApi.addMessageReaction("space-a", "message-a", "👍")).resolves.toEqual(
      saved,
    );
    await spacesApi.removeConversationMessageReaction(
      "space-a",
      "conversation-a",
      "message-a",
      "❤️",
    );

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://localhost:8080/api/spaces/space-a/messages/message-a/reactions/%F0%9F%91%8D",
    );
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).method).toBe("PUT");
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "http://localhost:8080/api/spaces/space-a/conversations/conversation-a/messages/message-a/reactions/%E2%9D%A4%EF%B8%8F",
    );
    expect((fetchMock.mock.calls[1]?.[1] as RequestInit).method).toBe("DELETE");
  });
});
