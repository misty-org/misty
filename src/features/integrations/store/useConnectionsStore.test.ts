import { connectionsApi } from "@/api/connections";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetConnectionsAccountState, useConnectionsStore } from "./useConnectionsStore";

vi.mock("@/api/connections", () => ({
  connectionsApi: {
    list: vi.fn(),
    authorize: vi.fn(),
    remove: vi.fn(),
  },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("account connections store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetConnectionsAccountState();
  });

  it("loads connections for the active account", async () => {
    vi.mocked(connectionsApi.list).mockResolvedValue({
      connections: [
        {
          id: "gmail-1",
          provider: "google",
          account_display: "alex@example.com",
          status: "active",
        },
      ],
    });
    useConnectionsStore.getState().setAccount("account-a");
    await useConnectionsStore.getState().load();

    expect(useConnectionsStore.getState()).toMatchObject({
      accountId: "account-a",
      loaded: true,
      loading: false,
    });
    expect(useConnectionsStore.getState().connections).toHaveLength(1);
  });

  it("drops a stale response after the active account changes", async () => {
    const first = deferred<Awaited<ReturnType<typeof connectionsApi.list>>>();
    vi.mocked(connectionsApi.list).mockReturnValue(first.promise);
    useConnectionsStore.getState().setAccount("account-a");
    const load = useConnectionsStore.getState().load();

    useConnectionsStore.getState().setAccount("account-b");
    first.resolve({
      connections: [
        {
          id: "stale",
          provider: "google",
          account_display: "old@example.com",
          status: "active",
        },
      ],
    });
    await load;

    expect(useConnectionsStore.getState()).toMatchObject({
      accountId: "account-b",
      connections: [],
      loaded: false,
    });
  });

  it("returns the provider authorization URL without storing a token", async () => {
    vi.mocked(connectionsApi.authorize).mockResolvedValue({
      provider: "google",
      authorization_url: "https://accounts.example/authorize",
    });
    useConnectionsStore.getState().setAccount("account-a");

    await expect(
      useConnectionsStore.getState().beginAuthorization("google", ["mail"]),
    ).resolves.toBe("https://accounts.example/authorize");
    expect(connectionsApi.authorize).toHaveBeenCalledWith("google", ["mail"], "/inbox");
  });
});
