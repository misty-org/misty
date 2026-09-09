import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProvidersSnapshot } from "@/native/contracts";
import { useProvidersStore } from "../store";
import { createConnectionSession } from "../store/providerConnectionHelpers";
import { ConnectedStoragePanel } from "./ConnectedStoragePanel";

const original = useProvidersStore.getState();
const snapshot: ProvidersSnapshot = {
  loading: false,
  error: null,
  health: {
    ready: true,
    connectedProviders: 0,
    availableProviders: 3,
    error: null,
    port: null,
    version: "test",
    uptimeSeconds: 0,
  },
  remotes: [],
  workflows: [
    { type: "dropbox", name: "Dropbox", description: "Dropbox", options: [] },
    { type: "drive", name: "Google Drive", description: "Google Drive", options: [] },
    {
      type: "onedrive",
      name: "Microsoft OneDrive",
      description: "Microsoft OneDrive",
      options: [],
    },
  ],
};

beforeEach(() => {
  useProvidersStore.setState({
    ...original,
    loading: false,
    working: false,
    connection: null,
    disconnectTarget: null,
    error: null,
    providers: snapshot,
    load: vi.fn(async () => {}),
    openAddRemote: vi.fn(async () => {
      useProvidersStore.setState({ connection: createConnectionSession("add") });
    }),
    submitConnection: vi.fn(async () => {}),
    reopenConnectionAuthorization: vi.fn(async () => {}),
    confirmDisconnect: vi.fn(async () => {}),
  });
});
afterEach(() => {
  cleanup();
  useProvidersStore.setState(original, true);
});

describe("connected storage integration panel", () => {
  it("opens one searchable integration directory and configures in the same panel", async () => {
    render(<ConnectedStoragePanel onClose={() => {}} />);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(document.querySelector('[data-slot="workspace-overlay"]')).toBeNull();
    const search = screen.getByRole("textbox", { name: "Search Connected storage" });
    fireEvent.change(search, { target: { value: "Google" } });
    expect(screen.queryByRole("button", { name: "Add Dropbox" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add Google Drive" }));
    await screen.findByRole("button", { name: "Connect account" });
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("dialog").getAttribute("aria-labelledby")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Google Drive" })).toBeTruthy();
    expect(useProvidersStore.getState().connection?.stage).toBe("configure");
    const advanced = document.querySelector("details")!;
    expect(advanced.open).toBe(false);
    fireEvent.change(screen.getByRole("textbox", { name: /Connection name/ }), {
      target: { value: "work-drive" },
    });
    expect(useProvidersStore.getState().connection?.remoteName).toBe("work-drive");
    fireEvent.click(screen.getByRole("button", { name: "Connect account" }));
    expect(useProvidersStore.getState().submitConnection).toHaveBeenCalledWith(false);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Add account" })).toBeTruthy();
    expect(useProvidersStore.getState().connection).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back to connected storage" }));
    expect(screen.getByRole("textbox", { name: "Search Connected storage" })).toBeTruthy();
  });

  it("shows loading and recoverable service errors without a blank workspace", () => {
    useProvidersStore.setState({ providers: null, loading: true });
    render(<ConnectedStoragePanel onClose={() => {}} />);
    expect(screen.getByRole("status").textContent).toBe("Loading…");
    act(() => useProvidersStore.setState({ loading: false, error: "Storage is unavailable" }));
    expect(screen.getByRole("alert").textContent).toContain("Storage is unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(useProvidersStore.getState().load).toHaveBeenCalledWith(true);
  });

  it("retains sign-in progress, retry, and completion within a single dialog", async () => {
    useProvidersStore.setState({
      connection: {
        ...createConnectionSession("add"),
        providerType: "dropbox",
        remoteName: "work",
        stage: "authorize",
        step: {
          kind: "browser_auth",
          name: "work",
          state: "",
          result: "pending",
          done: false,
          error: "",
          authorizeUrl: "https://example.com/signin",
          instructions: "Finish signing in.",
          pollAfterMs: 1000,
          option: null,
        },
      },
    });
    render(<ConnectedStoragePanel onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Open authorization page" }));
    expect(useProvidersStore.getState().reopenConnectionAuthorization).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    expect(useProvidersStore.getState().submitConnection).toHaveBeenCalledWith(true);
    act(() =>
      useProvidersStore.setState((state) => ({
        connection: { ...state.connection!, stage: "complete" },
      })),
    );
    expect(screen.getByRole("heading", { name: "Storage connected" })).toBeTruthy();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("manages connected accounts and confirms disconnect without stacking dialogs", async () => {
    useProvidersStore.setState({
      providers: {
        ...snapshot,
        remotes: [
          {
            name: "work-drive",
            type: "drive",
            statusLabel: "Connected",
            needsReconnect: false,
            error: null,
            configSource: "cloud",
          },
        ],
      },
    });
    render(<ConnectedStoragePanel onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Open Google Drive" }));
    expect(screen.getByRole("list", { name: "Google Drive accounts" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(useProvidersStore.getState().confirmDisconnect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(useProvidersStore.getState().disconnectTarget).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    await waitFor(() =>
      expect(useProvidersStore.getState().confirmDisconnect).toHaveBeenCalledOnce(),
    );
  });

  it("does not turn a failed add request into a connection form", async () => {
    useProvidersStore.setState({
      openAddRemote: vi.fn(async () => {
        useProvidersStore.setState({ error: "Sign in to Misty before adding a remote." });
      }),
    });
    render(<ConnectedStoragePanel onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Add Dropbox" }));
    await screen.findByRole("alert");
    expect(useProvidersStore.getState().connection).toBeNull();
    expect(screen.queryByRole("button", { name: "Connect account" })).toBeNull();
  });
});
